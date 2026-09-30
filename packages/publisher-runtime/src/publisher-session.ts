import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateWorkerUrl } from './api.js';
import { DEFAULT_WORKER_URL, publisherHome } from './constants.js';
import { readBoundedResponse, responseErrorDetails, sanitizeDiagnostic } from './http-errors.js';
import type { JsonObject } from './types.js';
import { atomicWriteJson, isRecord, PublisherError, secureDirectory } from './util.js';

const SCOPES = ['sites.read', 'sites.preview', 'sites.publish'];
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const REFRESH = new RegExp(`^taku_refresh_(${UUID})_[a-f0-9]{64}$`, 'i');
export type PublisherRefreshTransport = (
  url: string, headers: Record<string, string>, body: Uint8Array, timeoutMs: number,
) => Promise<{ status: number; body: Uint8Array }>;
export type PublisherRefreshOptions = {
  env?: NodeJS.ProcessEnv;
  transport?: PublisherRefreshTransport;
  force?: boolean;
  expectedAccessToken?: string;
  workerUrl?: string;
  allowCustomWorkerUrl?: boolean;
};

export function publisherSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.TAKU_PUBLISHER_SESSION_PATH ?? '').trim();
  return path.resolve(explicit || path.join(publisherHome(env), 'session.json'));
}

async function readSession(file: string): Promise<JsonObject | null> {
  try { const value: unknown = JSON.parse(await fs.readFile(file, 'utf8')); return isRecord(value) ? value as JsonObject : null; }
  catch { return null; }
}

function isUsable(session: JsonObject) {
  const expires = Number(session.expiresAt);
  const expiresMs = expires < 10_000_000_000 ? expires * 1000 : expires;
  return typeof session.accessToken === 'string' && session.accessToken.startsWith('taku_pub_') &&
    Number.isFinite(expiresMs) && expiresMs > Date.now() + 30_000 && session.usesRemaining !== 0;
}

function sessionOrigin(session: JsonObject, options: PublisherRefreshOptions): string {
  const recorded = typeof session.workerUrl === 'string' ? session.workerUrl : DEFAULT_WORKER_URL;
  const origin = validateWorkerUrl(recorded, options.allowCustomWorkerUrl === true || session.allowCustomWorkerUrl === true);
  const parsed = new URL(origin);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new PublisherError('Publisher authorization origin is invalid.', 'invalid_worker_url');
  if (options.workerUrl && new URL(validateWorkerUrl(options.workerUrl, options.allowCustomWorkerUrl)).origin !== parsed.origin) {
    throw new PublisherError('This Publisher session belongs to another Worker origin. Run sites-login for the selected origin.', 'publisher_session_origin_mismatch');
  }
  return parsed.origin;
}

/** The lock also serializes logout, so a late refresh cannot resurrect a cleared session. */
export async function withPublisherSessionLock<T>(env: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> {
  const file = `${publisherSessionPath(env)}.lock`;
  await secureDirectory(path.dirname(file));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    let handle;
    try { handle = await fs.open(file, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = JSON.parse(await fs.readFile(file, 'utf8')) as { pid?: number };
        if (Number.isInteger(owner.pid) && Number(owner.pid) > 0) {
          let alive = true;
          try { process.kill(Number(owner.pid), 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
          if (!alive) { await fs.unlink(file).catch(() => undefined); continue; }
        }
      } catch { /* A live caller may still be writing the lock metadata. */ }
      await new Promise(resolve => setTimeout(resolve, 50));
      continue;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.sync(); return await action(); }
    finally { await handle.close(); await fs.unlink(file).catch(() => undefined); }
  }
  throw new PublisherError('Another Publisher credential operation is running. Retry shortly.', 'publisher_session_busy');
}

async function defaultTransport(url: string, headers: Record<string, string>, body: Uint8Array, timeoutMs: number) {
  const response = await fetch(url, { method: 'POST', headers, body: Buffer.from(body), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  const { value, summary } = await readBoundedResponse(response);
  // Adapt the legacy transport interface, retaining safe error metadata only on failures.
  return { status: response.status, body: Buffer.from(JSON.stringify(response.ok ? value : responseErrorDetails(response, value, summary))) };
}

async function exchange(origin: string, operation: 'refresh' | 'revoke', body: JsonObject, transport?: PublisherRefreshTransport): Promise<JsonObject> {
  let response;
  try {
    response = await (transport ?? defaultTransport)(`${origin}/marketplace/local-auth/${operation}`,
      { Accept: 'application/json', 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify(body)), 15_000);
  } catch { throw new PublisherError('Publisher renewal could not reach Taku. Retry the same command.', 'publisher_refresh_unavailable'); }
  let value: unknown;
  try { value = JSON.parse(Buffer.from(response.body).toString('utf8')); } catch { value = {}; }
  if (response.status < 200 || response.status >= 300) {
    const details = responseErrorDetails(new Response(null, { status: response.status }), value, '');
    if (isRecord(value) && typeof value.response_summary === 'string') details.response_summary = sanitizeDiagnostic(value.response_summary);
    throw new PublisherError(response.status === 401 ? 'Publisher authorization expired or was revoked. Run sites-login.' : 'Publisher renewal was denied or unavailable.',
      response.status === 401 ? 'sites_login_required' : 'publisher_refresh_unavailable', details);
  }
  if (!isRecord(value)) throw new PublisherError('Invalid Publisher renewal response.', 'publisher_refresh_invalid_response');
  return value as JsonObject;
}

export async function refreshPublisherSession(options: PublisherRefreshOptions = {}): Promise<JsonObject | null> {
  const env = options.env ?? process.env;
  return withPublisherSessionLock(env, async () => {
    const file = publisherSessionPath(env);
    const current = await readSession(file);
    if (!current || current.intent !== 'publish_site') return current;
    const origin = sessionOrigin(current, options);
    if (isUsable(current) && (!options.force ||
      (options.expectedAccessToken !== undefined && current.accessToken !== options.expectedAccessToken))) return current;
    if (!current.refreshToken) return null; // Older Publisher sessions deliberately require a new login.
    if (!SCOPES.every(scope => Array.isArray(current.scopes) && current.scopes.includes(scope)) ||
      !REFRESH.test(String(current.refreshToken)) ||
      REFRESH.exec(String(current.refreshToken))?.[1] !== current.sessionId ||
      Date.parse(String(current.refreshExpiresAt)) <= Date.now() || !Number.isFinite(Date.parse(String(current.refreshExpiresAt)))) {
      throw new PublisherError('Publisher authorization expired or is invalid. Run sites-login.', 'sites_login_required');
    }
    // Persist the request before sending it. If the server rotates but the response is
    // lost, the next command recovers exactly that rotation rather than creating another.
    const pending = { ...current, refreshRequestId: typeof current.refreshRequestId === 'string' ? current.refreshRequestId : randomUUID() };
    await atomicWriteJson(file, pending, 0o600);
    const result = await exchange(origin, 'refresh', {
      refreshToken: String(current.refreshToken), refreshRequestId: pending.refreshRequestId,
    }, options.transport);
    const grantedScopes = result.scopes;
    if (typeof result.token !== 'string' || !result.token.startsWith('taku_pub_') ||
      result.sessionId !== current.sessionId || result.refreshExpiresAt !== current.refreshExpiresAt ||
      typeof result.refreshToken !== 'string' || !REFRESH.test(result.refreshToken) ||
      REFRESH.exec(result.refreshToken)?.[1] !== current.sessionId ||
      !Array.isArray(grantedScopes) || grantedScopes.length !== SCOPES.length || !SCOPES.every(scope => grantedScopes.includes(scope)) ||
      !Number.isInteger(result.expiresIn) || Number(result.expiresIn) <= 0 || Number(result.expiresIn) > 3600 ||
      !Number.isInteger(result.usesRemaining) || Number(result.usesRemaining) < 0 || Number(result.usesRemaining) > 256) {
      throw new PublisherError('Invalid Publisher renewal response; credentials were not replaced.', 'publisher_refresh_invalid_response');
    }
    const updated: JsonObject = { ...current, accessToken: result.token, refreshToken: result.refreshToken,
      expiresAt: Math.min(Date.now() + Number(result.expiresIn) * 1000, Date.parse(String(current.refreshExpiresAt))),
      usesRemaining: result.usesRemaining, scopes: result.scopes };
    delete updated.refreshRequestId;
    await atomicWriteJson(file, updated, 0o600);
    return updated;
  });
}

export async function revokePublisherSession(env: NodeJS.ProcessEnv = process.env, options: Pick<PublisherRefreshOptions, 'transport'> = {}): Promise<{
  removed: boolean; revoked: boolean; revocation_error_code?: string;
}> {
  return withPublisherSessionLock(env, async () => {
    const file = publisherSessionPath(env);
    const current = await readSession(file);
    if (!current) return { removed: false, revoked: false };
    let revoked = false;
    let revocationError: string | undefined;
    if (current.intent === 'publish_site' && typeof current.refreshToken === 'string') {
      try {
        const result = await exchange(sessionOrigin(current, {}), 'revoke', { refreshToken: current.refreshToken }, options.transport);
        if (result.ok !== true) throw new PublisherError('Invalid revocation response.', 'publisher_refresh_invalid_response');
        revoked = true;
      } catch (error) { revocationError = error instanceof PublisherError ? error.code : 'publisher_revoke_unavailable'; }
    }
    await fs.unlink(file);
    return { removed: true, revoked, ...(revocationError ? { revocation_error_code: revocationError } : {}) };
  });
}
