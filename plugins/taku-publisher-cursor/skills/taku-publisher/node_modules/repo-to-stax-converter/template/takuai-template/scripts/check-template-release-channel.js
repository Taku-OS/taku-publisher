const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { checkAgentPayload } = require('./check-agent-payload');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_FILE = path.join(ROOT_DIR, 'taku.manifest.json');
const PACKAGE_FILE = path.join(ROOT_DIR, 'package.json');
const NVMRC_FILE = path.join(ROOT_DIR, '.nvmrc');
const PAYLOAD_MANIFEST_FILE = path.join(ROOT_DIR, '.taku-template.json');
const EXPECTED_NODE_VERSION = '20.20.2';
const EXPECTED_NVMRC_CONTENT = Buffer.from(`${EXPECTED_NODE_VERSION}\n`);
const EXPECTED_PACKAGE_MANAGER = 'pnpm@10.15.1';
const EXPECTED_TEST_SCRIPT = 'node scripts/run-tests.js';
const EXPECTED_TSX_VERSION = '4.23.0';
const EXPECTED_PAYLOAD_POLICY = Object.freeze({
  schemaVersion: 1,
  exclude: [
    '.agents',
    '.claude',
    '.github',
    'AGENTS.md',
    'CHANGELOG.md',
    'CLAUDE.md',
    'RELEASING.md',
    'scripts/check-agent-payload.js',
    'scripts/check-agent-payload.test.js',
    'scripts/check-template-release-channel.js',
    'scripts/template-artifact-policy.test.js',
    'scripts/template-release-contract.test.js',
    'scripts/test-launcher-contract.test.js',
    'src/lib/test-runner-alias-fixture.ts',
    'src/lib/test-runner-alias.test.ts',
    'src/lib/test-runner-server-only-cjs-fixture.ts',
    'src/lib/test-runner-server-only-cjs.test.ts',
    'src/lib/test-runner-server-only.test.ts',
    'src/lib/test-runner-top-level-await-fixture.ts',
    'src/lib/test-runner-top-level-await.test.ts',
    'src/lib/test-runner-top-level-await-types.ts',
    'skills.md',
  ],
  overlayDirectory: '.taku-template/payload',
  cleanup: ['.taku-template', '.husky/_', 'next-env.d.ts', 'tsconfig.tsbuildinfo'],
  packageJson: {
    removeScripts: ['release:check'],
  },
});
const PAYLOAD_GUIDANCE_FILES = ['AGENTS.md', 'CLAUDE.md'];
const FORBIDDEN_PAYLOAD_PATTERNS = [
  {
    label: 'Linear workflow',
    pattern: /\bLinear\s+(?:issue|project|workflow|team|record|status|comment|rules?)\b/i,
  },
  { label: 'internal completion approver', pattern: /\b(?:haipro|Jacky)\b/i },
  { label: 'internal issue identifier', pattern: /\bTAKU-\d+\b(?!\.)/i },
  { label: 'internal Linear skill', pattern: /taku-linear-coding/i },
];

const RELEASE_CHANNEL = {
  key: 'taku3',
  name: 'taku3-latest',
  recommendedTag: 'taku-3.0.2-template',
  expectedVersion: '0.3.2',
};

const LEGACY_WIDGET_PATHS = [
  'scripts/taku-widget-worker.ts',
  'scripts/taku-widget-refresher.ts',
];

function parseArgs(argv) {
  return argv.reduce(
    (acc, arg) => {
      const [rawKey, ...valueParts] = arg.replace(/^--/, '').split('=');
      if (!rawKey || valueParts.length === 0) return acc;
      acc[rawKey] = valueParts.join('=').trim();
      return acc;
    },
    {
      channel: process.env.TAKU_TEMPLATE_RELEASE_CHANNEL || '',
      tag: process.env.TAKU_TEMPLATE_RELEASE_TAG || '',
    }
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFilesRecursively(relativeDir) {
  const absoluteDir = path.join(ROOT_DIR, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.join(relativeDir, entry.name);
    return entry.isDirectory() ? listFilesRecursively(relativePath) : [relativePath];
  });
}

function fail(message) {
  console.error(`[template-release-channel] ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.channel !== RELEASE_CHANNEL.key) {
  fail('仅支持 --channel=taku3；Taku 2 模板发布通道已下线');
}
const channel = RELEASE_CHANNEL;

const releaseTag = args.tag || channel.recommendedTag;
const manifest = readJson(MANIFEST_FILE);
const packageJson = readJson(PACKAGE_FILE);
if (!fs.existsSync(NVMRC_FILE)) {
  fail('缺少 .nvmrc，无法确认 Node.js 运行时契约');
}
const nodeVersionContent = fs.readFileSync(NVMRC_FILE);
if (!nodeVersionContent.equals(EXPECTED_NVMRC_CONTENT)) {
  fail(`.nvmrc 必须逐字节等于 Node.js ${EXPECTED_NODE_VERSION} 契约`);
}
if (packageJson.packageManager !== EXPECTED_PACKAGE_MANAGER) {
  fail(
    `packageManager 必须精确锁定 ${EXPECTED_PACKAGE_MANAGER}，当前为 ${packageJson.packageManager ?? '缺失'}`
  );
}
if (packageJson.scripts?.test !== EXPECTED_TEST_SCRIPT) {
  fail(`test script 必须精确使用 ${EXPECTED_TEST_SCRIPT}`);
}
if (packageJson.devDependencies?.tsx !== EXPECTED_TSX_VERSION) {
  fail(`devDependencies.tsx 必须精确锁定 ${EXPECTED_TSX_VERSION}`);
}
if (!fs.existsSync(PAYLOAD_MANIFEST_FILE)) {
  fail('缺少 .taku-template.json，无法确认用户生成产物边界');
}
const payloadManifest = readJson(PAYLOAD_MANIFEST_FILE);
const hasLegacyWidgetsField = Object.prototype.hasOwnProperty.call(manifest, 'widgets');
const hasLegacyRefreshField = Object.prototype.hasOwnProperty.call(manifest, 'refresh');
const legacyWidgetScripts = ['taku:widget-worker', 'taku:widget-refresher'].filter(
  script => Object.prototype.hasOwnProperty.call(packageJson.scripts ?? {}, script)
);
const legacyWidgetPaths = [
  ...LEGACY_WIDGET_PATHS.filter(relativePath => fs.existsSync(path.join(ROOT_DIR, relativePath))),
  ...listFilesRecursively('src/taku/widgets'),
  ...listFilesRecursively('widgets'),
];

if (!isDeepStrictEqual(payloadManifest, EXPECTED_PAYLOAD_POLICY)) {
  fail('.taku-template.json 必须精确匹配 canonical payload policy');
}

for (const relativePath of PAYLOAD_GUIDANCE_FILES) {
  const payloadPath = path.join(ROOT_DIR, EXPECTED_PAYLOAD_POLICY.overlayDirectory, relativePath);
  if (!fs.existsSync(payloadPath)) {
    fail(`缺少用户版 Agent 指南: ${path.relative(ROOT_DIR, payloadPath)}`);
  }
  const content = fs.readFileSync(payloadPath, 'utf8');
  for (const forbidden of FORBIDDEN_PAYLOAD_PATTERNS) {
    if (forbidden.pattern.test(content)) {
      fail(`${path.relative(ROOT_DIR, payloadPath)} 包含 ${forbidden.label}`);
    }
  }
}

if (releaseTag !== channel.recommendedTag) {
  fail(`${channel.name} tag 必须是 ${channel.recommendedTag}，当前为 ${releaseTag}`);
}

if (packageJson.version !== manifest.version) {
  fail(`package/manifest 版本不一致: package=${packageJson.version} manifest=${manifest.version}`);
}

if (packageJson.version !== channel.expectedVersion) {
  fail(`${channel.name} 模板版本必须是 ${channel.expectedVersion}，当前为 ${packageJson.version}`);
}

if (hasLegacyWidgetsField || hasLegacyRefreshField) {
  fail(`${channel.name} 不允许 SubApp widget 协议；请删除 taku.manifest.json 的 widgets/refresh 字段`);
}

if (legacyWidgetScripts.length > 0) {
  fail(`${channel.name} 不允许 SubApp widget scripts: ${legacyWidgetScripts.join(', ')}`);
}

if (legacyWidgetPaths.length > 0) {
  fail(`${channel.name} 不允许 SubApp widget 文件: ${legacyWidgetPaths.join(', ')}`);
}

try {
  checkAgentPayload(ROOT_DIR);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

console.log(
  [
    `[template-release-channel] channel=${channel.name}`,
    `tag=${releaseTag}`,
    `package=${packageJson.version}`,
    `manifest=${manifest.version}`,
    'subapp-widget-protocol=absent',
    'agent-payload=isolated',
  ].join(' ')
);
