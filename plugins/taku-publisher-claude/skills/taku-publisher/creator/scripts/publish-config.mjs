import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getFlag, hasFlag } from './cli.mjs';

export const STAGING_WORKER_URL = 'https://taku-workers-staging.takuos.workers.dev';
export const DEFAULT_WORKER_URL = 'https://worker.taku.ai';
export const DEFAULT_SITE_URL = 'https://taku.ai';
export const STAX_CREATOR_PUBLISH_CONTRACT_VERSION = 'taku.stax.creator-publish.2026-06-19';
export const CREATOR_CLOUD_DRAFT_STATE_SCHEMA = 'taku.publisher.creator-cloud-draft.v1';

const TRUSTED_WORKER_HOSTNAMES = new Set([
  'worker.taku.ai',
  'taku-workers-staging.takuos.workers.dev',
]);

export function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isLocalSiteUrl(value) {
  try {
    const url = new URL(trimUrl(value));
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

export function isTrustedWorkerUrl(value) {
  try {
    const url = new URL(trimUrl(value));
    if (isLoopbackHost(url.hostname)) return url.protocol === 'http:' || url.protocol === 'https:';
    return url.protocol === 'https:' && TRUSTED_WORKER_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function allowsCustomWorkerUrl(parsed) {
  return hasFlag(parsed, 'allow-custom-worker-url') ||
    String(process.env.TAKU_ALLOW_CUSTOM_WORKER_URL || '').trim() === '1';
}

function assertTrustedWorkerUrl(workerUrl, parsed) {
  if (!workerUrl || isTrustedWorkerUrl(workerUrl) || allowsCustomWorkerUrl(parsed)) return;
  throw new Error(
    `Refusing to send Taku auth to untrusted worker URL "${workerUrl}". ` +
    'Use https://worker.taku.ai, https://taku-workers-staging.takuos.workers.dev, a loopback URL, or pass --allow-custom-worker-url only for trusted development servers.'
  );
}

function resolveConfiguredWorkerUrl(parsed) {
  return trimUrl(
    getFlag(parsed, 'worker-url')
    || process.env.TAKU_WORKER_URL
    || process.env.VITE_WORKER_URL
    || process.env.NEXT_PUBLIC_TAKU_WORKER_URL
    || process.env.NEXT_PUBLIC_WORKER_URL
    || ''
  );
}

export function resolveWorkerUrl(parsed) {
  const explicitWorkerUrl = resolveConfiguredWorkerUrl(parsed);
  if (explicitWorkerUrl) {
    assertTrustedWorkerUrl(explicitWorkerUrl, parsed);
    return explicitWorkerUrl;
  }
  const localWorkerUrl = ['http', '://', '127.0.0.1', ':', '7049'].join('');
  const workerUrl = isLocalSiteUrl(resolveSiteUrl(parsed))
    ? localWorkerUrl
    : trimUrl(DEFAULT_WORKER_URL);
  assertTrustedWorkerUrl(workerUrl, parsed);
  return workerUrl;
}

export function resolveStudioWorkerUrl(parsed) {
  const explicitWorkerUrl = resolveConfiguredWorkerUrl(parsed);
  const workerUrl = explicitWorkerUrl || trimUrl(DEFAULT_WORKER_URL);
  assertTrustedWorkerUrl(workerUrl, parsed);
  return workerUrl;
}

function resolveConfiguredSiteUrl(parsed) {
  return trimUrl(
    getFlag(parsed, 'site-url')
    || process.env.TAKU_SITE_URL
    || process.env.TAKU_WEB_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || ''
  );
}

export function resolveSiteUrl(parsed) {
  return resolveConfiguredSiteUrl(parsed) || DEFAULT_SITE_URL;
}

export function resolveStudioSiteUrl(parsed) {
  return resolveConfiguredSiteUrl(parsed) || DEFAULT_SITE_URL;
}

export function resolveAuthSiteUrl(parsed) {
  return trimUrl(
    getFlag(parsed, 'auth-site-url')
    || process.env.TAKU_AUTH_SITE_URL
    || DEFAULT_SITE_URL
  );
}

export function readPublishToken(parsed) {
  return readAuthorizedTakuToken(parsed, 'creator.card.write');
}

export function readStudioDraftToken(parsed) {
  return readAuthorizedTakuToken(parsed, 'creator.studio-draft.write');
}

export function readCreatorProfileToken(parsed) {
  return readAuthorizedTakuToken(parsed, 'creator.profile.read');
}

export function readAuthorizedTakuToken(parsed, requiredScope) {
  const directToken = (
    getFlag(parsed, 'bearer-token')
    || process.env.TAKU_BEARER_TOKEN
    || process.env.SUPABASE_ACCESS_TOKEN
    || process.env.TAKU_PUBLISH_TOKEN
    || ''
  ).trim();
  if (directToken) return publisherTokenMatchesExpectedUser(directToken) ? directToken : '';
  return readPublisherSessionToken(requiredScope);
}

export function readIconAuthToken(parsed) {
  const directToken = (
    getFlag(parsed, 'bearer-token')
    || process.env.TAKU_BEARER_TOKEN
    || process.env.SUPABASE_ACCESS_TOKEN
    || process.env.TAKU_PUBLISH_TOKEN
    || ''
  ).trim();
  if (
    directToken
    && !directToken.startsWith('taku_pub_')
    && publisherTokenMatchesExpectedUser(directToken)
  ) return directToken;

  const session = readPublisherSession();
  const expiresAt = Number(session?.iconExpiresAt || 0);
  if (
    session?.iconToken
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && publisherSessionMatchesExpectedUser(session)
  ) return String(session.iconToken).trim();
  return '';
}

function readPublisherSessionToken(requiredScope) {
  const session = readPublisherSession();
  const expiresAt = Number(session?.expiresAt || 0);
  const scopes = Array.isArray(session?.scopes) ? session.scopes : [];
  if (
    !session?.accessToken
    || !Number.isFinite(expiresAt)
    || expiresAt <= Date.now()
    || (requiredScope && !scopes.includes(requiredScope))
    || !publisherSessionMatchesExpectedUser(session)
  ) return '';
  return String(session.accessToken).trim();
}

export function readPublisherSession() {
  const sessionPath = publisherSessionPath();
  try {
    return JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch {
    return null;
  }
}

export function writePublisherSession(value = {}) {
  const sessionPath = publisherSessionPath();
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(sessionPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return sessionPath;
}

export function clearPublisherSession() {
  const sessionPath = publisherSessionPath();
  try {
    fs.unlinkSync(sessionPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export function bindPublisherSessionAccount(account = {}) {
  const session = readPublisherSession();
  if (!session?.accessToken) return null;
  const normalizedAccount = normalizePublisherAccount(account);
  if (!normalizedAccount) return session;
  const next = {
    ...session,
    account: normalizedAccount,
    updatedAt: new Date().toISOString(),
  };
  writePublisherSession(next);
  return next;
}

export function buildPublisherSessionFromAuthResult(data = {}) {
  const now = Date.now();
  const accessToken = String(data.token || data.accessToken || data.access_token || '').trim();
  const iconToken = String(data.iconToken || data.icon_token || '').trim();
  const expiresAt = normalizeExpiryMs(
    data.expiresAt ?? data.expires_at ?? data.exp,
    data.expiresIn ?? data.expires_in,
    now + 7 * 24 * 60 * 60 * 1000,
  );
  const iconExpiresAt = normalizeExpiryMs(
    data.iconExpiresAt ?? data.icon_expires_at ?? data.iconExp,
    data.iconExpiresIn ?? data.icon_expires_in,
    expiresAt,
  );
  const scopes = Array.isArray(data.scopes)
    ? data.scopes.map((scope) => String(scope || '').trim()).filter(Boolean)
    : [];
  const account = normalizePublisherAccount(data.account);
  return {
    ...(accessToken ? { accessToken } : {}),
    expiresAt,
    scopes,
    ...(iconToken ? { iconToken, iconExpiresAt } : {}),
    ...(account ? { account } : {}),
    updatedAt: new Date(now).toISOString(),
  };
}

function normalizePublisherAccount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const userId = normalizePublisherUserId(value.userId || value.user_id || value.id);
  const username = String(value.username || '').trim().replace(/^@+/, '').slice(0, 80);
  const displayName = String(value.displayName || value.display_name || '').trim().slice(0, 120);
  const accountHint = String(value.accountHint || value.account_hint || '').trim().slice(0, 160);
  if (!userId && !username && !displayName && !accountHint) return null;
  return {
    ...(userId ? { userId } : {}),
    ...(username ? { username } : {}),
    ...(displayName ? { displayName } : {}),
    ...(accountHint ? { accountHint } : {}),
  };
}

export function readExpectedPublisherUserId() {
  return normalizePublisherUserId(process.env.TAKU_DESKTOP_AUTH_USER_ID);
}

export function publisherUserIdFromToken(token) {
  try {
    const [, payload] = String(token || '').trim().split('.');
    if (!payload) return '';
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return normalizePublisherUserId(parsed?.sub);
  } catch {
    return '';
  }
}

function publisherTokenMatchesExpectedUser(token) {
  const expectedUserId = readExpectedPublisherUserId();
  if (!expectedUserId) return true;
  return publisherUserIdFromToken(token) === expectedUserId;
}

function publisherSessionMatchesExpectedUser(session) {
  const expectedUserId = readExpectedPublisherUserId();
  if (!expectedUserId) return true;
  const sessionUserId = normalizePublisherUserId(session?.account?.userId)
    || publisherUserIdFromToken(session?.accessToken);
  return sessionUserId === expectedUserId;
}

function normalizePublisherUserId(value) {
  return String(value || '').trim().slice(0, 160);
}

function normalizeExpiryMs(value, expiresInSeconds, fallback) {
  const now = Date.now();
  const explicit = Number(value);
  if (Number.isFinite(explicit) && explicit > 0) {
    const explicitMs = explicit < 10_000_000_000 ? explicit * 1000 : explicit;
    if (explicitMs > now + 30_000) return explicitMs;
    if (Number.isFinite(Number(fallback)) && Number(fallback) > now + 30_000) return Number(fallback);
    return explicitMs;
  }
  const relative = Number(expiresInSeconds);
  if (Number.isFinite(relative) && relative > 0) return now + relative * 1000;
  return fallback;
}

function publisherSessionPath() {
  const sessionPath = process.env.TAKU_PUBLISHER_SESSION_PATH
    ? path.resolve(process.env.TAKU_PUBLISHER_SESSION_PATH)
    : process.env.TAKU_PUBLISHER_HOME
      ? path.resolve(process.env.TAKU_PUBLISHER_HOME, 'session.json')
      : path.join(os.homedir(), '.taku', 'publisher', 'session.json');
  return sessionPath;
}

export function creatorCloudDraftStatePath() {
  const root = process.env.TAKU_PUBLISHER_HOME
    ? path.resolve(process.env.TAKU_PUBLISHER_HOME)
    : path.join(os.homedir(), '.taku', 'publisher');
  return path.join(root, 'creator-cloud-draft.json');
}

export function rememberCreatorCloudDraft(value = {}) {
  const draftPath = String(value.draftPath || '').trim();
  const workerUrl = trimUrl(value.workerUrl);
  const siteUrl = trimUrl(value.siteUrl);
  if (!draftPath || !workerUrl || !siteUrl) return null;
  const target = creatorCloudDraftStatePath();
  const temporary = `${target}.${process.pid}.tmp`;
  const payload = {
    schemaVersion: CREATOR_CLOUD_DRAFT_STATE_SCHEMA,
    draftPath: path.resolve(draftPath),
    workerUrl,
    siteUrl,
    accountHint: String(value.accountHint || '').trim().slice(0, 160) || null,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return payload;
}

export function buildTakuLoginUrl(parsed, context = {}) {
  const siteUrl = resolveAuthSiteUrl(parsed);
  const url = new URL('/profile', siteUrl || DEFAULT_SITE_URL);
  url.searchParams.set('source', 'taku_creator');
  url.searchParams.set('intent', context.intent || 'publish_stax_card');
  url.searchParams.set('worker_url', resolveWorkerUrl(parsed));
  if (context.accountMode === 'confirm' || context.accountMode === 'switch') {
    url.searchParams.set('account_mode', context.accountMode);
  }
  if (context.editorUrl) url.searchParams.set('return_to', context.editorUrl);
  if (context.localAuthChallenge?.state && context.localAuthChallenge?.codeChallenge) {
    url.searchParams.set('auth_flow', 'local_code');
    url.searchParams.set('auth_state', context.localAuthChallenge.state);
    url.searchParams.set('code_challenge', context.localAuthChallenge.codeChallenge);
    url.searchParams.set('code_challenge_method', context.localAuthChallenge.codeChallengeMethod || 'S256');
  }
  return url.toString();
}

export function createPublishStatus(parsed, context = {}) {
  const workerUrl = resolveWorkerUrl(parsed);
  const siteUrl = resolveSiteUrl(parsed);
  const token = Object.hasOwn(context, 'publishToken')
    ? String(context.publishToken || '').trim()
    : readPublishToken(parsed);
  const loginUrl = buildTakuLoginUrl(parsed, context);
  const iconLoginUrl = loginUrl;
  const hasWorkerUrl = Boolean(workerUrl);
  const hasToken = Boolean(token);
  const iconAuthToken = Object.hasOwn(context, 'iconAuthToken')
    ? String(context.iconAuthToken || '').trim()
    : readIconAuthToken(parsed);
  const hasIconAuth = Boolean(iconAuthToken || (!token.startsWith('taku_pub_') && token));
  return {
    ok: true,
    canPublish: hasWorkerUrl && hasToken,
    canGenerateIcons: hasWorkerUrl && hasIconAuth,
    needsAuth: !hasToken,
    needsConfig: hasWorkerUrl ? null : 'worker-url',
    workerUrl,
    siteUrl,
    loginUrl,
    iconLoginUrl,
    authMode: hasToken ? 'local-token' : 'taku-web-login',
    hasIconAuth,
    message: hasToken
      ? 'Ready to publish with this Taku Publisher authorization.'
      : 'Sign in or create a Taku account on Taku Web. After authorization, Taku Web will return to this editor.',
  };
}
