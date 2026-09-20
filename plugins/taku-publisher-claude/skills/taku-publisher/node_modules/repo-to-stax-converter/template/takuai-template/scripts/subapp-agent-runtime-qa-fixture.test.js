const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const componentPath = path.join(
  root,
  'docs',
  'examples',
  'subapp-agent-runtime-qa',
  'AgentRuntimeQaPanel.tsx'
);
const readmePath = path.join(
  root,
  'docs',
  'examples',
  'subapp-agent-runtime-qa',
  'README.md'
);
const fixtureManifestPath = path.join(
  root,
  'src',
  'lib',
  'taku-runtime',
  'fixtures',
  'agent-runtime-qa.manifest.json'
);

test('Agent Runtime QA fixture declares its exact supported operation revisions', () => {
  const fixtureManifest = JSON.parse(fs.readFileSync(fixtureManifestPath, 'utf8'));

  assert.deepEqual(
    fixtureManifest.runtimeCapabilities.operations.map(operation => `${operation.id}@${operation.revision}`),
    [
      'agent.execute@1',
      'research.generateReport@1',
      'media.image.generate@1',
      'media.video.generate@1',
    ]
  );
});

test('Agent Runtime QA exercises the public SDK without bypassing Host authority', () => {
  const component = fs.readFileSync(componentPath, 'utf8');
  const readme = fs.readFileSync(readmePath, 'utf8');

  assert.match(component, /await client\.capabilities\(\)/);
  assert.match(component, /capabilities\.catalog\?\.operations\.find/);
  assert.match(component, /capabilities\.operations\.some/);
  assert.match(component, /createTakuAgentRunJournal/);
  assert.match(component, /recoverOrStartTakuAgentRun/);
  assert.match(component, /input: SAMPLE_INPUTS\[operation\]/);
  assert.match(component, /client\.subscribe/);
  assert.match(component, /afterSequence: input\.cursor\.lastSequence/);
  assert.match(component, /onError: rejectTerminal/);
  assert.match(component, /client\.readContentText/);
  assert.match(component, /createTakuAgentAssetPlayback/);
  assert.match(component, /assetRef: asset\.assetRef/);
  assert.match(component, /expectedRecoveryScope: capabilities\.recoveryScope/);
  assert.match(component, /lease\.dispose\(\)/);
  assert.doesNotMatch(component, /src=\{preview\.playbackUrl\}/);
  assert.match(component, /onClick=\{\(\) => void onRun\(operation\)\}/);
  assert.match(readme, /只有开发者点击按钮才会启动业务 run/);

  for (const bypass of ['fetch(', 'apiKey:', 'workingDir:', 'proxyUrl:', 'applicationId:']) {
    assert.equal(component.includes(bypass), false, `fixture must not contain ${bypass}`);
  }
});
