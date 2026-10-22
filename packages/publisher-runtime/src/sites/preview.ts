import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
// Miniflare's alpha package omits several declaration-only workspace packages.
// Keep this narrow Node adapter typed locally; the real workerd test covers it.
type PreviewRuntimeModule = {
  Miniflare: new (options: unknown) => { ready: Promise<URL>; dispatchFetch(url: string, init: RequestInit): Promise<Response>; dispose(): Promise<void> };
  Log: new (level: number) => unknown; LogLevel: { NONE: number };
};
import type { BuiltSiteArtifact, SitesCore } from './core.js';
import type { SitesHttpClient } from './http.js';
import { isRecord, PublisherError } from '../util.js';

type Runtime = { fetch(request: Request): Promise<Response>; stop(): Promise<void> };
type PreviewOptions = {
  core: SitesCore; artifact: BuiltSiteArtifact; client: Pick<SitesHttpClient, 'post' | 'workerUrl'>;
  port?: number; fetcher?: typeof fetch; sdkBytes?: Buffer;
  createRuntime?: (worker: string, assets: string) => Promise<Runtime>;
};
const opaque = () => randomBytes(32).toString('base64url');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** Foreground loopback preview. Publisher and preview credentials remain only
 * in this trusted process. Tenant code executes in workerd with blocked egress. */
export async function startSitePreview(options: PreviewOptions) {
  const manifest = options.artifact.descriptor.siteManifest;
  if (manifest.storage.migrations) throw new PublisherError('Preview SQL migrations are not supported by this gateway.', 'sites_preview_storage_unavailable');
  const directory = await mkdtemp(path.join(tmpdir(), 'taku-site-preview-'));
  const assets = path.join(directory, 'assets'); await mkdir(assets);
  let runtime: Runtime | undefined;
  let capability = ''; let previewId = ''; let expiresAt = Date.now() + 30 * 60_000;
  let verifier = ''; let state = ''; let pendingAuth = false;
  const localCookie = opaque();
  let origin = ''; let stopping: Promise<void> | undefined; let timer: NodeJS.Timeout | undefined;
  const fetcher = options.fetcher ?? fetch;
  const common = () => ({ previewId, manifestDigest: options.artifact.manifestDigest });
  async function call(endpoint: string, input: unknown, token = capability): Promise<Response> {
    return fetcher(new URL(`/v1/sites-preview${endpoint}`, options.client.workerUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(input), redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => send(res, 503, { error: 'preview_unavailable' }));
  });
  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (timer) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (capability) { try { await call('/auth/revoke', common()); } catch { /* session also has a fixed expiry */ } }
      capability = ''; verifier = ''; state = '';
      await runtime?.stop();
      await rm(directory, { recursive: true, force: true });
    })();
    return stopping;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.headers.host !== new URL(origin).host) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url ?? '/', origin);
    if (Date.now() >= expiresAt) return send(res, 401, { error: 'preview_expired' });
    const platform = url.pathname.startsWith('/__taku/');
    if (url.pathname === '/__taku/auth/callback') {
      if (req.method !== 'GET' || !pendingAuth || url.searchParams.get('state') !== state ||
          !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code') ?? '')) return send(res, 400, { error: 'invalid_grant' });
      pendingAuth = false;
      const response = await call('/auth/exchange', { ...common(), callbackUri: `${origin}/__taku/auth/callback`,
        code: url.searchParams.get('code'), codeVerifier: verifier }, '');
      state = ''; verifier = '';
      const result: unknown = await response.json();
      if (!response.ok || !isRecord(result) || typeof result.capability !== 'string' ||
          !/^pc1_[A-Za-z0-9_-]{43}$/.test(result.capability)) return send(res, 401, { error: 'invalid_grant' });
      capability = result.capability;
      res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); return;
    }
    if (url.pathname === '/__taku/sdk/browser-v1.mjs' && req.method === 'GET' && options.sdkBytes) {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(options.sdkBytes); return;
    }
    if (platform) {
      const cookie = (req.headers.cookie ?? '').split(';').map(value => value.trim());
      if (!cookie.includes(`taku_preview_local=${localCookie}`)) return send(res, 401, { error: 'authentication_required' });
      if (url.search) return send(res, 404, { error: 'platform_route_not_found' });
      if (req.method !== 'GET' && (req.headers.origin !== origin || req.headers['x-taku-csrf'] !== '1')) return send(res, 403, { error: 'forbidden' });
      if (req.method === 'GET' && req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'forbidden' });
      if (url.pathname === '/__taku/session' && req.method === 'GET') {
        if (!capability) return send(res, 200, { authenticated: false, mode: 'preview' });
        return forward(res, await call('/session', common()));
      }
      if (url.pathname === '/__taku/auth/start' && req.method === 'POST') {
        const input = await readJson(req);
        if (!isRecord(input) || !Array.isArray(input.scopes) || input.scopes.some(scope => typeof scope !== 'string' || !manifest.auth.scopes.includes(scope)))
          return send(res, 400, { error: 'invalid_scope' });
        verifier = opaque(); state = opaque(); capability = ''; pendingAuth = true;
        const result = await options.client.post('/v1/sites-preview/auth/start', { ...common(),
          callbackUri: `${origin}/__taku/auth/callback`, scopes: input.scopes, state,
          codeChallenge: createHash('sha256').update(verifier).digest('base64url') });
        const target = typeof result.authorizeUrl === 'string' ? new URL(result.authorizeUrl) : null;
        if (target?.origin !== 'https://taku.ai' || target.pathname !== '/auth/sites') throw new Error('invalid_auth_response');
        return send(res, 200, { authorizeUrl: target.href });
      }
      if (url.pathname === '/__taku/auth/logout' && req.method === 'POST') {
        if (capability) await call('/auth/revoke', common()); capability = ''; return send(res, 204);
      }
      if (!capability) return send(res, 401, { error: 'authentication_required' });
      const integration = /^\/__taku\/integrations\/(text|serpapi|airbnb)\/([a-z_]+)$/.exec(url.pathname);
      const generation = /^\/__taku\/media\/generations\/(videos|images)$/.exec(url.pathname);
      const job = /^\/__taku\/media\/jobs\/((?:mgn|med)_[a-f0-9]{32})(\/assets\/0\/content|\/asset-link)?$/.exec(url.pathname);
      if (integration || generation) {
        if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
        const requestId = String(req.headers['idempotency-key'] ?? '');
        if (!/^[A-Za-z0-9._:~-]{16,128}$/.test(requestId)) return send(res, 400, { error: 'invalid_request_id' });
        const endpoint = integration ? `/integrations/${integration[1]}/${integration[2]}` : `/media/generations/${generation![1]}`;
        return forward(res, await call(endpoint, { ...common(), requestId, input: await readJson(req) }));
      }
      if (job && req.method === 'GET') {
        const suffix = job[2] === '/asset-link' ? '/assets/0/link' : job[2] ?? '';
        return forward(res, await call(`/media/jobs/${job[1]}${suffix}`, common()));
      }
      // This gateway does not pretend local records are Taku cloud storage.
      return send(res, 503, { error: url.pathname.startsWith('/__taku/storage/') ? 'preview_storage_unavailable' : 'capability_unavailable' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
    const response = await runtime!.fetch(new Request(url, { method: req.method }));
    const headers = new Headers(response.headers);
    for (const key of [...headers.keys()]) if (key.toLowerCase() === 'set-cookie' || key.toLowerCase().startsWith('x-taku-')) headers.delete(key);
    headers.set('Set-Cookie', `taku_preview_local=${localCookie}; HttpOnly; SameSite=Strict; Path=/`);
    return forward(res, new Response(response.body, { status: response.status, headers }));
  }
  try {
    let worker = '';
    for (const object of options.artifact.objects) {
      if (object.kind === 'migration') continue;
      const bytes = await options.core.readArtifactObject(object);
      if (object.kind === 'worker') { worker = bytes.toString('utf8'); continue; }
      const relative = object.logicalName.replace(/^\//, '');
      const target = path.resolve(assets, relative);
      if (!target.startsWith(assets + path.sep)) throw new Error('invalid_asset_path');
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
    }
    runtime = await (options.createRuntime ?? createWorkerRuntime)(worker, assets);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', () => resolve()); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('invalid_preview_listener');
    origin = `http://127.0.0.1:${address.port}`;
    const created = await options.client.post('/v1/sites-preview/sessions', {
      draftId: `draft_${sha(options.artifact.contentDigest).slice(0, 40)}`, manifest,
      manifestDigest: options.artifact.manifestDigest, callbackUri: `${origin}/__taku/auth/callback`,
    });
    if (typeof created.previewId !== 'string' || !/^pv1_[A-Za-z0-9_-]{43}$/.test(created.previewId) ||
        typeof created.expiresAt !== 'number' || created.expiresAt <= Date.now() || created.expiresAt > Date.now() + 30 * 60_000)
      throw new Error('invalid_preview_session');
    previewId = created.previewId; expiresAt = created.expiresAt;
    timer = setTimeout(() => { void stop(); }, expiresAt - Date.now());
    return { url: origin, expiresAt, stop, pid: process.pid };
  } catch (error) { await stop(); throw error; }
}

async function createWorkerRuntime(worker: string, assets: string): Promise<Runtime> {
  let installed: PreviewRuntimeModule;
  try { installed = createRequire(import.meta.url)('miniflare') as PreviewRuntimeModule; }
  catch { throw new PublisherError('This distribution has no installed private-preview runtime. Use the reviewed developer checkout with its locked dependencies.', 'sites_preview_runtime_unavailable'); }
  const { Miniflare, Log, LogLevel } = installed;
  const mf = new Miniflare({ host: '127.0.0.1', port: 0, cf: false, telemetry: { enabled: false }, log: new Log(LogLevel.NONE),
    workers: [{ config: { name: 'site-preview', type: 'worker', compatibilityDate: '2026-08-01',
      manifest: { mainModule: 'worker.mjs', modules: { 'worker.mjs': { type: 'esm', contents: worker } } },
      env: { ASSETS: { type: 'assets' } }, assets: { directory: assets, hasUserWorker: true, runWorkerFirst: true, notFoundHandling: 'single-page-application' } },
      dev: { outboundService: { type: 'fetcher', handler: () => new Response('direct_egress_blocked', { status: 403 }) } } }] });
  try { await mf.ready; } catch (error) { await mf.dispose(); throw error; }
  return { fetch: async request => { const result = await mf.dispatchFetch(request.url, { method: request.method });
    return new Response(result.body as ReadableStream<Uint8Array> | null, { status: result.status, headers: [...result.headers] }); }, stop: () => mf.dispose() };
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = []; let size = 0;
  for await (const part of request) { const bytes = Buffer.from(part); size += bytes.length; if (size > 65536) throw new Error('request_too_large'); parts.push(bytes); }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
}
function send(response: ServerResponse, status: number, value?: unknown) {
  if (response.headersSent) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}
async function forward(response: ServerResponse, result: Response) {
  const headers: Record<string, string> = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  for (const key of ['Content-Type', 'Content-Length', 'Retry-After', 'Set-Cookie']) { const value = result.headers.get(key); if (value) headers[key] = value; }
  response.writeHead(result.status, headers);
  if (result.body) for await (const bytes of result.body) { if (response.destroyed) break; response.write(bytes); }
  response.end();
}
