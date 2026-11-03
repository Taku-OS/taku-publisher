import {
  createTakuStaxClient,
  createWorkerPublishError,
} from './publish-client.mjs';
import { cleanText, isRecord, publicHttpUrl } from './privacy.mjs';

const PROFILE_AVATAR_TIMEOUT_MS = 5000;

export async function fetchTakuCreatorProfile({ workerUrl, token, siteUrl }) {
  const staxProfile = await fetchTakuStaxProfile({ workerUrl, token, siteUrl }).catch(error => {
    if (error?.legalAction) throw error;
    return null;
  });
  if (staxProfile?.ok) {
    return {
      ok: true,
      endpoint: staxProfile.endpoint,
      data: staxProfile.data,
      profile: await normalizeTakuCreatorProfile(staxProfile.data, token, workerUrl),
      staxProfile: staxProfile.profile,
    };
  }

  const endpoint = `${workerUrl}/stax/creators/me`;
  const client = createTakuStaxClient({ workerUrl, token, siteUrl });
  const { response, data, parsedJson } = await client.fetchJson('/stax/creators/me', {
    method: 'GET',
  });
  if (response.ok && parsedJson) {
    const retriedStaxProfile = await fetchTakuStaxProfile({ workerUrl, token, siteUrl }).catch(error => {
      if (error?.legalAction) throw error;
      return null;
    });
    if (retriedStaxProfile?.ok) {
      return {
        ok: true,
        endpoint: retriedStaxProfile.endpoint,
        data: retriedStaxProfile.data,
        profile: await normalizeTakuCreatorProfile(retriedStaxProfile.data, token, workerUrl),
        staxProfile: retriedStaxProfile.profile,
        fallbackEndpoint: endpoint,
      };
    }
    return {
      ok: true,
      endpoint,
      data,
      profile: await normalizeTakuCreatorProfile(data, token, workerUrl),
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

export async function fetchTakuStaxProfile({ workerUrl, token, siteUrl }) {
  const endpoint = `${workerUrl}/stax/profile`;
  const client = createTakuStaxClient({ workerUrl, token, siteUrl });
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

export async function normalizeTakuCreatorProfile(value, token = '', workerUrl = '') {
  const jwtPayload = decodeJwtPayload(token);
  const displayName = extractTakuProfileDisplayName(value)
    || extractTakuProfileDisplayName(jwtPayload?.user_metadata)
    || extractTakuProfileDisplayName(jwtPayload);
  const accountAvatarUrl = await resolveTakuProfileAvatarUrl({
    creatorProfile: value,
    token,
    workerUrl,
  });
  const avatarUrl = accountAvatarUrl !== undefined
    ? accountAvatarUrl
    : extractTakuProfileAvatarUrl(jwtPayload?.user_metadata)
      || extractTakuProfileAvatarUrl(jwtPayload);
  return {
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
  };
}

export async function resolveTakuProfileAvatarUrl({ creatorProfile, token, workerUrl }) {
  const accountAvatarUrl = await fetchWorkerUserProfileAvatarUrl(workerUrl, token).catch(
    () => undefined,
  );
  if (accountAvatarUrl !== undefined) return accountAvatarUrl;
  const profileAvatar = extractTakuProfileAvatarState(creatorProfile);
  return profileAvatar.present ? profileAvatar.avatarUrl : undefined;
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

async function fetchWorkerUserProfileAvatarUrl(workerUrl, token) {
  const accessToken = String(token || '').trim();
  const baseUrl = String(workerUrl || '').trim().replace(/\/+$/, '');
  if (!accessToken || !baseUrl) return undefined;
  const response = await fetch(`${baseUrl}/profile/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(PROFILE_AVATAR_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;
  const payload = await response.json().catch(() => null);
  const profile = isRecord(payload) && isRecord(payload.profile) ? payload.profile : null;
  if (!profile || !Object.hasOwn(profile, 'avatar_url')) return undefined;
  if (profile.avatar_url === null) return null;
  return publicHttpUrl(profile.avatar_url);
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

function extractTakuProfileAvatarUrl(value) {
  const candidates = collectProfileAvatarCandidates(value, 0, new Set());
  return candidates[0];
}

function extractTakuProfileAvatarState(value, depth = 0, seen = new Set()) {
  if (depth > 5 || !isRecord(value) || seen.has(value)) {
    return { present: false, avatarUrl: undefined };
  }
  seen.add(value);
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
    if (Object.hasOwn(value, key)) {
      return { present: true, avatarUrl: publicHttpUrl(value[key]) || null };
    }
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
    const state = extractTakuProfileAvatarState(value[key], depth + 1, seen);
    if (state.present) return state;
  }
  return { present: false, avatarUrl: undefined };
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
