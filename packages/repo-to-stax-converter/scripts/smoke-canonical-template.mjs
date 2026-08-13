import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertRepoToStax } from '../dist/lib/converter.js';
import { pathExists } from '../dist/lib/fs.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const explicit = process.env.TAKU_TEMPLATE_ROOT?.trim();
const candidates = [
  explicit,
  resolve(packageRoot, '..', 'takuai-template-main'),
  resolve(packageRoot, '..', 'template'),
].filter(Boolean);
let templateRoot = null;
for (const candidate of candidates) {
  if (await pathExists(candidate)) {
    templateRoot = candidate;
    break;
  }
}
if (!templateRoot) {
  throw new Error('Canonical template not found. Set TAKU_TEMPLATE_ROOT to its local checkout.');
}

const outputRoot = await mkdtemp(join(tmpdir(), 'repo-to-stax-smoke-'));
try {
  const reports = [];
  for (const fixture of [
    { directory: 'nextjs', name: 'canonical-next-smoke' },
    { directory: 'vite-react', name: 'canonical-vite-smoke' },
  ]) {
    const result = await convertRepoToStax({
      input: resolve(packageRoot, 'tests', 'fixtures', fixture.directory),
      outputRoot,
      templateRoot,
      name: fixture.name,
    });
    const provenance = JSON.parse(
      await readFile(join(result.workspaceRoot, '.taku', 'migration.json'), 'utf8')
    );
    if (!result.workspaceValidation.ok || provenance.template.version !== '0.3.2') {
      throw new Error(`Canonical ${fixture.directory} smoke did not satisfy the workspace contract.`);
    }
    reports.push({
      fixture: fixture.directory,
      templateVersion: provenance.template.version,
      templateCommit: provenance.template.commit,
      templateDirty: provenance.template.dirty,
      validationLevel: result.workspaceValidation.level,
    });
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        templateRoot,
        reports,
      },
      null,
      2
    )
  );
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
