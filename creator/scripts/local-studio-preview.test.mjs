import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { localStudioPreviewOrigin, sendLocalStudioPreview } from './local-studio-preview.mjs';

test('local Studio handoff rejects remote addresses and accepts loopback only', () => {
  assert.equal(localStudioPreviewOrigin(), 'http://127.0.0.1:3003');
  assert.equal(localStudioPreviewOrigin('http://localhost:3004/studio-preview'), 'http://localhost:3004');
  for (const url of ['https://taku.ai', 'http://example.test', 'http://127.0.0.1:3003/api', 'http://user:pass@localhost:3003']) {
    assert.throws(() => localStudioPreviewOrigin(url));
  }
});

test('local Studio rejects redirects before sending display data to another origin', async (t) => {
  let remoteRequests = 0;
  const remote = createServer((request, response) => { remoteRequests++; response.end('{}'); });
  await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  const local = createServer((request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${remote.address().port}/capture` }).end();
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => Promise.all([local, remote].map(server => new Promise(resolve => server.close(resolve)))));
  await assert.rejects(sendLocalStudioPreview({ draft: {} }, `http://127.0.0.1:${local.address().port}`), /Start the local Studio/);
  assert.equal(remoteRequests, 0);
});

test('local Studio rejects returned links with credentials, fragments or a foreign origin', async (t) => {
  let editorUrl;
  const local = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, editorUrl }));
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => local.close(resolve)));
  const origin = `http://127.0.0.1:${local.address().port}`;
  for (const url of [`http://user@127.0.0.1:${local.address().port}/studio-preview?mode=publisher&session=test`, `${origin}/studio-preview?mode=publisher&session=test#grant=secret`, 'https://taku.ai/studio-preview?mode=publisher&session=test']) {
    editorUrl = url;
    await assert.rejects(sendLocalStudioPreview({ draft: {} }, origin), /invalid page address/);
  }
});

test('local Studio receives the real display model without private inventory', async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/api/studio-preview');
    assert.equal(request.method, 'POST');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ ok: true, editorUrl: `http://${request.headers.host}/studio-preview?mode=publisher&session=local-test` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await sendLocalStudioPreview({
    draftPath: '/local/draft.json',
    draft: { card: { name: 'Real Creator' }, stats: { usage: { totalTokens: 123456, label: 'Last 90 Days' } }, __privateInventory: { secret: 'private-source-path' } },
  }, `http://127.0.0.1:${server.address().port}`);
  assert.equal(result.canPublish, false);
  assert.equal(result.localStudioPreview, true);
  assert.equal(result.draftPath, '/local/draft.json');
  assert.equal(received.renderer.model.canPublish, false);
  assert.equal(received.renderer.model.auth.isTakuAuthorized, false);
  assert.equal(received.renderer.model.cardHandle, 'LOCAL DRAFT');
  assert.equal(received.renderer.model.usageLabel, 'Last 90 Days');
  assert.doesNotMatch(JSON.stringify(received), /private-source-path|__privateInventory/);
});
