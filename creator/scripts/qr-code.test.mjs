import assert from 'node:assert/strict';
import test from 'node:test';

import { createQrMatrix } from './qr-code.mjs';

test('creates a square QR matrix for a public Stax URL', () => {
  const result = createQrMatrix('https://taku.ai/stax/1784325610');

  assert.equal(result.value, 'https://taku.ai/stax/1784325610');
  assert.equal(result.errorCorrectionLevel, 'M');
  assert.ok(result.size >= 21);
  assert.equal(result.matrix.length, result.size ** 2);
  assert.match(result.matrix, /^[01]+$/);
  assert.equal(result.matrix[0], '1');
  assert.equal(result.matrix[result.size - 1], '1');
  assert.equal(result.matrix[(result.size - 1) * result.size], '1');
});

test('rejects empty QR values and normalizes unsupported correction levels', () => {
  assert.throws(() => createQrMatrix(''), /required/i);
  assert.equal(
    createQrMatrix('https://taku.ai/profile/ldx', { errorCorrectionLevel: 'invalid' }).errorCorrectionLevel,
    'M',
  );
});
