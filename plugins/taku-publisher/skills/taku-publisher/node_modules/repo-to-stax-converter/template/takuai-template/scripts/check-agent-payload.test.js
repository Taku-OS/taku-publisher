const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  checkAgentPayload,
  computeBundleSha256,
  validateBundleDirectoryNames,
} = require('./check-agent-payload');

const ROOT_DIR = path.resolve(__dirname, '..');
const EXPECTED_SUPERPOWERS_BUNDLE_SHA256 =
  'sha256:bd4810288fa17c0f697f638a5041b55a370b9e76b16d61adc56f59f869c72fe9';
const EXPECTED_EXECUTABLE_HELPERS = [
  'skills/brainstorming/scripts/start-server.sh',
  'skills/brainstorming/scripts/stop-server.sh',
  'skills/subagent-driven-development/scripts/review-package',
  'skills/subagent-driven-development/scripts/sdd-workspace',
  'skills/subagent-driven-development/scripts/task-brief',
  'skills/systematic-debugging/find-polluter.sh',
  'skills/writing-skills/render-graphs.js',
];

function createAgentPayloadFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-agent-payload-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.cpSync(
    path.join(ROOT_DIR, '.taku-template', 'payload'),
    path.join(rootDir, '.taku-template', 'payload'),
    { recursive: true }
  );
  return rootDir;
}

function createGeneratedSecurityFixture(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-generated-security-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));

  const generatedFiles = [
    ['scripts/security-surface-contract.test.js', 'scripts/security-surface-contract.test.js'],
    ['src/actions/index.ts', 'src/actions/index.ts'],
    ['docs/agent-loop-guide.md', 'docs/agent-loop-guide.md'],
    ['docs/proxy-ai-guide.md', 'docs/proxy-ai-guide.md'],
    ['docs/subapp-action-architecture.md', 'docs/subapp-action-architecture.md'],
    ['.taku-template/payload/CLAUDE.md', 'CLAUDE.md'],
    ['.taku-template/payload/AGENTS.md', 'AGENTS.md'],
  ];
  for (const [sourcePath, relativePath] of generatedFiles) {
    const source = path.join(ROOT_DIR, sourcePath);
    const destination = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  for (const mirror of ['.agents', '.claude']) {
    fs.cpSync(
      path.join(ROOT_DIR, '.taku-template', 'payload', mirror),
      path.join(rootDir, mirror),
      { recursive: true }
    );
  }

  return rootDir;
}

function runGeneratedSecurityContract(fixtureRoot) {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(fixtureRoot, 'scripts/security-surface-contract.test.js')],
    { cwd: fixtureRoot, encoding: 'utf8' }
  );
}

function computeFixtureBundleSha256(root) {
  const entries = [];
  const visit = (directory, relativeDirectory = '') => {
    const children = fs.readdirSync(directory, { withFileTypes: true });
    if (children.length === 0) {
      throw new Error(`empty directory: ${relativeDirectory || '.'}`);
    }
    for (const child of children) {
      const absolutePath = path.join(directory, child.name);
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      const metadata = fs.lstatSync(absolutePath);
      if (metadata.isDirectory()) {
        entries.push({
          type: 0x44,
          mode: 0o040000,
          path: Buffer.from(relativePath),
          content: Buffer.alloc(0),
        });
        visit(absolutePath, relativePath);
      } else {
        entries.push({
          type: 0x46,
          mode: (metadata.mode & 0o111) !== 0 ? 0o100755 : 0o100644,
          path: Buffer.from(relativePath),
          content: fs.readFileSync(absolutePath),
        });
      }
    }
  };
  visit(root);
  entries.sort((left, right) => Buffer.compare(left.path, right.path));

  const hash = crypto.createHash('sha256');
  const encodeLength = value => {
    const encoded = Buffer.alloc(8);
    encoded.writeBigUInt64BE(BigInt(value));
    return encoded;
  };
  const encodeMode = value => {
    const encoded = Buffer.alloc(4);
    encoded.writeUInt32BE(value);
    return encoded;
  };
  hash.update(Buffer.from('TAKU_SUPERPOWERS_BUNDLE\0v3\0'));
  for (const entry of entries) {
    hash.update(Buffer.from([entry.type]));
    hash.update(encodeMode(entry.mode));
    hash.update(encodeLength(entry.path.length));
    hash.update(entry.path);
    hash.update(encodeLength(entry.content.length));
    hash.update(entry.content);
  }
  return `sha256:${hash.digest('hex')}`;
}

test('generated SubApps receive discoverable Taku skills and a pinned Superpowers bundle', () => {
  const report = checkAgentPayload(ROOT_DIR);
  const superpowersRoot = path.join(
    ROOT_DIR,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );

  assert.deepEqual(report.takuSkills, [
    'taku-action-contract',
    'taku-subapp-development',
    'taku-subapp-verification',
    'using-superpowers',
  ]);
  assert.equal(report.superpowersVersion, '6.2.0');
  assert.equal(report.superpowersBundleSha256, EXPECTED_SUPERPOWERS_BUNDLE_SHA256);
  assert.equal(
    computeFixtureBundleSha256(superpowersRoot),
    EXPECTED_SUPERPOWERS_BUNDLE_SHA256,
    'independent bundle digest must match the audited checker pin'
  );
  const bundleManifest = JSON.parse(
    fs.readFileSync(
      path.join(ROOT_DIR, '.taku-template/payload/.agent-tools/superpowers/manifest.json'),
      'utf8'
    )
  );
  assert.equal(report.superpowersBundleSha256, bundleManifest.bundleSha256);
  assert.ok(report.superpowersSkills.includes('test-driven-development'));
  assert.ok(report.superpowersSkills.includes('verification-before-completion'));
  assert.equal(report.internalGuidanceLeaks.length, 0);
});

test('generated security contract runs after template payload cleanup', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('generated security contract checks root skills even when a template payload remains', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  fs.cpSync(
    path.join(ROOT_DIR, '.taku-template', 'payload'),
    path.join(fixtureRoot, '.taku-template', 'payload'),
    { recursive: true }
  );
  fs.appendFileSync(
    path.join(fixtureRoot, '.agents/skills/taku-action-contract/SKILL.md'),
    '\nroot-only drift\n'
  );

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'root skill drift must fail even with a nested payload');
});

test('generated security contract rejects missing active skills even when a template payload remains', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  fs.cpSync(
    path.join(ROOT_DIR, '.taku-template', 'payload'),
    path.join(fixtureRoot, '.taku-template', 'payload'),
    { recursive: true }
  );
  fs.rmSync(path.join(fixtureRoot, '.agents'), { recursive: true, force: true });
  fs.rmSync(path.join(fixtureRoot, '.claude'), { recursive: true, force: true });

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'nested payload must not mask missing active root skills');
});

test('generated security contract rejects a residual canonical marker', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  fs.cpSync(
    path.join(ROOT_DIR, '.taku-template', 'payload'),
    path.join(fixtureRoot, '.taku-template', 'payload'),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(ROOT_DIR, '.taku-template.json'),
    path.join(fixtureRoot, '.taku-template.json')
  );

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'a generated workspace must reject the template marker');
});

test('generated security contract rejects every public Action or AI route subtree', async t => {
  for (const relativePath of [
    'src/app/api/actions/run/route.ts',
    'src/app/api/ai/chat/route.ts',
  ]) {
    await t.test(relativePath, fixtureTest => {
      const fixtureRoot = createGeneratedSecurityFixture(fixtureTest);
      const routePath = path.join(fixtureRoot, relativePath);
      fs.mkdirSync(path.dirname(routePath), { recursive: true });
      fs.writeFileSync(routePath, 'export async function POST() {}\n');

      const result = runGeneratedSecurityContract(fixtureRoot);

      assert.notEqual(result.status, 0, `${relativePath} must be rejected`);
    });
  }
});

test('generated security contract rejects skill mirrors that escape through symlinks', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-external-skills-'));
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }));
  const externalAgents = path.join(externalRoot, '.agents');
  fs.cpSync(path.join(fixtureRoot, '.agents'), externalAgents, { recursive: true });
  fs.rmSync(path.join(fixtureRoot, '.agents'), { recursive: true, force: true });
  fs.symlinkSync(externalAgents, path.join(fixtureRoot, '.agents'), 'dir');

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'skill mirrors must stay inside the generated workspace');
});

test('generated security contract rejects authority guidance that escapes through symlinks', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-external-guidance-'));
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }));
  const externalGuide = path.join(externalRoot, 'proxy-ai-guide.md');
  fs.copyFileSync(path.join(fixtureRoot, 'docs/proxy-ai-guide.md'), externalGuide);
  fs.rmSync(path.join(fixtureRoot, 'docs/proxy-ai-guide.md'));
  fs.symlinkSync(externalGuide, path.join(fixtureRoot, 'docs/proxy-ai-guide.md'));

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'authority guidance must stay inside the workspace');
});

test('generated security contract rejects a verification skill file symlink', t => {
  const fixtureRoot = createGeneratedSecurityFixture(t);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taku-external-verification-'));
  t.after(() => fs.rmSync(externalRoot, { recursive: true, force: true }));
  const relativeSkill = '.agents/skills/taku-subapp-verification/SKILL.md';
  const externalSkill = path.join(externalRoot, 'SKILL.md');
  fs.copyFileSync(path.join(fixtureRoot, relativeSkill), externalSkill);
  fs.rmSync(path.join(fixtureRoot, relativeSkill));
  fs.symlinkSync(externalSkill, path.join(fixtureRoot, relativeSkill));

  const result = runGeneratedSecurityContract(fixtureRoot);

  assert.notEqual(result.status, 0, 'the verification skill must stay inside the workspace');
});

test('generated Action guidance requires recursively static registerAction definitions', () => {
  const skillPaths = [
    '.taku-template/payload/.agents/skills/taku-action-contract/SKILL.md',
    '.taku-template/payload/.claude/skills/taku-action-contract/SKILL.md',
  ];

  for (const relativePath of skillPaths) {
    const content = fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
    assert.match(content, /recursively static object literal/i, relativePath);
    assert.match(content, /no spreads, imported constants, computed values, or helper calls/i, relativePath);
    assert.match(content, /arrays such as `enum` must list their literal values directly/i, relativePath);
  }
});

test('generated Action guidance requires executable result contracts and one shared domain mutation', () => {
  const skillPaths = [
    '.taku-template/payload/.agents/skills/taku-action-contract/SKILL.md',
    '.taku-template/payload/.claude/skills/taku-action-contract/SKILL.md',
  ];
  const contents = skillPaths.map(relativePath => fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));

  assert.equal(contents[0], contents[1], 'Action contract guidance mirrors must be byte-identical');

  for (const [index, content] of contents.entries()) {
    const relativePath = skillPaths[index];
    assert.match(content, /public Action.*contract test.*real handler.*actual returned `data` shape.*nesting/is, relativePath);
    assert.match(content, /registration definition.*manifest semantics/is, relativePath);
    assert.match(content, /each domain mutation.*one server-only operation.*input validation.*durable write/is, relativePath);
    assert.match(content, /Route Handler.*Action handler.*same operation/is, relativePath);
    assert.match(content, /domain-specific.*Route Handler.*server-only operation/is, relativePath);
    assert.match(content, /do not expose.*generic collection.*HTTP/is, relativePath);
    assert.match(content, /do not expose.*filesystem.*shell.*tool.*route/is, relativePath);
    assert.match(content, /host-authenticated.*authorized.*process-level sandbox/is, relativePath);
    assert.match(content, /import.*@\/actions\/index.*real.*registry/is, relativePath);
    assert.match(content, /do not ship.*\/api\/actions/is, relativePath);
    assert.match(content, /do not ship.*\/api\/ai/is, relativePath);
    assert.match(content, /Taku-controlled server.*authority.*blocked/is, relativePath);
  }
});

test('generated development guidance preserves transformations, accessible custom interaction, focused contracts, and honest no-shell Biome review', () => {
  const skillPaths = [
    '.taku-template/payload/.agents/skills/taku-subapp-development/SKILL.md',
    '.taku-template/payload/.claude/skills/taku-subapp-development/SKILL.md',
  ];
  const contents = skillPaths.map(relativePath => fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));

  assert.equal(contents[0], contents[1], 'development guidance mirrors must be byte-identical');

  for (const [index, content] of contents.entries()) {
    const relativePath = skillPaths[index];
    assert.match(content, /round-trip.*information loss|reject.*before mutation/is, relativePath);
    assert.match(content, /focused.*round-trip.*contract test/is, relativePath);
    assert.match(
      content,
      /each accepted token boundary.*cross-boundary combinations.*parse.*serialize.*parse.*deep.*equivalent/is,
      relativePath
    );
    assert.match(content, /empty.*whitespace-only.*leading.*trailing whitespace/is, relativePath);
    assert.match(content, /structural tokens.*quoted fields.*compact.*operator variant/is, relativePath);
    assert.match(
      content,
      /parser.*accepts.*exact semantic value.*serializer.*reject.*before persistence/is,
      relativePath
    );
    assert.match(content, /no symmetric escape.*reject.*before.*mutation/is, relativePath);
    assert.match(content, /diagnostics.*not.*persistable success/is, relativePath);
    assert.match(content, /every relevant representation.*consumer/is, relativePath);
    assert.match(content, /every mutation.*durable writer.*side-effect boundary.*never called/is, relativePath);
    assert.match(content, /keyboard.*focus.*announced state/is, relativePath);
    assert.match(content, /dynamic read-only visualizations.*textual summary.*announce meaningful updates/is, relativePath);
    assert.ok(
      content.includes(
        'Every `data-slot` must be a quoted static string literal; never use a variable, template expression, conditional expression, or spread.'
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        'Relationship IDs must come from React `useId()` values for label, ARIA, and SVG definition/reference pairs; never use static string literals, random values, data-derived values, or indexes for those relationships.'
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        'Render a live computed status or result with semantic `<output>` when it is the result of user input.'
      ),
      relativePath
    );
    assert.match(content, /dirty draft.*confirmation.*latest request wins/is, relativePath);
    assert.match(content, /latest request wins.*independently refreshed resource/is, relativePath);
    assert.match(content, /stale success.*failure.*current screen/is, relativePath);
    assert.match(content, /persisted baseline.*edits typed after.*request/is, relativePath);
    assert.match(content, /out-of-order promises.*executable tests/is, relativePath);
    assert.match(content, /shared domain limits.*before persistence.*rendering/is, relativePath);
    assert.match(content, /reuse.*same constants.*UI controls/is, relativePath);
    assert.match(content, /maximum-size inputs/is, relativePath);
    assert.match(
      content,
      /fan-out.*before allocation.*node.*edge.*budget.*input length/is,
      relativePath
    );
    assert.match(
      content,
      /graph.*renderer.*when.*domain supports.*cycles.*self-references.*layout bounds/is,
      relativePath
    );
    assert.match(content, /useId\(\).*label.*ARIA.*SVG/is, relativePath);
    assert.match(content, /formatting.*imports.*import type.*unused symbols/is, relativePath);
    assert.ok(
      content.includes('Complete a manual import order and formatting audit before handoff.'),
      relativePath
    );
    assert.match(content, /no-shell Biome self-review/i, relativePath);
    assert.match(content, /do not claim.*Biome.*ran/is, relativePath);
    assert.match(content, /unexecuted test.*not coverage.*do not pass.*verification gate.*executing it/is, relativePath);
    assert.ok(
      content.includes(
        'Without executable tests, do not claim a spatial or algorithmic bug is fixed from inspection alone. Manually calculate at least one non-square counterexample for every axis or direction and one cyclic or self-referential case, while keeping the gate unpassed until execution.'
      ),
      relativePath
    );
    assert.match(content, /random.*data-derived.*index/i, relativePath);
    assert.match(content, /domain-specific.*Route Handler.*server-only operation/is, relativePath);
    assert.match(content, /do not expose.*generic collection.*HTTP/is, relativePath);
    assert.match(content, /do not expose.*filesystem.*shell.*tool.*route/is, relativePath);
    assert.match(content, /host-authenticated.*authorized.*process-level sandbox/is, relativePath);
    assert.match(content, /do not ship.*\/api\/actions/is, relativePath);
    assert.match(content, /do not ship.*\/api\/ai/is, relativePath);
    assert.match(content, /Taku-controlled server.*authority.*blocked/is, relativePath);
    assert.ok(
      content.includes(
        'When managed authority is blocked, keep the managed operation visibly blocked and implement the maximum safe local read-only preparation, analysis, or exportable artifact that preserves product value. A catalog of disabled controls is not a workflow. Never fake managed output.'
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        "The local artifact must derive only from user-provided or already-authorized local data and be labeled as preparation or analysis, never as the managed operation's result."
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        'Before coding, name one primary safe workflow from the capability matrix and make the page use the same domain code that its executable product test exercises.'
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        'A blocked, readiness, status-only, or capability-reporting Action does not satisfy the core workflow smoke gate.'
      ),
      relativePath
    );
    assert.ok(
      content.includes(
        "When browser smoke cannot run, extract the primary local workflow's domain transformation or state transition, cover successful and rejected inputs in an executable test, and leave browser behavior explicitly unverified."
      ),
      relativePath
    );
  }
});

test('rejects a modified Superpowers bundle even when its manifest checksum is recomputed', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  const manifestFile = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/manifest.json'
  );
  const readmeFile = path.join(superpowersRoot, 'README.md');
  fs.appendFileSync(readmeFile, '\nunaudited bundle mutation\n');

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.bundleSha256 = computeFixtureBundleSha256(superpowersRoot);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () => checkAgentPayload(fixtureRoot),
    /trusted Superpowers 6\.2\.0 bundle checksum mismatch/
  );
});

test('rejects a bundle entry-boundary collision that preserved the legacy digest', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  const licenseFile = path.join(superpowersRoot, 'LICENSE');
  const readmeFile = path.join(superpowersRoot, 'README.md');
  const mergedLicense = Buffer.concat([
    fs.readFileSync(licenseFile),
    Buffer.from('\0README.md\0'),
    fs.readFileSync(readmeFile),
  ]);
  fs.writeFileSync(licenseFile, mergedLicense);
  fs.rmSync(readmeFile);

  assert.throws(
    () => checkAgentPayload(fixtureRoot),
    /trusted Superpowers 6\.2\.0 bundle checksum mismatch/
  );
});

test('rejects empty directories inside the pinned Superpowers bundle', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  fs.mkdirSync(
    path.join(fixtureRoot, '.taku-template/payload/.agent-tools/superpowers/6.2.0/empty')
  );

  assert.throws(() => checkAgentPayload(fixtureRoot), /empty directory is not allowed/);
});

test('rejects sibling entries beside the pinned Superpowers bundle and manifest', async t => {
  const invalidSiblings = [
    ['extra version', '6.2.1/loader.js'],
    ['extra loader', 'loader.js'],
  ];

  for (const [label, relativePath] of invalidSiblings) {
    await t.test(label, fixtureTest => {
      const fixtureRoot = createAgentPayloadFixture(fixtureTest);
      const extraFile = path.join(
        fixtureRoot,
        '.taku-template/payload/.agent-tools/superpowers',
        relativePath
      );
      fs.mkdirSync(path.dirname(extraFile), { recursive: true });
      fs.writeFileSync(extraFile, 'untrusted loader\n');

      assert.throws(
        () => checkAgentPayload(fixtureRoot),
        /Superpowers directory entries must be exactly/
      );
    });
  }
});

test('rejects non-portable path segments before hashing a bundle', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  fs.writeFileSync(path.join(superpowersRoot, 'bad\nname.md'), 'invalid path\n');

  assert.throws(() => computeBundleSha256(superpowersRoot), /non-portable bundle path/);
});

test('canonical hash accepts NFC UTF-8 names and internal spaces', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  fs.writeFileSync(path.join(superpowersRoot, 'é.md'), 'NFC UTF-8\n');
  fs.writeFileSync(path.join(superpowersRoot, 'file name.md'), 'internal space\n');

  assert.match(computeBundleSha256(superpowersRoot), /^sha256:[a-f0-9]{64}$/);
});

test('rejects invalid UTF-8 and non-NFC raw path names', () => {
  assert.throws(
    () => validateBundleDirectoryNames([Buffer.from([0xff, 0xfe])], '.'),
    /valid UTF-8/
  );
  assert.throws(
    () => validateBundleDirectoryNames([Buffer.from('e\u0301.md')], '.'),
    /NFC normalized/
  );
});

test('rejects Windows-unsafe and control-character path names', async t => {
  const invalidNames = [
    ['Windows forbidden character', 'bad:name.md', /Windows-forbidden/],
    ['control character', 'bad\nname.md', /control character/],
    ['reserved basename with extension', 'CON.txt', /reserved Windows basename/],
    ['reserved mixed-case basename', 'lPt9.log', /reserved Windows basename/],
    ['trailing dot', 'name.', /trailing dot or space/],
    ['trailing space', 'name ', /trailing dot or space/],
  ];

  for (const [label, name, expectedError] of invalidNames) {
    await t.test(label, () => {
      assert.throws(() => validateBundleDirectoryNames([Buffer.from(name)], '.'), expectedError);
    });
  }
});

test('rejects Unicode case-fold collisions within one directory', () => {
  assert.throws(
    () =>
      validateBundleDirectoryNames(
        [Buffer.from('Straße.md'), Buffer.from('STRASSE.md')],
        'skills'
      ),
    /Unicode canonical collision/
  );
});

test('rejects capital sharp-s collisions after fold expansion reaches a fixed point', () => {
  assert.throws(
    () =>
      validateBundleDirectoryNames(
        [Buffer.from('ẞ.md'), Buffer.from('SS.md')],
        'skills'
      ),
    /Unicode canonical collision/
  );
});

test('portable fold preserves German, Turkish I, and NFC collision rules', () => {
  for (const pair of [
    ['Straße.md', 'STRASSE.md'],
    ['ß.md', 'SS.md'],
    ['I.md', 'i.md'],
    ['ı.md', 'i.md'],
    ['É.md', 'é.md'],
  ]) {
    assert.throws(
      () => validateBundleDirectoryNames(pair.map(name => Buffer.from(name)), 'skills'),
      /Unicode canonical collision/,
      `${pair.join(' / ')} must collide`
    );
  }

  assert.doesNotThrow(() =>
    validateBundleDirectoryNames([Buffer.from('İ.md'), Buffer.from('i.md')], 'skills')
  );
  assert.throws(
    () => validateBundleDirectoryNames([Buffer.from('e\u0301.md')], 'skills'),
    /NFC normalized/
  );
});

test('canonical hash represents executable Git mode instead of rejecting it', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  const readmeFile = path.join(superpowersRoot, 'README.md');
  const regularDigest = computeBundleSha256(superpowersRoot);
  fs.chmodSync(readmeFile, 0o755);
  const executableDigest = computeBundleSha256(superpowersRoot);

  assert.notEqual(executableDigest, regularDigest);
});

test('canonical hash normalizes non-executable permissions to Git mode 100644', t => {
  const fixtureRoot = createAgentPayloadFixture(t);
  const superpowersRoot = path.join(
    fixtureRoot,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );
  const readmeFile = path.join(superpowersRoot, 'README.md');
  fs.chmodSync(readmeFile, 0o600);
  const ownerOnlyDigest = computeBundleSha256(superpowersRoot);
  fs.chmodSync(readmeFile, 0o644);
  const regularDigest = computeBundleSha256(superpowersRoot);

  assert.equal(ownerOnlyDigest, regularDigest);
});

test('vendored helpers invoked as commands retain executable Git mode', () => {
  const superpowersRoot = path.join(
    ROOT_DIR,
    '.taku-template/payload/.agent-tools/superpowers/6.2.0'
  );

  for (const helper of EXPECTED_EXECUTABLE_HELPERS) {
    assert.notEqual(
      fs.statSync(path.join(superpowersRoot, helper)).mode & 0o111,
      0,
      `${helper} must remain executable`
    );
  }
});

test('rejects Superpowers manifests whose pinned provenance fields drift', async t => {
  const invalidFields = [
    ['name', 'renamed-superpowers'],
    ['version', '6.2.1'],
    ['source', 'untrusted/superpowers'],
    ['license', 'Unknown'],
    ['bundlePath', '.agent-tools/superpowers/current'],
    ['entrySkill', 'skills/brainstorming/SKILL.md'],
  ];

  for (const [field, invalidValue] of invalidFields) {
    await t.test(`rejects ${field}`, fixtureTest => {
      const fixtureRoot = createAgentPayloadFixture(fixtureTest);
      const manifestFile = path.join(
        fixtureRoot,
        '.taku-template/payload/.agent-tools/superpowers/manifest.json'
      );
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      manifest[field] = invalidValue;
      fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

      assert.throws(
        () => checkAgentPayload(fixtureRoot),
        new RegExp(`Superpowers manifest ${field} must be`)
      );
    });
  }
});

test('rejects unknown and conflicting Superpowers manifest fields', async t => {
  const extraFields = [
    ['unknown field', 'downloadUrl', 'https://example.invalid/superpowers'],
    ['conflicting provenance alias', 'sourceUrl', 'https://example.invalid/fork'],
  ];

  for (const [label, field, value] of extraFields) {
    await t.test(label, fixtureTest => {
      const fixtureRoot = createAgentPayloadFixture(fixtureTest);
      const manifestFile = path.join(
        fixtureRoot,
        '.taku-template/payload/.agent-tools/superpowers/manifest.json'
      );
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      manifest[field] = value;
      fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

      assert.throws(
        () => checkAgentPayload(fixtureRoot),
        /Superpowers manifest fields must be exactly/
      );
    });
  }
});

test('Codex and Claude receive the same generated-app skill packages', () => {
  const agentsRoot = path.join(ROOT_DIR, '.taku-template/payload/.agents/skills');
  const claudeRoot = path.join(ROOT_DIR, '.taku-template/payload/.claude/skills');
  const listSkillDirs = root =>
    fs
      .readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

  assert.deepEqual(listSkillDirs(agentsRoot), listSkillDirs(claudeRoot));

  for (const skill of listSkillDirs(agentsRoot)) {
    const agentsSkill = fs.readFileSync(path.join(agentsRoot, skill, 'SKILL.md'), 'utf8');
    const claudeSkill = fs.readFileSync(path.join(claudeRoot, skill, 'SKILL.md'), 'utf8');
    assert.equal(agentsSkill, claudeSkill, `${skill} must be mirrored without drift`);
  }
});

test('generated-app guidance exposes the supported runtime and verification entrypoints', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const content = fs.readFileSync(path.join(ROOT_DIR, '.taku-template/payload', file), 'utf8');
    assert.match(content, /Node\.js 20/);
    assert.match(content, /pnpm/);
    assert.match(content, /workspace.*conversion.*publish/is);
    assert.match(content, /local Host transport capability|本地 Host 传输能力/is);
    assert.match(content, /not.*identity.*billing|不能证明.*身份.*计费/is);
    assert.match(content, /Taku-controlled server.*authority.*blocked|Taku 受控服务端.*授权.*blocked/is);
    assert.match(content, /browser.*mutation.*blocked|浏览器.*写.*blocked/is);
    assert.doesNotMatch(content, /must use.*server.*proxy helper|必须通过应用内 server runtime/is);
    assert.doesNotMatch(content, /Linear|haipro|TAKU-\d+/i);
  }
});

test('generated verification guidance separates Host transport from business authority', () => {
  const skillPaths = [
    '.taku-template/payload/.agents/skills/taku-subapp-verification/SKILL.md',
    '.taku-template/payload/.claude/skills/taku-subapp-verification/SKILL.md',
  ];
  const contents = skillPaths.map(relativePath =>
    fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8')
  );

  assert.equal(contents[0], contents[1], 'verification guidance mirrors must be byte-identical');
  for (const [index, content] of contents.entries()) {
    const relativePath = skillPaths[index];
    assert.match(content, /control token.*local Host transport.*not.*identity.*billing/is, relativePath);
    assert.match(content, /Taku-controlled server.*authority.*blocked/is, relativePath);
    assert.match(content, /browser.*mutation.*blocked/is, relativePath);
    assert.doesNotMatch(content, /Smoke credentials come from authenticated Taku Host injection/is);
  }
});
