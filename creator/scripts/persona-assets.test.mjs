import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PERSONA_IMAGE_BINDINGS,
  basePersonaImageAsset,
  basePersonaImageDataUrl,
  hiddenPersonaImageAsset,
  hiddenPersonaImageDataUrl,
  traitPersonaImageAsset,
  traitPersonaImageDataUrl,
} from './persona-assets.mjs';

const assetRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'persons',
);

test('binds every current persona image to an existing PNG', () => {
  const assets = [
    ...Object.values(PERSONA_IMAGE_BINDINGS.rookie),
    ...Object.values(PERSONA_IMAGE_BINDINGS.main),
    ...Object.values(PERSONA_IMAGE_BINDINGS.hidden),
    ...Object.values(PERSONA_IMAGE_BINDINGS.traits),
  ];

  assert.equal(Object.keys(PERSONA_IMAGE_BINDINGS.main).length, 16);
  assert.equal(Object.keys(PERSONA_IMAGE_BINDINGS.hidden).length, 8);
  assert.equal(Object.keys(PERSONA_IMAGE_BINDINGS.traits).length, 8);
  for (const asset of assets) {
    assert.equal(existsSync(path.resolve(assetRoot, asset)), true, asset);
  }
});

test('resolves base, rookie, hidden, and trait persona images', () => {
  assert.equal(basePersonaImageAsset('AILW'), 'main/AILW.png');
  assert.equal(basePersonaImageAsset('rookie'), 'rookie/rookie.png');
  assert.equal(basePersonaImageAsset('ROOKIE', { rookieVariant: 'alt' }), 'rookie/rookie-alt.png');
  assert.equal(hiddenPersonaImageAsset('insomniac-daywalker'), 'hidden/insomniac-daywalker.png');
  assert.equal(traitPersonaImageAsset('token-tycoon'), 'traits/token-tycoon.png');
  assert.equal(traitPersonaImageAsset('flow-state'), '');

  assert.match(basePersonaImageDataUrl('AILW'), /^data:image\/png;base64,/);
  assert.match(hiddenPersonaImageDataUrl('architect'), /^data:image\/png;base64,/);
  assert.match(traitPersonaImageDataUrl('polyglot'), /^data:image\/png;base64,/);
});
