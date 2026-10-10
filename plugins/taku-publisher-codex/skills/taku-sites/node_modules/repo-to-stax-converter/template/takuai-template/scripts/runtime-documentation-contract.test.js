const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const documentPath = path.resolve(__dirname, '..', 'docs', 'subapp-agent-runtime.md');

test('runtime example preserves detailed terminal outcomes and isolates cleanup', () => {
  const document = fs.readFileSync(documentPath, 'utf8');

  assert.match(document, /expectedRecoveryScope: capabilities\.recoveryScope/);
  assert.match(document, /onError: rejectTerminal/);
  assert.match(document, /message\.event\.status === 'failed'[\s\S]*agent[\s\S]*\.get\(/);
  assert.match(document, /run\.error'[\s\S]*rejectTerminal\([\s\S]*TakuAgentError/);
  assert.doesNotMatch(document, /resolveTerminal\('failed'\)/);
  assert.match(document, /unsubscribe\(\)\.catch\(\(\) => undefined\)/);
  assert.match(
    document,
    /if \(restored\.terminal\)[\s\S]*snapshot\.state === 'succeeded'[\s\S]*agent\.result[\s\S]*snapshot\.state === 'failed'[\s\S]*TakuAgentError/
  );
  assert.match(
    document,
    /journal\.update\(restored\.journalEntryId[\s\S]*独立 `try\/catch`[\s\S]*业务 resolve\/reject/i
  );
});

test('runtime recovery example blocks invalid evidence and fences stale mutations', () => {
  const document = fs.readFileSync(documentPath, 'utf8');

  assert.match(document, /TakuAgentRunRecoveryBlockedError/);
  assert.match(document, /过期[\s\S]*未来[\s\S]*TTL[\s\S]*scope/i);
  assert.match(document, /entryId[\s\S]*compare-and-set/);
  assert.match(document, /cleanupError[\s\S]*不能覆盖/);
  assert.match(document, /已接受 `cursor`[\s\S]*TakuAgentRunPersistenceError/i);
  assert.match(document, /用户明确放弃[\s\S]*journal\.discard\(\)[\s\S]*不要在后台自动/);
});

test('runtime reference documents the negotiated operation, content, and asset surface', () => {
  const document = fs.readFileSync(documentPath, 'utf8');

  for (const operation of [
    'agent.execute',
    'research.generateReport',
    'media.image.generate',
    'media.video.generate',
  ]) {
    assert.match(document, new RegExp(operation.replace('.', '\\.'), 'i'));
  }
  assert.match(document, /content-ref-v1[\s\S]*content\.read/i);
  assert.match(document, /operation-catalog-v1[\s\S]*JSON Schema/i);
  assert.match(document, /asset-open-v1[\s\S]*asset\.open/i);
  assert.match(document, /assetRef[\s\S]*不透明[\s\S]*不得持久化/is);
  assert.match(document, /图生视频[\s\S]*未出现在当前 capabilities\/catalog\/manifest/is);
  assert.match(document, /默认模板[\s\S]*不申请任何 AI 能力/is);
});

test('runtime guidance routes real app creation through authenticated Host capabilities', () => {
  const document = fs.readFileSync(documentPath, 'utf8');
  const maintainerGuide = fs.readFileSync(path.resolve(__dirname, '..', 'CLAUDE.md'), 'utf8');
  const proxyGuide = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'proxy-ai-guide.md'), 'utf8');

  assert.match(document, /Planner 创建 Taku App[\s\S]*capabilities\(\)[\s\S]*真实服务端 grant/);
  assert.doesNotMatch(document, /TAKU_DEV_SUBAPP_AGENT_FAKE_APPLICATION_ID=/);
  assert.doesNotMatch(maintainerGuide, /尚未接入真实 CLI\/模型/);
  assert.match(proxyGuide, /@\/lib\/taku-runtime[\s\S]*不要为这些 operation 额外创建 Route Handler/);
});
