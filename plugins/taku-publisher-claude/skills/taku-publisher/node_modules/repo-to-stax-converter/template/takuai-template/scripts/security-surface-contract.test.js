const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATION_SKILL_FILES = [
  '.agents/skills/taku-action-contract/SKILL.md',
  '.claude/skills/taku-action-contract/SKILL.md',
  '.agents/skills/taku-subapp-development/SKILL.md',
  '.claude/skills/taku-subapp-development/SKILL.md',
  '.agents/skills/taku-subapp-verification/SKILL.md',
  '.claude/skills/taku-subapp-verification/SKILL.md',
];
const PAYLOAD_ROOT = path.join(ROOT_DIR, '.taku-template', 'payload');
const TEMPLATE_MARKER = path.join(ROOT_DIR, '.taku-template.json');
const CANONICAL_CONTRACT_SENTINEL = path.join(ROOT_DIR, 'scripts/check-agent-payload.js');
const IS_CANONICAL_TEMPLATE =
  fs.existsSync(TEMPLATE_MARKER) &&
  fs.existsSync(CANONICAL_CONTRACT_SENTINEL) &&
  fs.lstatSync(TEMPLATE_MARKER).isFile() &&
  !fs.lstatSync(TEMPLATE_MARKER).isSymbolicLink() &&
  fs.lstatSync(CANONICAL_CONTRACT_SENTINEL).isFile() &&
  !fs.lstatSync(CANONICAL_CONTRACT_SENTINEL).isSymbolicLink();
const ACTIVE_GUIDANCE_ROOT = IS_CANONICAL_TEMPLATE ? PAYLOAD_ROOT : ROOT_DIR;
const SKILL_ROOTS = Array.from(new Set([ACTIVE_GUIDANCE_ROOT, ROOT_DIR, PAYLOAD_ROOT])).filter(
  candidateRoot =>
    candidateRoot === ACTIVE_GUIDANCE_ROOT ||
    MIGRATION_SKILL_FILES.some(relativePath =>
      fs.existsSync(path.join(candidateRoot, relativePath))
    )
);

function assertWorkspaceOwnedPath(targetPath) {
  const relativePath = path.relative(ROOT_DIR, targetPath);
  assert.ok(
    relativePath && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..',
    `${targetPath} must be inside the workspace`,
  );

  let currentPath = ROOT_DIR;
  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    assert.equal(
      fs.lstatSync(currentPath).isSymbolicLink(),
      false,
      `${path.relative(ROOT_DIR, currentPath)} must not be a symlink`,
    );
  }

  const workspaceRealPath = fs.realpathSync(ROOT_DIR);
  const targetRealPath = fs.realpathSync(targetPath);
  assert.ok(
    targetRealPath.startsWith(`${workspaceRealPath}${path.sep}`),
    `${targetPath} must resolve inside the workspace`,
  );
}

function readWorkspaceOwnedFile(targetPath) {
  assertWorkspaceOwnedPath(targetPath);
  assert.equal(fs.lstatSync(targetPath).isFile(), true, `${targetPath} must be a regular file`);
  return fs.readFileSync(targetPath, 'utf8');
}

function hasFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const metadata = fs.lstatSync(directoryPath);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    return true;
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true }).some(entry => {
    const entryPath = path.join(directoryPath, entry.name);
    return hasFiles(entryPath);
  });
}

test('canonical template has no unauthenticated filesystem/shell or generic collection API surface', () => {
  if (!IS_CANONICAL_TEMPLATE) {
    assert.equal(
      fs.existsSync(TEMPLATE_MARKER),
      false,
      '.taku-template.json must not remain in a generated SubApp workspace',
    );
  }

  const forbiddenFiles = [
    'src/app/api/actions/route.ts',
    'src/app/api/actions/[action]/route.ts',
    'src/app/api/ai/completion/route.ts',
    'src/app/api/ai/image/generate/route.ts',
    'src/app/api/ai/agent-loop/route.ts',
    'src/app/api/taku/data/[collection]/route.ts',
    'src/app/api/taku/data/[collection]/[id]/route.ts',
    'src/lib/taku-data/useTakuCollection.ts',
    'public/test-gpt41.js',
    'test-api.js',
  ];

  for (const relativePath of forbiddenFiles) {
    assert.equal(
      fs.existsSync(path.join(ROOT_DIR, relativePath)),
      false,
      `${relativePath} must not ship in the canonical SubApp template`,
    );
  }

  assert.equal(
    hasFiles(path.join(ROOT_DIR, 'src/lib/agent-loop')),
    false,
    'src/lib/agent-loop must not ship files in the canonical SubApp template',
  );
  for (const relativePath of ['src/app/api/actions', 'src/app/api/ai']) {
    assert.equal(
      hasFiles(path.join(ROOT_DIR, relativePath)),
      false,
      `${relativePath} must not contain any public capability route`,
    );
  }
});

test('generated skills require domain routes and forbid default raw tool/data surfaces', () => {
  const skillPairs = [
    [
      '.agents/skills/taku-action-contract/SKILL.md',
      '.claude/skills/taku-action-contract/SKILL.md',
    ],
    [
      '.agents/skills/taku-subapp-development/SKILL.md',
      '.claude/skills/taku-subapp-development/SKILL.md',
    ],
    [
      '.agents/skills/taku-subapp-verification/SKILL.md',
      '.claude/skills/taku-subapp-verification/SKILL.md',
    ],
  ];

  for (const relativePath of MIGRATION_SKILL_FILES) {
    assert.equal(
      fs.existsSync(path.join(ACTIVE_GUIDANCE_ROOT, relativePath)),
      true,
      `active generated skill is required: ${relativePath}`,
    );
  }

  for (const skillRoot of SKILL_ROOTS) {
    for (const [agentPath, claudePath] of skillPairs) {
      const agentFile = path.join(skillRoot, agentPath);
      const claudeFile = path.join(skillRoot, claudePath);
      assertWorkspaceOwnedPath(agentFile);
      assertWorkspaceOwnedPath(claudeFile);
      const agentContent = readWorkspaceOwnedFile(agentFile);
      const claudeContent = readWorkspaceOwnedFile(claudeFile);
      assert.equal(agentContent, claudeContent, `${agentPath} mirror drift`);
      if (agentPath.includes('taku-subapp-verification')) {
        assert.match(agentContent, /control token.*local Host transport.*not user identity/is);
        assert.match(agentContent, /server authority contract.*without it.*blocked/is);
        assert.match(agentContent, /Browser mutation remains blocked/is);
        continue;
      }
      assert.match(agentContent, /domain-specific.*Route Handler.*server-only operation/is);
      assert.match(agentContent, /do not expose.*generic collection.*HTTP/is);
      assert.match(agentContent, /do not expose.*filesystem.*shell.*tool.*route/is);
      assert.match(agentContent, /host-authenticated.*authorized.*process-level sandbox/is);
    }
  }
});

test('AI guidance keeps raw model responses server-side', () => {
  const guide = readWorkspaceOwnedFile(path.join(ROOT_DIR, 'docs/proxy-ai-guide.md'));
  assert.match(guide, /aiCompletionJson<unknown>/);
  assert.match(guide, /运行时验证|runtime validation/is);
  assert.match(guide, /稳定的最小响应|stable minimal response/is);
  assert.doesNotMatch(guide, /finalText|finalResponse/);
  assert.doesNotMatch(guide, /rawModelResponse\s*:\s*result\.finalResponse/is);
  assert.doesNotMatch(guide, /fetch\(\s*['"]\/api\/ai/is);
  assert.doesNotMatch(guide, /src\/app\/api\/ai/is);
  assert.match(guide, /Taku-controlled server.*authority.*blocked/is);
  assert.match(guide, /control token.*not.*identity.*billing/is);
});

test('agent loop guidance blocks managed capabilities and browser mutation without server authority', () => {
  const guide = readWorkspaceOwnedFile(path.join(ROOT_DIR, 'docs/agent-loop-guide.md'));
  assert.match(guide, /real.*Taku-controlled server authority contract/is);
  assert.match(guide, /authority contract.*absent.*blocked/is);
  assert.match(guide, /browser.*mutation.*blocked/is);
  assert.doesNotMatch(guide, /Route Handler or Action handler.*call the same operation/is);
});

test('current Action guidance treats the manifest as the sole Host catalog', () => {
  const guide = readWorkspaceOwnedFile(
    path.join(ROOT_DIR, 'docs/subapp-action-architecture.md'),
  );
  const claudeGuide = readWorkspaceOwnedFile(path.join(ACTIVE_GUIDANCE_ROOT, 'CLAUDE.md'));
  const agentsGuide = readWorkspaceOwnedFile(path.join(ACTIVE_GUIDANCE_ROOT, 'AGENTS.md'));

  for (const [name, content] of [
    ['docs/subapp-action-architecture.md', guide],
    ['CLAUDE.md', claudeGuide],
    ['AGENTS.md', agentsGuide],
  ]) {
    assert.doesNotMatch(content, /POST\s+\/api\/actions/is, name);
    assert.doesNotMatch(content, /src\/app\/api\/actions/is, name);
    assert.match(content, /manifest.*sole.*catalog/is, name);
    assert.match(content, /Taku-controlled server.*authority.*blocked/is, name);
    assert.match(content, /control token.*not.*identity.*billing/is, name);
    assert.match(content, /browser.*mutation.*blocked/is, name);
  }
});

test('Action registration root documents authenticated Host RPC lazy loading', () => {
  const registrationRoot = readWorkspaceOwnedFile(
    path.join(ROOT_DIR, 'src/actions/index.ts'),
  );

  assert.doesNotMatch(registrationRoot, /应用启动时.*注册/is);
  assert.match(registrationRoot, /registration root.*仅由认证后的 Host RPC 加载/is);
});
