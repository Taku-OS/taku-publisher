import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { renderStaxStudioRuntime } from './editor-renderer.mjs';

const output = process.argv[2];
if (!output) {
  throw new Error('Usage: node creator/scripts/export-stax-studio-runtime.mjs <output.html>');
}

const resolved = path.resolve(output);
mkdirSync(path.dirname(resolved), { recursive: true });
const externalStudioAssets = process.argv.includes('--with-assets');
if (externalStudioAssets) {
  cpSync(new URL('../assets/studio/', import.meta.url), path.dirname(resolved), { recursive: true });
}
writeFileSync(resolved, renderStaxStudioRuntime({ externalStudioAssets }), 'utf8');
console.log(resolved);
