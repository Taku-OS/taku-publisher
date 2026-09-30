import { validateWorkerUrl } from '../api.js';
import { resolveAuth, readSession, publisherSessionPath, type ResolvedAuth, type RefreshTransport } from '../auth.js';
import { readBoundedResponse, responseErrorDetails } from '../http-errors.js';
import { DEFAULT_WORKER_URL } from '../constants.js';
import { isRecord, PublisherError } from '../util.js';

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

  async post(path: string, body: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
    return this.request('POST', path, body, idempotencyKey);
  }

  async putObject(path: string, bytes: Buffer, uploadToken: string): Promise<Record<string, unknown>> {
    if (!uploadToken.startsWith('taku_su_')) {
      throw new PublisherError('A scoped upload credential is required.', 'sites_upload_credential_required');
    }
    return this.request('PUT', path, bytes, undefined, uploadToken);
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown,
    idempotencyKey?: string, uploadToken?: string, retried = false,
  ): Promise<Record<string, unknown>> {
    if (!/^\/v1\/sites(?:\/|$)/.test(path)) {
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
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      payload = Buffer.from(JSON.stringify(body ?? {}));
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    } else if (method === 'PUT') {
      payload = body as Buffer;
      headers['Content-Length'] = String(payload.byteLength);
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
      return this.request(method, path, body, idempotencyKey, undefined, true);
    }
    if (!response.ok) {
      const details = responseErrorDetails(response, value, summary);
      const code = details.server_error;
      const actionable = response.status === 401 ? ' Sign in again with sites-login.' : '';
      const eligibility = response.status === 404 ? ' Check internal access eligibility and the CLI version.' : '';
      throw new PublisherError(`Taku Sites returned ${code}.${actionable}${eligibility}`, 'sites_api_error', details);
    }
    if (!isRecord(value)) throw new PublisherError('Taku Sites returned an invalid response.', 'sites_invalid_response');
    return value;
  }
}
