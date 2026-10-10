import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { dispatch } from '../dist/cli.js';

async function exportedSdk(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'publisher-sql-sdk-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'sdk.mjs');
  const result = await dispatch({ command: 'sites-sdk-export', flags: new Map([['output', output]]), rest: [] });
  assert.equal(result.status, 'sites_sdk_exported');
  return import(pathToFileURL(output).href);
}

test('actual CLI-exported SQL SDK preserves its original action ID and never auto-replays a hold', async t => {
  const { createTakuSitesClient, TakuSitesRequestError } = await exportedSdk(t);
  const sent = [];
  const client = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    sent.push(request);
    return Response.json({ error: sent.length === 1 ? 'site_database_usage_pending' : 'site_database_request_completed' },
      { status: sent.length === 1 ? 429 : 409 });
  } });
  for (const status of [429, 409]) {
    await assert.rejects(client.storage.query('INSERT INTO notes(body) VALUES (?)', ['once'],
      { requestId: 'publisher-sql-original-001' }),
    error => error instanceof TakuSitesRequestError && error.status === status);
  }
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(request => request.headers.get('X-Taku-SQL-Request-Id')),
    ['publisher-sql-original-001', 'publisher-sql-original-001']);
  for (const request of sent) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('X-Taku-CSRF'), '1');
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.headers.has('Authorization'), false);
    assert.deepEqual(await request.json(), { statement: 'INSERT INTO notes(body) VALUES (?)', params: ['once'] });
  }
});

test('actual CLI-exported SQL SDK assigns distinct logical IDs and refuses malformed IDs before I/O', async t => {
  const { createTakuSitesClient } = await exportedSdk(t);
  const sent = [];
  const client = createTakuSitesClient({ baseUrl: 'https://fixture.taku.site', fetcher: async request => {
    sent.push(request); return new Response(null, { status: 204 });
  } });
  await client.storage.query('SELECT 1');
  await client.storage.query('SELECT 1');
  await client.storage.personal.put('notes', 'one', { title: 'fixture' });
  await client.storage.batch([{ statement: 'SELECT 1' }, { statement: 'SELECT 2' }],
    { requestId: 'publisher-sql-batch-0001' });
  const ids = sent.slice(0, 3).map(request => request.headers.get('X-Taku-SQL-Request-Id'));
  ids.forEach(id => assert.match(id ?? '', /^[a-f0-9-]{36}$/));
  assert.equal(new Set(ids).size, 3);
  assert.equal(sent[3].headers.get('X-Taku-SQL-Request-Id'), 'publisher-sql-batch-0001');
  assert.deepEqual(await sent[3].json(), { statements: [{ statement: 'SELECT 1' }, { statement: 'SELECT 2' }] });
  for (const requestId of ['', 'short', 'x'.repeat(129), 'unsafe\nheader']) {
    await assert.rejects(client.storage.query('SELECT 1', [], { requestId }), /invalid_database_request_id/);
    await assert.rejects(client.storage.batch([{ statement: 'SELECT 1' }], { requestId }), /invalid_database_request_id/);
  }
  assert.equal(sent.length, 4);
});
