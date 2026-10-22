import { createHash } from 'node:crypto';
import { validateWorkerUrl } from '../api.js';
import { resolveAuth, readSession, publisherSessionPath, type ResolvedAuth, type RefreshTransport } from '../auth.js';
import { readBoundedResponse, responseErrorDetails } from '../http-errors.js';
import { DEFAULT_WORKER_URL } from '../constants.js';
import { isRecord, PublisherError } from '../util.js';
import type { ImageModelQuery, SitesCore } from './core.js';

const SITES_SCOPES = ['sites.read', 'sites.preview', 'sites.publish'];

export async function resolveSitesAuth(env: NodeJS.ProcessEnv = process.env, options: {
  workerUrl?: string; allowCustomWorkerUrl?: boolean; force?: boolean;
  expectedAccessToken?: string; transport?: RefreshTransport;
} = {}): Promise<ResolvedAuth> {
  const session = readSession(publisherSessionPath(env));
  if (session && options.workerUrl && session.workerUrl &&
    new URL(validateWorkerUrl(String(session.workerUrl), options.allowCustomWorkerUrl || session.allowCustomWorkerUrl === true)).origin !==
    new URL(validateWorkerUrl(options.workerUrl, options.allowCustomWorkerUrl)).origin) {
    throw new PublisherError('This Publisher session belongs to another Worker origin. Run sites-login for that origin.', 'publisher_session_origin_mismatch');
  }
  const auth = await resolveAuth({
    env: { ...env, TAKU_BEARER_TOKEN: '', TAKU_PUBLISH_TOKEN: '' },
    allowDesktopSession: false,
    transport: options.transport,
    publisherRefresh: options,
  });
  if (auth.source !== 'publisher_session' || !auth.token) {
    throw new PublisherError('Sign in with sites-login.', 'sites_login_required');
  }
  if (auth.intent !== 'publish_site' || !SITES_SCOPES.every(scope => auth.scopes.includes(scope))) {
    throw new PublisherError('Sign in with the dedicated publish_site authorization.', 'sites_scope_required');
  }
  return auth;
}

export type SitesFetch = typeof fetch;

export class SitesHttpClient {
  readonly workerUrl: string;

  constructor(
    workerUrl = DEFAULT_WORKER_URL,
    private publisherToken: string,
    private readonly fetcher: SitesFetch = fetch,
    allowCustomWorkerUrl = false,
    private readonly renew?: (expectedToken: string) => Promise<string>,
  ) {
    this.workerUrl = validateWorkerUrl(workerUrl, allowCustomWorkerUrl);
    const origin = new URL(this.workerUrl);
    if (origin.pathname !== '/' || origin.search || origin.hash) {
      throw new PublisherError('Sites Worker URL must be an origin.', 'invalid_worker_url');
    }
    if (!publisherToken.startsWith('taku_pub_')) {
      throw new PublisherError('Sites requires a Publisher session.', 'sites_login_required');
    }
  }

  async get(path: string): Promise<Record<string, unknown>> {
    return this.request('GET', path);
  }

  /** Metadata only: fixed authenticated route, shared deadline/body/DTO contract. */
  async getImageModelCatalog(query: ImageModelQuery, core: SitesCore, parent?: AbortSignal): Promise<Record<string, unknown>> {
    const parameters = new URLSearchParams({ operation: query.operation, limit: String(query.limit) });
    if (query.query !== undefined) parameters.set('query', query.query);
    if (query.cursor !== undefined) parameters.set('cursor', query.cursor);
    const url = new URL(`/v1/sites/capabilities/image-models?${parameters}`, this.workerUrl);
    let response: Response | undefined;
    let trustedError: PublisherError | undefined;
    try {
      return await core.withImageModelDeadline(async signal => {
        for (let attempt = 0; attempt < 2; attempt++) {
          signal.throwIfAborted();
          response = await this.fetcher(url, {
            method: 'GET', headers: { Authorization: `Bearer ${this.publisherToken}`, Accept: 'application/json',
              'X-Taku-Image-Model-Features': 'generation-references-v1' },
            redirect: 'error', signal,
          });
          let value: unknown;
          try { value = await core.readImageModelJson(response, signal); }
          catch (error) { if (response.ok || signal.aborted) throw error; }
          signal.throwIfAborted();
          if (response.status === 401 && attempt === 0 && this.renew) {
            let token: string;
            try { token = await this.renew(this.publisherToken); }
            catch {
              signal.throwIfAborted();
              trustedError = new PublisherError('Sign in again with sites-login.', 'sites_login_required');
              throw trustedError;
            }
            signal.throwIfAborted();
            if (!token.startsWith('taku_pub_')) {
              trustedError = new PublisherError('Sign in again with sites-login.', 'sites_login_required');
              throw trustedError;
            }
            this.publisherToken = token;
            continue;
          }
          if (!response.ok) { trustedError = imageModelHttpError(response, value); throw trustedError; }
          return core.parseImageModelCatalog(value, query.operation, query.limit, 'generation-references-v1');
        }
        throw new Error('image_model_catalog_unavailable');
      }, parent);
    } catch (error) {
      void response?.body?.cancel().catch(() => {});
      if (error === trustedError && trustedError) throw trustedError;
      throw new PublisherError('The image model catalog is unavailable. Retry the same read.', 'sites_image_model_catalog_unavailable', {
        request_id: response ? imageModelRequestId(response) : null,
      });
    }
  }

  async post(path: string, body: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.request('POST', path, body, idempotencyKey);
  }

  async postEmpty(path: string): Promise<Record<string, unknown>> {
    return this.request('POST', path);
  }

  async delete(path: string): Promise<Record<string, unknown>> {
    return this.request('DELETE', path);
  }

  /** Fixed owner endpoint only; never follow a metadata/provider URL with auth. */
  async getMaterialContent(assetId: string, retried = false): Promise<Response> {
    if (typeof assetId !== 'string' || !/^ast_[a-f0-9]{32}$/.test(assetId)) {
      throw new PublisherError('Use an exact asset ID.', 'sites_asset_arguments_invalid');
    }
    let response: Response;
    try {
      response = await this.fetcher(new URL(`/v1/sites/assets/${assetId}/content`, this.workerUrl), {
        method: 'GET', headers: { Authorization: `Bearer ${this.publisherToken}`, Accept: 'application/octet-stream' },
        redirect: 'error', signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new PublisherError('Could not reach Taku Sites. Retry the same download.', 'sites_network_unavailable');
    }
    if (response.ok) return response;
    const { value, summary } = await readBoundedResponse(response);
    if (response.status === 401 && !retried && this.renew) {
      this.publisherToken = await this.renew(this.publisherToken);
      if (!this.publisherToken.startsWith('taku_pub_')) throw new PublisherError('Publisher renewal failed.', 'sites_login_required');
      return this.getMaterialContent(assetId, true);
    }
    const details = responseErrorDetails(response, value, summary);
    throw new PublisherError(`Taku Sites returned ${details.server_error}.`, 'sites_api_error', details);
  }

  async putMaterialPart(path: string, bytes: Buffer): Promise<Record<string, unknown>> {
    if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024) {
      throw new PublisherError('Invalid material part size.', 'sites_material_part_invalid');
    }
    return this.request('PUT', path, bytes, undefined, undefined, false, createHash('sha256').update(bytes).digest('hex'));
  }

  async putObject(path: string, bytes: Buffer, uploadToken: string): Promise<Record<string, unknown>> {
    if (!uploadToken.startsWith('taku_su_')) {
      throw new PublisherError('A scoped upload credential is required.', 'sites_upload_credential_required');
    }
    return this.request('PUT', path, bytes, undefined, uploadToken);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown,
    idempotencyKey?: string, uploadToken?: string, retried = false, materialPartHash?: string,
  ): Promise<Record<string, unknown>> {
    const ownerPreview = method === 'POST' && ['/v1/sites-preview/sessions', '/v1/sites-preview/auth/start'].includes(path);
    if (!ownerPreview && !/^\/v1\/sites(?:\/|$)/.test(path)) {
      throw new PublisherError('Invalid Sites API path.', 'sites_invalid_api_path');
    }
    const url = new URL(path, this.workerUrl);
    if (url.origin !== new URL(this.workerUrl).origin) {
      throw new PublisherError('Invalid Sites API path.', 'sites_invalid_api_path');
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${uploadToken ?? this.publisherToken}`,
      Accept: 'application/json',
    };
    let payload: Buffer | undefined;
    if (method === 'POST' && body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = Buffer.from(JSON.stringify(body ?? {}));
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    } else if (method === 'PUT') {
      payload = body as Buffer;
      headers['Content-Length'] = String(payload.byteLength);
      if (materialPartHash) headers['X-Taku-Asset-Part-Sha256'] = materialPartHash;
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method, headers, body: payload as unknown as BodyInit | undefined,
        redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new PublisherError('Could not reach Taku Sites. Retry the same command.', 'sites_network_unavailable');
    }
    const { value, summary } = await readBoundedResponse(response);
    if (response.status === 401 && !retried && !uploadToken && this.renew) {
      this.publisherToken = await this.renew(this.publisherToken);
      if (!this.publisherToken.startsWith('taku_pub_')) throw new PublisherError('Publisher renewal failed.', 'sites_login_required');
      return this.request(method, path, body, idempotencyKey, undefined, true, materialPartHash);
    }
    if (!response.ok) {
      const details = responseErrorDetails(response, value, summary);
      const code = details.server_error;
      const actionable = response.status === 401 ? ' Sign in again with sites-login.' : '';
      const eligibility = response.status === 404 ? ' Check the target, account access and the CLI version.' : '';
      const paywall = (response.status === 403 && code === 'SITE_LIMIT_REACHED') ||
        (response.status === 409 && code === 'SITE_STORAGE_LIMIT_REACHED');
      const guidance = paywall ? ' The same project and build are retained. Free capacity or review plans, then retry the same command; publication requires a valid confirmation.' : '';
      throw new PublisherError(`Taku Sites returned ${code}.${actionable}${eligibility}${guidance}`, 'sites_api_error', {
        ...details, ...(paywall ? { upgrade_url: 'https://taku.ai/pricing', project_preserved: true } : {}),
      });
    }
    if (!isRecord(value)) throw new PublisherError('Taku Sites returned an invalid response.', 'sites_invalid_response');
    return value;
  }
}

const IMAGE_MODEL_ERROR_CODES = new Set([
  'invalid_image_model_catalog_query', 'image_model_catalog_unavailable', 'authentication_required',
  'capability_unavailable', 'site_frozen', 'site_unavailable', 'site_media_rate_limited', 'site_quota_unavailable',
  'forbidden', 'insufficient_scope', 'scope_not_declared', 'integration_not_declared', 'operation_not_declared',
  'SITE_CAPABILITY_INTERNAL_ONLY',
]);

function imageModelRequestId(response: Response): string | null {
  for (const name of ['X-Taku-Sites-Request-Id', 'X-Request-Id']) {
    const value = response.headers.get(name);
    if (value && (/^req_[a-f0-9]{32}$/.test(value) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))) return value;
  }
  return null;
}

function imageModelHttpError(response: Response, value: unknown): PublisherError {
  const defaults: Record<number, string> = { 400: 'invalid_image_model_catalog_query', 401: 'authentication_required',
    403: 'insufficient_scope', 423: 'site_frozen', 429: 'site_media_rate_limited' };
  const known = isRecord(value) ? [value.error_code, value.error].find(code => typeof code === 'string' && IMAGE_MODEL_ERROR_CODES.has(code)) : undefined;
  const code = typeof known === 'string' ? known : defaults[response.status] ?? 'image_model_catalog_unavailable';
  const rawRetry = response.headers.get('Retry-After');
  const retry = rawRetry !== null && /^\d{1,4}$/.test(rawRetry) && Number(rawRetry) <= 3600 ? Number(rawRetry) : undefined;
  return new PublisherError(`Taku Sites returned ${code}.`, 'sites_api_error', {
    http_status: response.status, server_error: code, request_id: imageModelRequestId(response),
    ...(response.status === 429 && retry !== undefined ? { retry_after_seconds: retry } : {}),
  });
}
