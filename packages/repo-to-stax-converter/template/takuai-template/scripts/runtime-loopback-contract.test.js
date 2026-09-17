const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

function source(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('preview and edit runtimes bind, probe, and advertise loopback only', () => {
  const preview = source('scripts/start-preview.js');
  const edit = source('scripts/start-edit.js');
  const nextConfig = source('next.config.ts');

  assert.match(preview, /const url = `http:\/\/127\.0\.0\.1:\$\{port\}`/);
  assert.match(edit, /const url = `http:\/\/127\.0\.0\.1:\$\{port\}`/);
  assert.match(
    preview,
    /\['run', 'start', '-p', String\(port\), '-H', '127\.0\.0\.1'\]/
  );
  assert.match(edit, /\['run', 'dev', '-p', String\(port\), '-H', '127\.0\.0\.1'\]/);
  assert.match(
    nextConfig,
    /`http:\/\/127\.0\.0\.1:\$\{port\}\/__taku\/host-attestation\/verify`/
  );

  for (const runtimeSource of [preview, edit]) {
    assert.doesNotMatch(runtimeSource, /http:\/\/localhost:\$\{port\}/);
  }
  assert.doesNotMatch(nextConfig, /http:\/\/localhost:\$\{port\}/);
});

test('preview and edit prewarm the fixed Host attestation route before READY', () => {
  const preview = source('scripts/start-preview.js');
  const edit = source('scripts/start-edit.js');
  const nextConfig = source('next.config.ts');

  for (const runtimeSource of [preview, edit]) {
    assert.match(
      runtimeSource,
      /const HOST_ATTESTATION_PATH = '\/__taku\/host-attestation\/verify'/
    );
    assert.match(runtimeSource, /method: 'POST'/);
    assert.match(runtimeSource, /body: '\{\}'/);
    const warmup = runtimeSource.indexOf(
      'const attestationReady = await warmHostAttestationRoute(url, child)'
    );
    const ready = runtimeSource.indexOf("log(colors.green, '[TAKUAI-READY]'");
    assert.ok(warmup >= 0 && warmup < ready);
  }

  assert.match(nextConfig, /method: 'POST'/);
  assert.match(nextConfig, /body: '\{\}'/);
  assert.match(nextConfig, /response\.status === 401 \|\| response\.status === 503/);
});

test('Host attestation has an explicit fixed rewrite without a guessed frame policy', () => {
  const nextConfig = source('next.config.ts');
  const fixedSource = "source: '/__taku/host-attestation/verify'";
  const fixedDestination = "destination: '/api/taku/host-attestation/verify'";
  const wildcardSource = "source: '/__taku/:path*'";

  assert.ok(nextConfig.includes(fixedSource));
  assert.ok(nextConfig.includes(fixedDestination));
  assert.ok(nextConfig.indexOf(fixedSource) < nextConfig.indexOf(wildcardSource));
  assert.doesNotMatch(nextConfig, /frame-ancestors/i);
});
