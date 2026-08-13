import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { walkForSkillFiles } from './scan.mjs';

test('walkForSkillFiles stays within the configured result budget', async (t) => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-skill-limit-'));
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }));

  await Promise.all(['one', 'two'].map(async (name) => {
    const directory = path.join(sandbox, name);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'SKILL.md'), `# ${name}\n`);
  }));

  const files = await walkForSkillFiles(sandbox, { maxDepth: 4, maxFiles: 1 });
  assert.equal(files.length, 1);
});
