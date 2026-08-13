import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listRepositoryFiles, repositoryRoot } from './repository-files.mjs';

const files = await listRepositoryFiles();
const tree = createHash('sha256');

for (const relativePath of files) {
  const bytes = await readFile(path.join(repositoryRoot, relativePath));
  const fileDigest = createHash('sha256').update(bytes).digest('hex');
  tree.update(relativePath);
  tree.update('\0');
  tree.update(fileDigest);
  tree.update('\0');
}

console.log(
  JSON.stringify({
    algorithm: 'sha256',
    fileCount: files.length,
    sourceTreeChecksum: tree.digest('hex'),
  }),
);
