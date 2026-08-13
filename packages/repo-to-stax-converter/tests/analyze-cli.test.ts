import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  analyzeForPublisher,
  REPO_TO_STAX_ANALYZE_PROTOCOL,
  REPO_TO_STAX_CONVERTER_VERSION,
} from '../src/analyze-cli.js';

test('emits the stable Publisher assessment protocol and source snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repo-to-stax-analyze-cli-'));
  try {
    const source = join(root, 'app');
    const workRoot = join(root, 'work');
    await mkdir(join(source, 'app'), { recursive: true });
    await mkdir(workRoot);
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'sample-app', dependencies: { next: '15.0.0' } }),
    );
    await writeFile(join(source, 'app', 'page.tsx'), 'export default function Page() {}');

    const result = await analyzeForPublisher({ input: source, workRoot }) as Record<string, unknown>;
    assert.equal(result.protocol, REPO_TO_STAX_ANALYZE_PROTOCOL);
    assert.equal(result.converterVersion, REPO_TO_STAX_CONVERTER_VERSION);
    const packageManifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    assert.equal(result.converterVersion, packageManifest.version);
    assert.equal(result.sourceCommit, null);
    assert.equal(result.sourceDirty, null);
    assert.match(String(result.sourceDigest), /^sha256:[a-f0-9]{64}$/);
    assert.equal((result.analysis as Record<string, unknown>).appType, 'nextjs');
    assert.equal((result.route as Record<string, unknown>).kind, 'subapp-migration');

    const sourceAfter = await readFile(join(source, 'package.json'), 'utf8');
    assert.match(sourceAfter, /sample-app/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
