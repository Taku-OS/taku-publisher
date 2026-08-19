import {
  createTakuStaxClient,
  createWorkerPublishError,
} from './publish-client.mjs';
import { cleanText, isRecord, publicHttpUrl } from './privacy.mjs';

const DEFAULT_TAKU_SUPABASE_URL = 'https://auth.taku.ai';
const DEFAULT_TAKU_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2cXB1c2RvZXJsYmJzeWN3dW52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MzU2OTIsImV4cCI6MjA3MjMxMTY5Mn0.aDD2EJSQvo5ybeVgL9SbbXPlZMCGLyBL5zJzN3eObPo';
const PROFILE_AVATAR_TIMEOUT_MS = 5000;

export async function fetchTakuCreatorProfile({ workerUrl, token }) {
  const staxProfile = await fetchTakuStaxProfile({ workerUrl, token }).catch(() => null);
  if (staxProfile?.ok) {
    return {
      ok: true,
      endpoint: staxProfile.endpoint,
      data: staxProfile.data,
      profile: await normalizeTakuCreatorProfile(staxProfile.data, token),
      staxProfile: staxProfile.profile,
    };
  }

  const endpoint = `${workerUrl}/stax/creators/me`;
  const client = createTakuStaxClient({ workerUrl, token });
  const { response, data, parsedJson } = await client.fetchJson('/stax/creators/me', {
    method: 'GET',
  });
  if (response.ok && parsedJson) {
    const retriedStaxProfile = await fetchTakuStaxProfile({ workerUrl, token }).catch(() => null);
    if (retriedStaxProfile?.ok) {
      return {
        ok: true,
        endpoint: retriedStaxProfile.endpoint,
        data: retriedStaxProfile.data,
        profile: await normalizeTakuCreatorProfile(retriedStaxProfile.data, token),
        staxProfile: retriedStaxProfile.profile,
        fallbackEndpoint: endpoint,
      };
    }
    return {
      ok: true,
      endpoint,
      data,
      profile: await normalizeTakuCreatorProfile(data, token),
    };
  }
  return {
    ok: false,
    status: response.status,
    endpoint,
    error: createWorkerPublishError({ response, data, parsedJson, endpoint }),
    data,
  };
}

export async function fetchTakuStaxProfile({ workerUrl, token }) {
  const endpoint = `${workerUrl}/stax/profile`;
  const client = createTakuStaxClient({ workerUrl, token });
  const { response, data, parsedJson } = await client.fetchJson('/stax/profile', {
    method: 'GET',
  });
  if (response.ok && parsedJson) {
    return {
      ok: true,
      endpoint,
      data,
      profile: unwrapWorkerData(data),
    };
  }
  return {
    ok: false,
    status: response.status,
    endpoint,
    error: createWorkerPublishError({ response, data, parsedJson, endpoint }),
    data,
  };
}

export async function normalizeTakuCreatorProfile(value, token = '') {
  const jwtPayload = decodeJwtPayload(token);
  const displayName = extractTakuProfileDisplayName(value)
    || extractTakuProfileDisplayName(jwtPayload?.user_metadata)
    || extractTakuProfileDisplayName(jwtPayload);
  const avatarUrl = await resolveTakuProfileAvatarUrl({ creatorProfile: value, token })
    || extractTakuProfileAvatarUrl(jwtPayload?.user_metadata)
    || extractTakuProfileAvatarUrl(jwtPayload);
  return {
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export async function resolveTakuProfileAvatarUrl({ creatorProfile, token }) {
  return (await fetchSupabaseUserProfileAvatarUrl(token).catch(() => undefined))
    || extractTakuProfileAvatarUrl(creatorProfile);
}

function unwrapWorkerData(value) {
  const envelope = isRecord(value) ? value : {};
  return isRecord(envelope.data) ? envelope.data : envelope;
}

function extractTakuProfileDisplayName(value) {
  return collectProfileDisplayNames(value, 0, new Set())[0];
}

function collectProfileDisplayNames(value, depth, seen) {
  if (depth > 5 || !isRecord(value) || seen.has(value)) return [];
  seen.add(value);
  const candidates = [];
  for (const key of [
    'displayName',
    'display_name',
    'fullName',
    'full_name',
    'name',
    'username',
    'preferred_username',
    'email',
  ]) {
    const text = cleanText(value[key], 120);
    if (text) candidates.push(text);
  }
  for (const key of [
    'profile',
    'creatorProfile',
    'creator_profile',
    'userProfile',
    'user_profile',
    'creator',
    'user',
    'user_metadata',
    'data',
  ]) {
    candidates.push(...collectProfileDisplayNames(value[key], depth + 1, seen));
  }
  return candidates;
}

async function fetchSupabaseUserProfileAvatarUrl(token) {
  const accessToken = String(token || '').trim();
  const userId = getUserIdFromJwt(accessToken);
  if (!accessToken || !userId) return undefined;
  const supabaseUrl = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) return undefined;
  const url = new URL('/rest/v1/user_profiles', supabaseUrl);
  url.searchParams.set('id', `eq.${userId}`);
  url.searchParams.set('select', 'avatar_url');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(PROFILE_AVATAR_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return publicHttpUrl(row?.avatar_url);
}

function getUserIdFromJwt(token) {
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === 'string' && payload.sub.trim()
    ? payload.sub.trim()
    : undefined;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return undefined;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function resolveSupabaseUrl() {
  return String(
    process.env.TAKU_SUPABASE_URL
    || process.env.SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || DEFAULT_TAKU_SUPABASE_URL
  ).trim().replace(/\/+$/, '');
}

function resolveSupabaseAnonKey() {
  return String(
    process.env.TAKU_SUPABASE_ANON_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || DEFAULT_TAKU_SUPABASE_ANON_KEY
  ).trim();
}

function extractTakuProfileAvatarUrl(value) {
  const candidates = collectProfileAvatarCandidates(value, 0, new Set());
  return candidates[0];
}

function avatarUrlFromRecord(value) {
  if (!isRecord(value)) return undefined;
  for (const key of [
    'avatarUrl',
    'avatar_url',
    'profileAvatarUrl',
    'profile_avatar_url',
    'profileImageUrl',
    'profile_image_url',
    'avatar',
    'imageUrl',
    'image_url',
    'image',
    'photoUrl',
    'photo_url',
    'pictureUrl',
    'picture_url',
    'picture',
  ]) {
    const url = publicHttpUrl(value[key]);
    if (url) return url;
  }
  return undefined;
}

function collectProfileAvatarCandidates(value, depth, seen) {
  if (depth > 5 || !isRecord(value) || seen.has(value)) return [];
  seen.add(value);
  const candidates = [];
  for (const key of [
    'profile',
    'creatorProfile',
    'creator_profile',
    'userProfile',
    'user_profile',
    'creator',
    'user',
    'user_metadata',
    'data',
  ]) {
    const child = value[key];
    const url = publicHttpUrl(child);
    if (url) candidates.push(url);
    candidates.push(...collectProfileAvatarCandidates(child, depth + 1, seen));
  }
  const direct = avatarUrlFromRecord(value);
  if (direct) candidates.push(direct);
  return candidates;
}
