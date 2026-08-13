import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function makePackageTempDir(name: string): Promise<string> {
  const root = join(
    process.cwd(),
    'tmp',
    'tests',
    `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  await mkdir(root, { recursive: true });
  return root;
}
