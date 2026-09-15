import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { PERSONA_CODES } from '#taku-passport-core';
import { publicHttpUrl } from './privacy.mjs';
import { createTakuStaxClient } from './publish-client.mjs';

const DEFAULT_PERSONA_AVATAR_DIR = path.join(os.homedir(), 'Downloads', 'avatars');
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_EXTENSIONS = ['.webp', '.png', '.jpg', '.jpeg'];
const MIME_BY_EXTENSION = new Map([
  ['.webp', 'image/webp'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);
const STANDARD_PERSONA_CODES = new Set(PERSONA_CODES.map((code) => String(code).toUpperCase()));

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function creatorPersonaAvatarDir() {
  return path.resolve(stringValue(process.env.TAKU_PERSONA_AVATAR_DIR) || DEFAULT_PERSONA_AVATAR_DIR);
}

export function personaCodeForAvatar(draft = {}) {
  return stringValue(
    draft?.builderProfileSnapshot?.persona?.code
    || draft?.builderProfileSnapshot?.persona?.basePersona?.code
    || draft?.personaV2?.code
    || draft?.personaV2?.identity?.basePersona?.code
    || draft?.stats?.personaCode
  ).toUpperCase();
}

export async function findPersonaAvatarFile(code, options = {}) {
  const normalizedCode = stringValue(code).toUpperCase();
  if (!STANDARD_PERSONA_CODES.has(normalizedCode)) return null;
  const avatarDir = path.resolve(stringValue(options.avatarDir) || creatorPersonaAvatarDir());
  for (const extension of AVATAR_EXTENSIONS) {
    const filePath = path.join(avatarDir, `${normalizedCode}${extension}`);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        return {
          code: normalizedCode,
          filePath,
          extension,
          contentType: MIME_BY_EXTENSION.get(extension) || 'application/octet-stream',
          size: stat.size,
        };
      }
    } catch {
      // Try the next supported extension.
    }
  }
  return null;
}

export function userIdFromJwt(token) {
  try {
    const [, payload] = String(token || '').split('.');
    if (!payload) return '';
    const parsed = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return stringValue(parsed?.sub);
  } catch {
    return '';
  }
}

async function uploadSignedAvatar({ client, signedUrl, body, contentType }) {
  const response = await client.fetchImpl(signedUrl, {
    method: 'PUT',
    headers: {
      'cache-control': 'max-age=3600',
      'content-type': contentType,
      'x-upsert': 'false',
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Avatar upload failed with HTTP ${response.status}`);
  }
}

export async function uploadPersonaAvatarForDraft({
  draft,
  workerUrl,
  token,
  avatarDir,
  client,
} = {}) {
  const code = personaCodeForAvatar(draft);
  if (!STANDARD_PERSONA_CODES.has(code)) {
    return {
      ok: true,
      skipped: true,
      reason: code ? 'unsupported_persona_code' : 'missing_persona_code',
      code,
    };
  }

  const avatarFile = await findPersonaAvatarFile(code, { avatarDir });
  if (!avatarFile) {
    return {
      ok: true,
      skipped: true,
      reason: 'missing_local_persona_avatar',
      code,
      avatarDir: path.resolve(stringValue(avatarDir) || creatorPersonaAvatarDir()),
    };
  }
  if (avatarFile.size <= 0) {
    return {
      ok: false,
      code,
      error: `Persona avatar ${code} is empty.`,
    };
  }
  if (avatarFile.size > MAX_AVATAR_BYTES) {
    return {
      ok: false,
      code,
      error: `Persona avatar ${code} exceeds the 5 MB upload limit.`,
    };
  }

  const authToken = stringValue(token);
  const userId = userIdFromJwt(authToken);
  if (!authToken || !userId) {
    return {
      ok: true,
      skipped: true,
      reason: 'avatar_upload_requires_user_session',
      code,
    };
  }

  const staxClient = client || createTakuStaxClient({ workerUrl, token: authToken });
  const storagePath = `${userId}/persona-${code.toLowerCase()}-${Date.now()}-${randomUUID()}${avatarFile.extension}`;
  const signed = await staxClient.requestJson('/profile/avatar/signed-upload', {
    method: 'POST',
    body: JSON.stringify({ path: storagePath }),
  }, { token: authToken });
  const signedUrl = stringValue(signed.signedUrl || signed.signed_url);
  const publicUrl = publicHttpUrl(signed.publicUrl || signed.public_url);
  if (!signedUrl || !publicUrl) {
    return {
      ok: false,
      code,
      error: 'Taku did not return a usable avatar upload URL.',
    };
  }

  const bytes = await fs.readFile(avatarFile.filePath);
  await uploadSignedAvatar({
    client: staxClient,
    signedUrl,
    body: bytes,
    contentType: avatarFile.contentType,
  });

  return {
    ok: true,
    code,
    avatarUrl: publicUrl,
    source: 'local-persona-avatar',
  };
}
