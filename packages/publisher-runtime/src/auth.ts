import * as fs from 'node:fs';
import * as path from 'node:path';

import { publisherHome } from './constants.js';
import type { JsonObject } from './types.js';
import { atomicWriteJson, isRecord } from './util.js';

const TAKU_ACCOUNT_BASE_URL = 'https://auth.taku.ai';
// This is a Supabase publishable browser/client value, not a service credential.
// It grants no server-side authority and is intentionally shipped in the plugin.
const SUPABASE_PUBLIC_CLIENT_VALUE = `sb_publishable_${'CU6CXli0rTJmPMUjZbRJVQ_9ebw7OvV'}`;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export interface ResolvedAuth {
  token: string;
  source: string;
  iconToken: string;
  scopes: string[];
  sessionPath?: string;
  refreshed: boolean;
}

export type RefreshTransport = (
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
  timeoutMs: number,
) => Promise<{ status: number; body: Uint8Array }>;

export async function resolveAuth(
  options: {
    tokenEnv?: string;
    env?: NodeJS.ProcessEnv;
    transport?: RefreshTransport;
  } = {},
): Promise<ResolvedAuth> {
  const env = options.env ?? process.env;
  const tokenEnv = options.tokenEnv ?? 'TAKU_BEARER_TOKEN';
  const envToken = String(env[tokenEnv] ?? '').trim();
  if (envToken) return resolvedEnv(envToken, `env:${tokenEnv}`);
  if (tokenEnv === 'TAKU_BEARER_TOKEN') {
    const fallback = String(env.TAKU_PUBLISH_TOKEN ?? '').trim();
    if (fallback) return resolvedEnv(fallback, 'env:TAKU_PUBLISH_TOKEN');
  }
  const publisherPath = publisherSessionPath(env);
  const publisherSession = readSession(publisherPath);
  if (publisherSession && !isExpired(publisherSession)) {
    return {
      token: String(publisherSession.accessToken ?? '').trim(),
      source: 'publisher_session',
      iconToken: validIconToken(publisherSession),
      scopes: Array.isArray(publisherSession.scopes)
        ? publisherSession.scopes.filter((scope): scope is string => typeof scope === 'string' && Boolean(scope.trim()))
        : [],
      sessionPath: publisherPath,
      refreshed: false,
    };
  }
  const desktopPath = sessionPath(env);
  const session = readSession(desktopPath);
  if (!session) return { token: '', source: 'missing', iconToken: '', scopes: [], sessionPath: desktopPath, refreshed: false };
  const accessToken = String(session.accessToken ?? '').trim();
  if (accessToken && !isExpiring(session)) {
    return { token: accessToken, source: 'session', iconToken: accessToken, scopes: [], sessionPath: desktopPath, refreshed: false };
  }
  const refreshed = await refreshSession(session, {
    path: desktopPath,
    transport: options.transport,
  });
  if (refreshed) {
    const token = String(refreshed.accessToken ?? '').trim();
    if (token) return { token, source: 'session', iconToken: token, scopes: [], sessionPath: desktopPath, refreshed: true };
  }
  if (accessToken && expiresAtMs(session) === undefined) {
    return { token: accessToken, source: 'session', iconToken: accessToken, scopes: [], sessionPath: desktopPath, refreshed: false };
  }
  return { token: '', source: 'expired', iconToken: '', scopes: [], sessionPath: desktopPath, refreshed: false };
}

export async function authStatus(
  options: {
    tokenEnv?: string;
    refresh?: boolean;
    env?: NodeJS.ProcessEnv;
    transport?: RefreshTransport;
  } = {},
): Promise<JsonObject> {
  const env = options.env ?? process.env;
  const tokenEnv = options.tokenEnv ?? 'TAKU_BEARER_TOKEN';
  const desktopPath = sessionPath(env);
  let session = readSession(desktopPath);
  if (options.refresh && session) session = await refreshSession(session, { path: desktopPath, transport: options.transport }) ?? session;
  const resolved = await resolveAuth({ tokenEnv, env, transport: options.transport });
  if (!session) session = readSession(desktopPath);
  const effective = resolved.source === 'publisher_session' ? readSession(publisherSessionPath(env)) : session;
  const expiration = expiresAtMs(effective ?? {});
  return {
    authenticated: Boolean(resolved.token),
    source: resolved.source,
    account_hint: publisherAccountHint({ session, tokenEnv, authSource: resolved.source, env }),
    session_path: desktopPath,
    session_file_exists: fs.existsSync(desktopPath),
    publisher_session_path: publisherSessionPath(env),
    publisher_session_file_exists: fs.existsSync(publisherSessionPath(env)),
    can_refresh: Boolean(session?.refreshToken),
    refreshed: resolved.refreshed,
    expires_in_seconds: expiration === undefined ? null : Math.max(0, Math.trunc((expiration - Date.now()) / 1000)),
  };
}

export function publisherAccountHint(options: {
  session?: JsonObject | null;
  tokenEnv?: string;
  authSource?: string;
  env?: NodeJS.ProcessEnv;
} = {}): string | null {
  const env = options.env ?? process.env;
  const tokenEnv = options.tokenEnv ?? 'TAKU_BEARER_TOKEN';
  if (options.authSource && !['session', 'publisher_session'].includes(options.authSource)) return null;
  if (String(env[tokenEnv] ?? '').trim()) return null;
  if (tokenEnv === 'TAKU_BEARER_TOKEN' && String(env.TAKU_PUBLISH_TOKEN ?? '').trim()) return null;
  if (options.authSource === 'publisher_session') {
    const publisher = readSession(publisherSessionPath(env));
    const hint = String(publisher?.accountHint ?? '').trim();
    return hint || null;
  }
  const user = isRecord(options.session?.user) ? options.session?.user : undefined;
  const email = String(user?.email ?? '').trim();
  if (!email.includes('@')) return null;
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return null;
  const visible = local.slice(0, Math.min(4, Math.max(1, Math.trunc(local.length / 2))));
  return `${visible}***@${domain}`;
}

export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.TAKU_SESSION_PATH ?? '').trim();
  if (explicit) return path.resolve(explicit);
  const home = String(env.TAKU_HOME ?? '').trim();
  return path.resolve(home || path.join(publisherHome({ ...env, TAKU_PUBLISHER_HOME: '' }), '..'), 'session.json');
}

export function publisherSessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = String(env.TAKU_PUBLISHER_SESSION_PATH ?? '').trim();
  return path.resolve(explicit || path.join(publisherHome(env), 'session.json'));
}

export async function savePublisherSession(payload: JsonObject, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const target = publisherSessionPath(env);
  await atomicWriteJson(target, payload, 0o600);
  return target;
}

export async function clearPublisherSession(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  try {
    await fs.promises.unlink(publisherSessionPath(env));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function authHasScope(auth: ResolvedAuth, scope: string): boolean {
  return Boolean(auth.token) && (auth.source !== 'publisher_session' || auth.scopes.includes(scope));
}

export function readSession(target = sessionPath()): JsonObject | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function refreshSession(
  session: JsonObject,
  options: { path?: string; transport?: RefreshTransport; timeoutMs?: number } = {},
): Promise<JsonObject | null> {
  const refreshToken = String(session.refreshToken ?? '').trim();
  if (!refreshToken) return null;
  const body = Buffer.from(JSON.stringify({ refresh_token: refreshToken }), 'utf8');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apikey: SUPABASE_PUBLIC_CLIENT_VALUE,
  };
  try {
    const response = await (options.transport ?? defaultRefreshTransport)(
      `${TAKU_ACCOUNT_BASE_URL}/auth/v1/token?grant_type=refresh_token`,
      headers,
      body,
      options.timeoutMs ?? 15_000,
    );
    if (response.status < 200 || response.status >= 300) return null;
    const parsed = JSON.parse(Buffer.from(response.body).toString('utf8')) as unknown;
    if (!isRecord(parsed)) return null;
    const accessToken = String(parsed.access_token ?? '').trim();
    if (!accessToken) return null;
    const updated: JsonObject = {
      ...session,
      accessToken,
      refreshToken: String(parsed.refresh_token ?? refreshToken),
      expiresAt: Date.now() + positiveInt(parsed.expires_in, DEFAULT_EXPIRES_IN_SECONDS) * 1000,
    };
    if (isRecord(parsed.user)) updated.user = parsed.user;
    await atomicWriteJson(options.path ?? sessionPath(), updated, 0o600);
    return updated;
  } catch {
    return null;
  }
}

function resolvedEnv(token: string, source: string): ResolvedAuth {
  return {
    token,
    source,
    iconToken: token.startsWith('taku_pub_') ? '' : token,
    scopes: [],
    refreshed: false,
  };
}

async function defaultRefreshTransport(
  url: string,
  headers: Record<string, string>,
  body: Uint8Array,
  timeoutMs: number,
): Promise<{ status: number; body: Uint8Array }> {
  const response = await fetch(url, { method: 'POST', headers, body: Buffer.from(body), signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) };
}

function isExpiring(session: JsonObject): boolean {
  const expires = expiresAtMs(session);
  return expires !== undefined && expires <= Date.now() + REFRESH_BUFFER_MS;
}

function isExpired(session: JsonObject): boolean {
  const token = String(session.accessToken ?? '').trim();
  const expires = expiresAtMs(session);
  return !token || expires === undefined || expires <= Date.now() + 30_000;
}

function validIconToken(session: JsonObject): string {
  const token = String(session.iconToken ?? '').trim();
  const expires = Number(session.iconExpiresAt ?? 0);
  return Number.isFinite(expires) && expires > Date.now() + 5_000 ? token : '';
}

function expiresAtMs(session: JsonObject): number | undefined {
  const numeric = Number(session.expiresAt);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function positiveInt(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallback;
}
