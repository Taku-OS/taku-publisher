import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createInlineSkillPackage,
  preflightInlineSkillPackage,
  scanInlineSkillPackageSource,
} from './skill-package.mjs';

test('allows documentation that mentions env files', () => {
  const findings = scanInlineSkillPackageSource(`
Copy .env.example to .env, then set API_KEY through your shell.
The actual .env file is excluded from the package.
`);

  assert.deepEqual(findings, []);
});

test('allows obvious placeholder bearer tokens', () => {
  const findings = scanInlineSkillPackageSource(
    'curl -H "Authorization: Bearer vrg_sk_your_key_here" https://example.com/api'
  );

  assert.deepEqual(findings, []);
});

test('allows credential parameters populated from environment variables', () => {
  const findings = scanInlineSkillPackageSource(
    'client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)'
  );

  assert.deepEqual(findings, []);
});

test('allows credential function parameters, type annotations, and runtime forwarding', () => {
  const findings = scanInlineSkillPackageSource(`
def call(*, access_token: Optional[str] = None):
    return request(access_token=access_token)
`);

  assert.deepEqual(findings, []);
});

test('allows privacy scanners to declare local-path detection patterns', () => {
  const findings = scanInlineSkillPackageSource(`
USER_PATH_PATTERN = re.compile(r"/Users/[^\\s/]+")
HOME_PATH_PATTERN = re.compile(r"/home/[^\\s/]+")
`);

  assert.deepEqual(findings, []);
});

test('still blocks bearer values that do not look like placeholders', () => {
  const credential = ['vrg', 'sk', '8f4d7c2a1b9e6d3f'].join('-');
  const findings = scanInlineSkillPackageSource(
    `curl -H "Authorization: Bearer ${credential}" https://api.vendor.test/v1`
  );

  assert.ok(['known token format', 'bearer token'].includes(findings[0]?.label));
});

test('normalizes a lowercase skill.md to canonical SKILL.md in the package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-skill-package-'));
  try {
    const skillPath = path.join(root, 'skill.md');
    await fs.writeFile(skillPath, '---\nname: lowercase-skill\ndescription: Test skill\n---\n');
    const item = {
      id: 'local-lowercase-skill',
      name: 'lowercase-skill',
      type: 'skill',
    };
    const privateInventory = {
      items: [{ id: item.id, localPath: skillPath }],
    };

    const pkg = await createInlineSkillPackage(item, privateInventory);

    assert.ok(pkg);
    assert.ok(pkg.files.includes('SKILL.md'));
    assert.ok(!pkg.files.includes('skill.md'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('excludes private runtime state under .temp from a Community Skill package', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taku-skill-package-temp-state-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Safe publisher\n');
  await fs.mkdir(path.join(root, '.temp'));
  await fs.writeFile(
    path.join(root, '.temp', 'publish-work-state.json'),
    JSON.stringify({ sourcePath: path.join(path.sep, 'Users', 'example', 'private-project') }),
  );
  const item = { id: 'safe-publisher', name: 'safe-publisher', type: 'skill' };
  const privateInventory = { items: [{ id: item.id, localPath: root }] };

  const result = await preflightInlineSkillPackage(item, privateInventory);
  const pkg = await createInlineSkillPackage(item, privateInventory);

  assert.equal(result.ok, true);
  assert.ok(pkg.files.includes('SKILL.md'));
  assert.equal(pkg.files.some((file) => file.startsWith('.temp/')), false);
});
