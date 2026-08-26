#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'dist', 'plugins');
const marketplaceOutputRoot = path.join(repositoryRoot, 'dist', 'marketplaces');
const pluginName = 'taku-publisher';
const templateBuildArtifactNames = new Set([
  '.biome',
  '.next',
  '.next-edit',
  '.next-preview',
  '.taku',
  '.vercel',
  'build',
  'coverage',
  'out',
]);

const adapterSpecs = [
  {
    host: 'codex',
    creatorHost: 'codex',
    manifestDir: '.codex-plugin',
  },
  {
    host: 'claude',
    creatorHost: 'claude-code',
    manifestDir: '.claude-plugin',
  },
];

const skillRuntimeEntries = [
  'LICENSE',
  'NOTICE',
  'SKILL.md',
  'THIRD_PARTY_NOTICES.md',
  'TRADEMARKS.md',
  'agents',
  'creator',
  'references',
];

async function main() {
  await fs.mkdir(outputRoot, { recursive: true });
  const outputs = [];
  for (const spec of adapterSpecs) {
    outputs.push(await buildAdapter(spec));
  }
  const marketplaces = [
    await buildCodexMarketplace(outputs.find((output) =>
      output === path.join(outputRoot, 'codex', pluginName))),
    await buildClaudeMarketplace(outputs.find((output) =>
      output === path.join(outputRoot, 'claude', pluginName))),
  ];
  console.log(JSON.stringify({
    ok: true,
    outputs: outputs.map((output) => path.relative(repositoryRoot, output)),
    marketplaces: marketplaces.map((output) => path.relative(repositoryRoot, output)),
  }, null, 2));
}

async function buildAdapter(spec) {
  const sourceRoot = path.join(repositoryRoot, 'adapters', spec.host, pluginName);
  const targetRoot = path.join(outputRoot, spec.host, pluginName);
  assertInside(outputRoot, targetRoot);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });

  await copyTree(
    path.join(sourceRoot, spec.manifestDir),
    path.join(targetRoot, spec.manifestDir),
  );
  await copyOptionalFile(
    path.join(sourceRoot, 'README.md'),
    path.join(targetRoot, 'README.md'),
  );

  const skillRoot = path.join(targetRoot, 'skills', pluginName);
  await fs.mkdir(skillRoot, { recursive: true });
  for (const entry of skillRuntimeEntries) {
    await copyTree(path.join(repositoryRoot, entry), path.join(skillRoot, entry));
  }
  await fs.mkdir(path.join(skillRoot, 'scripts'), { recursive: true });
  await fs.copyFile(
    path.join(repositoryRoot, 'scripts', 'taku-publisher.mjs'),
    path.join(skillRoot, 'scripts', 'taku-publisher.mjs'),
  );
  await copyRuntimePackage(
    'capability-contract',
    path.join(
      skillRoot,
      'node_modules',
      '@taku',
      'capability-contract',
    ),
  );
  await copyRuntimePackage(
    'subapp-contract',
    path.join(
      skillRoot,
      'node_modules',
      '@taku',
      'subapp-contract',
    ),
  );
  await copyRuntimePackage(
    'passport-core',
    path.join(
      skillRoot,
      'node_modules',
      '@taku',
      'passport-core',
    ),
  );
  await copyRuntimePackage(
    'publisher-runtime',
    path.join(
      skillRoot,
      'node_modules',
      '@taku',
      'publisher-runtime',
    ),
  );
  await copyConverterRuntime(
    path.join(skillRoot, 'node_modules', 'repo-to-stax-converter'),
  );
  await copyTypeScriptRuntime(
    path.join(skillRoot, 'node_modules', 'typescript'),
  );
  await copyQrCodeRuntime(
    path.join(skillRoot, 'node_modules', 'qrcode-generator'),
  );
  await fs.writeFile(
    path.join(skillRoot, 'package.json'),
    `${JSON.stringify({
      private: true,
      type: 'module',
      imports: {
        '#taku-capability-contract': '@taku/capability-contract',
        '#taku-subapp-contract': '@taku/subapp-contract',
        '#taku-passport-core': '@taku/passport-core',
        '#taku-passport-core/privacy': '@taku/passport-core/privacy',
        '#taku-publisher-runtime': '@taku/publisher-runtime',
      },
    }, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(skillRoot, 'host-adapter.json'),
    `${JSON.stringify({
      schemaVersion: 'taku.host-adapter.v1',
      host: spec.creatorHost,
    }, null, 2)}\n`,
  );
  return targetRoot;
}

async function copyConverterRuntime(target) {
  const source = path.join(repositoryRoot, 'packages', 'repo-to-stax-converter');
  const sourceManifest = JSON.parse(
    await fs.readFile(path.join(source, 'package.json'), 'utf8'),
  );
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify({
      name: sourceManifest.name,
      version: sourceManifest.version,
      private: true,
      type: 'module',
      license: sourceManifest.license,
      exports: {
        './analyze-cli': './dist/analyze-cli.js',
        './prepare-cli': './dist/prepare-cli.js',
        './agent-cli': './dist/agent-cli.js',
        './runtime-cli': './dist/runtime-cli.js',
      },
      dependencies: {
        typescript: sourceManifest.dependencies.typescript,
      },
    }, null, 2)}\n`,
  );
  await copyTree(path.join(source, 'dist'), path.join(target, 'dist'), {
    runtimeOnly: true,
  });
  await copyTree(path.join(source, 'template'), path.join(target, 'template'), {
    excludeTemplateBuildArtifacts: true,
  });
  await fs.copyFile(
    path.join(source, 'template-provenance.json'),
    path.join(target, 'template-provenance.json'),
  );
  for (const relativeFile of ['README.md', 'UPSTREAM.json']) {
    await fs.copyFile(path.join(source, relativeFile), path.join(target, relativeFile));
  }
}

async function copyTypeScriptRuntime(target) {
  const source = path.join(repositoryRoot, 'node_modules', 'typescript');
  const sourceManifest = JSON.parse(
    await fs.readFile(path.join(source, 'package.json'), 'utf8'),
  );
  await fs.mkdir(path.join(target, 'lib'), { recursive: true });
  await fs.writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify({
      name: sourceManifest.name,
      version: sourceManifest.version,
      license: sourceManifest.license,
      main: './lib/typescript.js',
    }, null, 2)}\n`,
  );
  for (const relativeFile of [
    'lib/typescript.js',
    'LICENSE.txt',
    'ThirdPartyNoticeText.txt',
  ]) {
    await fs.copyFile(path.join(source, relativeFile), path.join(target, relativeFile));
  }
}

async function copyQrCodeRuntime(target) {
  const source = path.join(repositoryRoot, 'node_modules', 'qrcode-generator');
  const sourceManifest = JSON.parse(
    await fs.readFile(path.join(source, 'package.json'), 'utf8'),
  );
  delete sourceManifest.scripts;
  delete sourceManifest.devDependencies;
  delete sourceManifest.types;
  sourceManifest.exports = {
    require: './dist/qrcode.js',
    import: './dist/qrcode.mjs',
  };
  await fs.mkdir(path.join(target, 'dist'), { recursive: true });
  await fs.writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
  );
  await fs.copyFile(path.join(source, 'README.md'), path.join(target, 'README.md'));
  for (const relativeFile of ['dist/qrcode.js', 'dist/qrcode.mjs']) {
    await fs.copyFile(path.join(source, relativeFile), path.join(target, relativeFile));
  }
}

async function copyRuntimePackage(name, target) {
  const source = path.join(repositoryRoot, 'packages', name);
  await fs.mkdir(target, { recursive: true });
  const sourceManifest = JSON.parse(
    await fs.readFile(path.join(source, 'package.json'), 'utf8'),
  );
  delete sourceManifest.files;
  delete sourceManifest.scripts;
  delete sourceManifest.types;
  sourceManifest.exports = stripTypeExports(sourceManifest.exports);
  await fs.writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify(sourceManifest, null, 2)}\n`,
  );
  const readme = path.join(source, 'README.md');
  if (await exists(readme)) {
    await fs.copyFile(readme, path.join(target, 'README.md'));
  }
  await copyTree(
    path.join(source, 'dist'),
    path.join(target, 'dist'),
    { runtimeOnly: true },
  );
  if (name === 'capability-contract' || name === 'subapp-contract') {
    for (const entry of ['schemas', 'fixtures']) {
      await copyTree(path.join(source, entry), path.join(target, entry), {
        runtimeOnly: true,
      });
    }
  }
}

function stripTypeExports(value) {
  if (Array.isArray(value)) {
    return value.map(stripTypeExports);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'types')
      .map(([key, child]) => [key, stripTypeExports(child)]),
  );
}

async function exists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function copyOptionalFile(source, target) {
  if (!(await exists(source))) {
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function buildCodexMarketplace(codexPluginRoot) {
  if (!codexPluginRoot) {
    throw new Error('Codex plugin output is required before building its Marketplace.');
  }
  const marketplaceRoot = path.join(marketplaceOutputRoot, 'codex', 'taku');
  assertInside(marketplaceOutputRoot, marketplaceRoot);
  await fs.rm(marketplaceRoot, { recursive: true, force: true });

  await copyTree(
    path.join(repositoryRoot, 'adapters', 'codex', 'marketplace.json'),
    path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'),
  );
  await copyOptionalFile(
    path.join(repositoryRoot, 'adapters', 'codex', 'README.md'),
    path.join(marketplaceRoot, 'README.md'),
  );
  await copyTree(
    codexPluginRoot,
    path.join(marketplaceRoot, 'plugins', pluginName),
    { includeNodeModules: true },
  );
  return marketplaceRoot;
}

async function buildClaudeMarketplace(claudePluginRoot) {
  if (!claudePluginRoot) {
    throw new Error('Claude plugin output is required before building its Marketplace.');
  }
  const marketplaceRoot = path.join(marketplaceOutputRoot, 'claude', 'taku');
  assertInside(marketplaceOutputRoot, marketplaceRoot);
  await fs.rm(marketplaceRoot, { recursive: true, force: true });

  await copyTree(
    path.join(repositoryRoot, 'adapters', 'claude', 'marketplace.json'),
    path.join(marketplaceRoot, '.claude-plugin', 'marketplace.json'),
  );
  await copyOptionalFile(
    path.join(repositoryRoot, 'adapters', 'claude', 'README.md'),
    path.join(marketplaceRoot, 'README.md'),
  );
  await copyTree(
    claudePluginRoot,
    path.join(marketplaceRoot, 'plugins', pluginName),
    { includeNodeModules: true },
  );
  return marketplaceRoot;
}

async function copyTree(source, target, options = {}) {
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      if (shouldSkip(entry.name, options)) continue;
      await copyTree(
        path.join(source, entry.name),
        path.join(target, entry.name),
        options,
      );
    }
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

function shouldSkip(name, options = {}) {
  return name === '__pycache__'
    || name === '.pytest_cache'
    || (!options.includeNodeModules && name === 'node_modules')
    || (options.excludeTemplateBuildArtifacts && templateBuildArtifactNames.has(name))
    || name === 'build-adapters.mjs'
    || name.endsWith('.test.mjs')
    || (options.runtimeOnly && (
      name.endsWith('.d.ts')
      || name.endsWith('.d.ts.map')
      || name.endsWith('.js.map')
      || name.endsWith('.ts')
    ))
    || name.endsWith('.pyc')
    || name.endsWith('.pyo');
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to replace unexpected adapter output: ${child}`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
