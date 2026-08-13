import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { analyzeRepo } from '../src/lib/analyzer.js';
import { makePackageTempDir } from './test-utils.js';

async function makeTempRepo(name: string): Promise<string> {
  const root = await makePackageTempDir(name);
  await mkdir(join(root, 'src', 'app'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'demo-next-app',
        description: 'Demo interactive app',
        scripts: { dev: 'next dev', build: 'next build' },
        dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0' },
      },
      null,
      2
    )
  );
  await writeFile(join(root, 'README.md'), '# Demo Next App\n\nAn interactive web app.');
  await writeFile(join(root, 'LICENSE'), 'MIT License\n');
  await writeFile(join(root, 'src', 'app', 'page.tsx'), 'export default function Page() { return <main />; }\n');
  return root;
}

test('analyzeRepo detects a Next.js application-layer repo with credit metadata', async () => {
  const repoRoot = await makeTempRepo('analyzer');

  const analysis = await analyzeRepo({ repoRoot, source: { kind: 'local', path: repoRoot } });

  assert.equal(analysis.appType, 'nextjs');
  assert.equal(analysis.packageName, 'demo-next-app');
  assert.equal(analysis.license, 'MIT');
  assert.equal(analysis.hasReadme, true);
  assert.equal(analysis.hasUi, true);
  assert.equal(analysis.recommendation, 'convertible');
  assert.ok(analysis.score >= 80);
  assert.ok(analysis.reasons.includes('Next.js app detected'));
});

test('analyzeRepo keeps semantic results invariant when a source identity matches a benchmark sample', async () => {
  const repoRoot = await makeTempRepo('benchmark-hint-isolation');
  const ordinary = await analyzeRepo({
    repoRoot,
    source: {
      kind: 'github',
      path: repoRoot,
      repo: 'example/demo-next-app',
      url: 'https://github.com/example/demo-next-app',
    },
    sourceUrl: 'https://github.com/example/demo-next-app',
  });
  const benchmarkNamed = await analyzeRepo({
    repoRoot,
    source: {
      kind: 'github',
      path: repoRoot,
      repo: 'Nutlope/roomGPT',
      url: 'https://github.com/Nutlope/roomGPT',
    },
    sourceUrl: 'https://github.com/Nutlope/roomGPT',
  });

  const semantic = ({ repoRoot: _repoRoot, source: _source, sourceUrl: _sourceUrl, ...analysis }: typeof ordinary) =>
    analysis;

  assert.deepEqual(semantic(benchmarkNamed), semantic(ordinary));
});

test('analyzeRepo detects nested Streamlit repos from dependency and import content', async () => {
  const repoRoot = await makePackageTempDir('streamlit-analyzer');
  await mkdir(join(repoRoot, 'App'), { recursive: true });
  await writeFile(join(repoRoot, 'README.md'), '# Streamlit Assistant\n');
  await writeFile(join(repoRoot, 'LICENSE'), 'MIT License\n');
  await writeFile(join(repoRoot, 'App', 'requirements.txt'), 'streamlit==1.12.2\nlangchain\n');
  await writeFile(join(repoRoot, 'App', 'App.py'), 'import streamlit as st\nst.title("Assistant")\n');

  const analysis = await analyzeRepo({ repoRoot, source: { kind: 'local', path: repoRoot } });

  assert.equal(analysis.appType, 'streamlit');
  assert.equal(analysis.hasUi, true);
  assert.ok(analysis.reasons.includes('Streamlit app detected'));
});

test('analyzeRepo detects full-stack FastAPI and Next.js repos from nested backend content', async () => {
  const repoRoot = await makePackageTempDir('fastapi-next-analyzer');
  await mkdir(join(repoRoot, 'frontend', 'app'), { recursive: true });
  await mkdir(join(repoRoot, 'backend', 'app'), { recursive: true });
  await writeFile(
    join(repoRoot, 'frontend', 'package.json'),
    JSON.stringify({
      name: 'fullstack-ui',
      scripts: { build: 'next build' },
      dependencies: { next: '15.0.0', react: '19.0.0', 'react-dom': '19.0.0' },
    })
  );
  await writeFile(join(repoRoot, 'frontend', 'app', 'page.tsx'), 'export default function Page() { return <main />; }\n');
  await writeFile(join(repoRoot, 'backend', 'requirements.txt'), 'fastapi==0.115.0\nuvicorn\n');
  await writeFile(join(repoRoot, 'backend', 'app', 'main.py'), 'from fastapi import FastAPI\napp = FastAPI()\n');

  const analysis = await analyzeRepo({ repoRoot, source: { kind: 'local', path: repoRoot } });

  assert.equal(analysis.appType, 'fastapi-next');
  assert.ok(analysis.reasons.includes('FastAPI + frontend app detected'));
});

test('analyzeRepo does not treat the browser document global as a private-document workflow', async () => {
  const repoRoot = await makePackageTempDir('vite-dom-analyzer');
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify({
      name: 'vite-dom-app',
      dependencies: { react: '18.2.0' },
      devDependencies: { vite: '5.4.0' },
    })
  );
  await writeFile(join(repoRoot, 'README.md'), '# Vite DOM App\n');
  await writeFile(join(repoRoot, 'LICENSE'), 'MIT License\n');
  await writeFile(
    join(repoRoot, 'src', 'main.jsx'),
    'document.getElementById("root").textContent = "Ready";\n'
  );

  const analysis = await analyzeRepo({ repoRoot, source: { kind: 'local', path: repoRoot } });

  assert.equal(analysis.appType, 'vite-react');
  assert.equal(
    analysis.risks.includes('Document or upload workflow may handle sensitive user data'),
    false
  );
});

test('analyzeRepo still reports dynamic evaluation as a command-execution review risk', async () => {
  const repoRoot = await makePackageTempDir('vite-eval-analyzer');
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify({
      name: 'vite-eval-app',
      dependencies: { react: '18.2.0' },
      devDependencies: { vite: '5.4.0' },
    })
  );
  await writeFile(join(repoRoot, 'README.md'), '# Vite Eval App\n');
  await writeFile(join(repoRoot, 'LICENSE'), 'MIT License\n');
  await writeFile(join(repoRoot, 'src', 'App.jsx'), 'export const calculate = value => eval(value);\n');

  const analysis = await analyzeRepo({ repoRoot, source: { kind: 'local', path: repoRoot } });

  assert.equal(
    analysis.risks.includes('Potential command execution requires security review before conversion'),
    true
  );
});
