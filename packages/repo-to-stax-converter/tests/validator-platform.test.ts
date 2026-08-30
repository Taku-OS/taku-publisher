import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';

import { normalizeTrustedSystemAlias } from '../src/lib/validator.js';

test('normalizes only the macOS system path aliases', () => {
  const absolute = (...segments: string[]): string => `${sep}${segments.join(sep)}`;
  assert.equal(
    normalizeTrustedSystemAlias(absolute('tmp', 'taku-candidate'), 'darwin'),
    absolute('private', 'tmp', 'taku-candidate')
  );
  assert.equal(
    normalizeTrustedSystemAlias(absolute('var', 'folders', 'taku-candidate'), 'darwin'),
    absolute('private', 'var', 'folders', 'taku-candidate')
  );
  assert.equal(
    normalizeTrustedSystemAlias(absolute('tmp', 'taku-candidate'), 'linux'),
    absolute('tmp', 'taku-candidate')
  );
  assert.equal(
    normalizeTrustedSystemAlias(absolute('home', 'runner', 'work', 'taku-candidate'), 'linux'),
    absolute('home', 'runner', 'work', 'taku-candidate')
  );
});
