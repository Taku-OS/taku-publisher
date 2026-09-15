import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSONA_CODES,
  PERSONA_HIDDEN_AVATAR_KEYS,
  PERSONA_TRAIT_AVATAR_KEYS,
} from '#taku-passport-core';

const PERSONA_ASSET_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'persons',
);

export const PERSONA_IMAGE_BINDINGS = Object.freeze({
  rookie: Object.freeze({
    default: 'rookie/rookie.png',
    alt: 'rookie/rookie-alt.png',
  }),
  main: Object.freeze(Object.fromEntries(
    PERSONA_CODES.map((code) => [code, `main/${code}.png`]),
  )),
  hidden: Object.freeze(Object.fromEntries(
    Object.keys(PERSONA_HIDDEN_AVATAR_KEYS).map((id) => [
      id,
      `hidden/${id}.png`,
    ]),
  )),
  traits: Object.freeze(Object.fromEntries(
    Object.keys(PERSONA_TRAIT_AVATAR_KEYS).map((id) => [
      id,
      `traits/${id}.png`,
    ]),
  )),
});

const dataUrlCache = new Map();

function normalizedId(value) {
  return String(value || '').trim().toLowerCase();
}

export function basePersonaImageAsset(code, options = {}) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (normalizedCode === 'ROOKIE') {
    return options.rookieVariant === 'alt'
      ? PERSONA_IMAGE_BINDINGS.rookie.alt
      : PERSONA_IMAGE_BINDINGS.rookie.default;
  }
  return PERSONA_IMAGE_BINDINGS.main[normalizedCode] || '';
}

export function hiddenPersonaImageAsset(id) {
  return PERSONA_IMAGE_BINDINGS.hidden[normalizedId(id)] || '';
}

export function traitPersonaImageAsset(id) {
  return PERSONA_IMAGE_BINDINGS.traits[normalizedId(id)] || '';
}

export function personaAssetDataUrl(relativeAssetPath) {
  const relative = String(relativeAssetPath || '').trim();
  if (!relative) return '';
  if (dataUrlCache.has(relative)) return dataUrlCache.get(relative);

  const absolute = path.resolve(PERSONA_ASSET_ROOT, relative);
  const insideRoot = path.relative(PERSONA_ASSET_ROOT, absolute);
  if (!insideRoot || insideRoot.startsWith('..') || path.isAbsolute(insideRoot)) return '';

  try {
    const dataUrl = `data:image/png;base64,${readFileSync(absolute).toString('base64')}`;
    dataUrlCache.set(relative, dataUrl);
    return dataUrl;
  } catch {
    dataUrlCache.set(relative, '');
    return '';
  }
}

export function basePersonaImageDataUrl(code, options = {}) {
  return personaAssetDataUrl(basePersonaImageAsset(code, options));
}

export function hiddenPersonaImageDataUrl(id) {
  return personaAssetDataUrl(hiddenPersonaImageAsset(id));
}

export function traitPersonaImageDataUrl(id) {
  return personaAssetDataUrl(traitPersonaImageAsset(id));
}
