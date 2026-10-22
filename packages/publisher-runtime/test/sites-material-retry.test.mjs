import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SitesHttpClient } from '../dist/sites/http.js';

const base = '/v1/sites/prj_retry/artifact-uploads/20000000-0000-4000-8000-000000000001/assets/16';
const ok = () => Response.json({ state: 'uploading' });
const failure = (error, retry = '1', status = 503) => Response.json({ error, retryable: true }, {
  status, headers: { 'Retry-After': retry },
});

function client(fetcher, renew) {
  let time = Date.parse('2026-10-22T12:00:00Z');
  const waits = [];
  return {
    waits,
    api: new SitesHttpClient('http://127.0.0.1:4321', 'taku_pub_fixture', fetcher, false, renew, {
      now: () => time, random: () => 0,
      sleep: async ms => { waits.push(ms); time += ms; },
    }),
  };
}

test('material start waits for a legacy creation lease and recovers in the same operation', async () => {
  const requests = [];
  const responses = [failure('SITE_ASSET_BUSY'), failure('SITE_ASSET_LEASE_CONFLICT', '300'), ok()];
  const { api, waits } = client(async (url, init) => {
    requests.push({ url: String(url), ...init });
    return responses.shift();
  });
  assert.equal((await api.postEmpty(base)).state, 'uploading');
  assert.deepEqual(waits, [1_000, 300_000]);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(r => r.body === undefined && r.method === 'POST'));
  assert.ok(requests.every(r => r.url.endsWith(base) && r.redirect === 'error'));
});

test('lost part responses and transient failures replay exactly the same Buffer, length and SHA256', async () => {
  const bytes = Buffer.from('the immutable part');
  const seen = [];
  const { api } = client(async (url, init) => {
    seen.push({ url: String(url), body: init.body, headers: { ...init.headers } });
    if (seen.length === 1) throw new TypeError('connection reset after provider accepted part');
    if (seen.length === 2) return failure('SITE_ASSET_PROVIDER_UNAVAILABLE');
    return Response.json({ status: 'uploaded' });
  });
  await api.putMaterialPart(`${base}/parts/1`, bytes);
  assert.equal(seen.length, 3);
  for (const r of seen) {
    assert.equal(r.body, bytes);
    assert.equal(r.headers['Content-Length'], String(bytes.length));
    assert.equal(r.headers['X-Taku-Asset-Part-Sha256'], createHash('sha256').update(bytes).digest('hex'));
    assert.equal(r.url, seen[0].url);
  }
});

test('complete honors HTTP-date Retry-After and the previous 409 lease contract', async () => {
  let calls = 0;
  const { api, waits } = client(async () => ++calls === 1
    ? failure('SITE_ASSET_LEASE_CONFLICT', 'Thu, 22 Oct 2026 12:00:05 GMT', 409) : ok());
  await api.postEmpty(`${base}/complete`);
  assert.deepEqual(waits, [5_000]);
  assert.equal(calls, 2);
});

test('retries are bounded and never truncate Retry-After to fit the deadline', async () => {
  let calls = 0;
  const bounded = client(async () => { calls++; return failure('SITE_ASSET_BUSY'); });
  await assert.rejects(bounded.api.postEmpty(base), error => {
    assert.equal(error.details.retry_attempts, 8);
    return error.details.retryable === true;
  });
  assert.equal(calls, 8);
  assert.equal(bounded.waits.length, 7);
  calls = 0;
  const deadline = client(async () => { calls++; return failure('SITE_ASSET_LEASE_CONFLICT', '900'); });
  await assert.rejects(deadline.api.postEmpty(base), { code: 'sites_api_error' });
  assert.equal(calls, 1);
  assert.deepEqual(deadline.waits, []);
});

test('permanent errors, arbitrary 503s and non-material mutations are never retried', async () => {
  for (const code of ['SITE_STORAGE_LIMIT_REACHED', 'SITE_ASSET_PAYLOAD_CONFLICT', 'SITE_ASSET_OBJECT_INVALID', 'temporary']) {
    let calls = 0;
    const { api, waits } = client(async () => { calls++; return failure(code); });
    await assert.rejects(api.postEmpty(base), { code: 'sites_api_error' });
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  }
  for (const path of ['/v1/sites', '/v1/sites/publish-requests', `${base}/../../finalize`, `${base}/promote`]) {
    let calls = 0;
    const { api } = client(async () => { calls++; return failure('SITE_ASSET_BUSY'); });
    await assert.rejects(api.post(path, {}, 'same-key'), { code: 'sites_api_error' });
    assert.equal(calls, 1);
  }
});

test('401 renewal keeps the retry budget and updates authorization without repeating confirmation', async () => {
  let calls = 0, renewals = 0;
  const auth = [];
  const { api, waits } = client(async (_url, init) => {
    auth.push(init.headers.Authorization);
    if (++calls === 1) return failure('SITE_ASSET_BUSY');
    if (calls === 2) return new Response(null, { status: 401 });
    return ok();
  }, async () => { renewals++; return 'taku_pub_renewed'; });
  await api.postEmpty(base);
  assert.deepEqual(auth, ['Bearer taku_pub_fixture', 'Bearer taku_pub_fixture', 'Bearer taku_pub_renewed']);
  assert.deepEqual(waits, [1_000]);
  assert.equal(renewals, 1);
});

test('renewal cannot add a ninth HTTP attempt after the material retry limit', async () => {
  let calls = 0, renewals = 0;
  const { api } = client(async () => ++calls < 8
    ? failure('SITE_ASSET_BUSY') : new Response(null, { status: 401 }),
  async () => { renewals++; return 'taku_pub_renewed'; });
  await assert.rejects(api.postEmpty(base), { code: 'sites_api_error' });
  assert.equal(calls, 8);
  assert.equal(renewals, 0);
});
