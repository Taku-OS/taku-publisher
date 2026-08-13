import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildConverter } from './build-support.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscPath = createRequire(import.meta.url).resolve('typescript/bin/tsc');

await buildConverter({
  projectRoot,
  runCompiler: ({ snapshotTsconfig }) =>
    new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, [tscPath, '--project', snapshotTsconfig], {
        cwd: projectRoot,
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) reject(new Error(`TypeScript compiler exited on signal ${signal}`));
        else resolveExit(code ?? 1);
      });
    }),
});
