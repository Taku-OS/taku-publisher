import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderStaxStudioRuntime } from './editor-renderer.mjs';
import { resolveStudioAssets } from './studio-assets.mjs';
import { splitStudioRuntime } from './sync-stax-studio-template.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../templates/stax-source.json', import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
const handoff = args.find(arg => !arg.startsWith('--'));
if (args.includes('--require-final')) assert.equal(manifest.status, 'final');
if (handoff) {
  const source = path.resolve(handoff);
  for (const [file, expected] of Object.entries(manifest.checksums)) {
    assert.equal(hash(readFileSync(path.join(source, file))), expected, file);
  }
  const parts = splitStudioRuntime(readFileSync(path.join(source, 'stax-studio-runtime.html'), 'utf8'));
  for (const [part, file] of Object.entries({ template: 'stax-app.html', bootstrap: 'stax-bootstrap.js', bridge: 'stax-cloud-bridge.js', cloudStyle: 'stax-cloud.css' })) {
    assert.equal(readFileSync(new URL(`../templates/${file}`, import.meta.url), 'utf8'), parts[part], file);
  }
}
for (const [file, expected] of Object.entries(manifest.assetChecksums || manifest.checksums)) {
  if (file !== 'stax-studio-runtime.html') assert.equal(hash(readFileSync(new URL(`../assets/studio/${file}`, import.meta.url))), expected, file);
}
const standalone = renderStaxStudioRuntime();
assert.equal(resolveStudioAssets(renderStaxStudioRuntime({ externalStudioAssets: true })), standalone);
const hosts = args.includes('--plugins') ? ['codex', 'claude', 'cursor'] : [];
for (const host of hosts) {
  const skill = path.join(root, 'dist/plugins', host, 'taku-publisher/skills/taku-publisher');
  for (const file of Object.keys(manifest.checksums).filter(file => file !== 'stax-studio-runtime.html')) {
    assert.equal(hash(readFileSync(path.join(skill, 'creator/assets/studio', file))), (manifest.assetChecksums || manifest.checksums)[file], `${host}/${file}`);
  }
  const renderer = await import(pathToFileURL(path.join(skill, 'creator/scripts/editor-renderer.mjs')));
  assert.equal(renderer.renderStaxStudioRuntime(), standalone, `${host} renderer`);
  assert.ok(readFileSync(path.join(skill, 'creator/scripts/local-studio-preview.mjs'), 'utf8').includes('localStudioPreviewOrigin'));
}
console.log(JSON.stringify({ ok: true, status: manifest.status, assets: Object.keys(manifest.checksums).length - 1, hosts, equivalent: true }));
