import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanSecretLikeFiles } from '../src/lib/secret-scan.js';

test('publish scan ignores runner-owned tools and only approves exact template bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'taku-secret-scan-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const routePath = 'src/app/api/taku/rpc/route.test.ts';
  const routeContents = `const ${['TAKU', 'CONTROL', 'TOKEN'].join('_')} = '${[
    'host',
    'control',
    'token',
  ].join('-')}';\n`;
  await mkdir(join(root, 'src/app/api/taku/rpc'), { recursive: true });
  await mkdir(join(root, '.agent-tools/helpers'), { recursive: true });
  await writeFile(join(root, routePath), routeContents);
  await writeFile(
    join(root, '.agent-tools/helpers/start-server.sh'),
    ["CONTROL_", "TOKEN='", 'real-looking-control-', "token-value'\n"].join(''),
  );

  assert.deepEqual(await scanSecretLikeFiles(root), [
    '.agent-tools/helpers/start-server.sh',
    routePath,
  ]);

  const digest = createHash('sha256').update(routeContents).digest('hex');
  assert.deepEqual(
    await scanSecretLikeFiles(root, {
      ignoredDirectories: ['.agent-tools'],
      approvedFileDigests: { [routePath]: digest },
    }),
    [],
  );

  await writeFile(join(root, routePath), `${routeContents}// changed\n`);
  assert.deepEqual(
    await scanSecretLikeFiles(root, {
      ignoredDirectories: ['.agent-tools'],
      approvedFileDigests: { [routePath]: digest },
    }),
    [routePath],
  );
});
