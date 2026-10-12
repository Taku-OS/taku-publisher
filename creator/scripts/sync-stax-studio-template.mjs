import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function normalizeStudioAsset(file, bytes) {
  return file.endsWith('.js')
    ? Buffer.from(bytes.toString('utf8').replaceAll("'../Logo/TakuLogo.svg'", "'/studio/stax-studio-v92-logo-dark.svg'"))
    : bytes;
}

// The website handoff is read-only. Keep the model, credentials and generated
// font/art injections out of the source template; all entry points regenerate
// them through editor-renderer with the caller's display data.
export function splitStudioRuntime(html) {
  const bootstrapStart = html.indexOf('window.__TAKU_STAX_DATA__ = ');
  const bootstrapEnd = html.indexOf('window.__TAKU_STAX_BOOTSTRAP__();', bootstrapStart);
  const functionStart = html.indexOf('window.__TAKU_STAX_BOOTSTRAP__ = function(){', bootstrapStart);
  const bridge = html.match(/<script id="taku-cloud-studio-bridge">([\s\S]*?)<\/script>/);
  const style = html.match(/<style id="taku-cloud-studio-style">([\s\S]*?)<\/style>/);
  if (bootstrapStart < 0 || functionStart < 0 || bootstrapEnd < 0 || !bridge || !style) {
    throw new Error('Studio handoff is missing its bootstrap or cloud bridge.');
  }
  const bootstrap = html.slice(functionStart, bootstrapEnd).trim()
    .replace('Array.isArray(data.selectedKeys) && data.selectedKeys.length', 'Array.isArray(data.selectedKeys)')
    .replace('fullset: selected.length ? selected : ["hero", "team", "type"],', 'fullset: selected,')
    .replace('layout: selected.length ? null : {hero:[2,1],team:[3,0],type:[6,1]},',
      'layout: Array.isArray(data.studioLayout?.blocks) ? Object.fromEntries(data.studioLayout.blocks.map(block => [block.key, [block.cx, block.cy]])) : null,') + '\n';
  let template = html.slice(0, bootstrapStart)
    + '/* __TAKU_STAX_BOOTSTRAP_START__ */\n/* __TAKU_STAX_BOOTSTRAP_END__ */\n'
    + html.slice(bootstrapEnd + 'window.__TAKU_STAX_BOOTSTRAP__();'.length);
  template = template.replace(bridge[0], '<!-- __TAKU_STUDIO_CLOUD_BRIDGE__ -->')
    .replace(style[0], '<!-- __TAKU_STUDIO_CLOUD_STYLE__ -->')
    .replace(/<title>.*?<\/title>/, '<title>Taku · Stax — build & ship</title>')
    .replace(/<link[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>\n?/g, '')
    .replace(/^@font-face[^\n]*src:url\(data:[^\n]*\n/gm, '')
    .replace(/^Object\.assign\(ART, .*\);\n/m, '')
    .replace('social:[1,1]', 'social:[2,1]');
  return { template, bootstrap, bridge: bridge[1].trim()
    .replace('if(!blocks.length)return;', 'if(!layout||!Array.isArray(layout.blocks))return;') + '\n', cloudStyle: style[1].trim() + '\n' };
}

export function syncStudioTemplate(directory, { baseline = false } = {}) {
  const source = path.resolve(directory);
  // Final imports require the website's completion marker. Its checksum list
  // is also preserved in the source manifest for review and equivalence checks.
  const ready = baseline ? null : JSON.parse(readFileSync(path.join(source, '../../READY.json'), 'utf8'));
  const files = [];
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error('Symlinks are not allowed in the Studio handoff.');
    }
  };
  walk(source);
  const checksums = Object.fromEntries(files.sort().map(file => [file, sha256(readFileSync(path.join(source, file)))]));
  if (ready) {
    const declared = new Map((Array.isArray(ready.files) ? ready.files : []).map(entry => [entry.path, entry.sha256]));
    if (declared.size !== files.length) throw new Error('READY.json does not declare the complete Studio handoff.');
    for (const [file, checksum] of Object.entries(checksums)) {
      if (declared.get(`public/studio/${file}`) !== checksum) throw new Error(`Handoff checksum mismatch: ${file}`);
    }
  }
  const parts = splitStudioRuntime(readFileSync(path.join(source, 'stax-studio-runtime.html'), 'utf8'));
  const output = path.join(root, 'templates');
  mkdirSync(output, { recursive: true });
  for (const [name, body] of Object.entries(parts)) {
    const file = { template: 'stax-app.html', bootstrap: 'stax-bootstrap.js', bridge: 'stax-cloud-bridge.js', cloudStyle: 'stax-cloud.css' }[name];
    writeFileSync(path.join(output, file), body);
  }
  const assetChecksums = {};
  for (const file of files.filter(file => file !== 'stax-studio-runtime.html')) {
    const target = path.join(root, 'assets/studio', file);
    mkdirSync(path.dirname(target), { recursive: true });
    const bytes = normalizeStudioAsset(file, readFileSync(path.join(source, file)));
    writeFileSync(target, bytes);
    assetChecksums[file] = sha256(bytes);
  }
  writeFileSync(path.join(output, 'stax-source.json'), JSON.stringify({
    schemaVersion: 'taku.stax.template-source.v1',
    designVersion: '9.2',
    status: baseline ? 'baseline-awaiting-final' : 'final',
    sourceCommit: ready?.commit || ready?.sourceCommit || null,
    checksums,
    assetChecksums,
  }, null, 2) + '\n');
  return { files: files.length, status: baseline ? 'baseline-awaiting-final' : 'final' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node creator/scripts/sync-stax-studio-template.mjs <handoff/public/studio> [--baseline]');
  console.log(JSON.stringify(syncStudioTemplate(directory, { baseline: process.argv.includes('--baseline') })));
}
