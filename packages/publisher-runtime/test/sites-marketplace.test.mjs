import assert from 'node:assert/strict';
import test from 'node:test';
import { updateMarketplaceListing, marketplaceFailure } from '../dist/sites/marketplace.js';
import { PublisherError } from '../dist/util.js';
import { dispatch } from '../dist/cli.js';

const projectId = 'prj_marketplace_fixture';
const before = { version: 3, listingIntent: 'unlisted', effectiveVisibility: 'unlisted', canList: true };
const after = { ...before, version: 4, listingIntent: 'listed', effectiveVisibility: 'listed' };

test('lost listing response is reconciled by GET without replaying a write', async () => {
  const calls = [];
  const result = await updateMarketplaceListing({
    get: async () => { calls.push('GET'); return { directory: calls.length === 1 ? before : after }; },
    patch: async (_path, body) => { calls.push('PATCH'); assert.deepEqual(body, { expectedVersion: 3, listingIntent: 'listed' }); throw new Error('response lost'); },
  }, projectId, 'public');
  assert.equal(result.status, 'listed');
  assert.deepEqual(calls, ['GET', 'PATCH', 'GET']);
});

test('version conflict does not overwrite a different choice and only exposes safe diagnostics', async () => {
  let writes = 0;
  const error = new PublisherError('private diagnostic', 'sites_api_error', {
    http_status: 409, server_error: 'DIRECTORY_VERSION_CONFLICT', request_id: 'fixture-request', response_summary: 'private diagnostic',
  });
  await assert.rejects(updateMarketplaceListing({ get: async () => ({ directory: before }),
    patch: async () => { writes++; throw error; } }, projectId, 'public'), value => value === error);
  assert.equal(writes, 1);
  assert.doesNotMatch(JSON.stringify(marketplaceFailure('public', error)), /private diagnostic|response_summary/);
});

test('missing directory or malformed state cannot be reported as a successful listing', async () => {
  for (const directory of [undefined, {}, { ...before, version: -1 }, { ...before, listingIntent: ['listed'] }]) {
    let writes = 0;
    await assert.rejects(updateMarketplaceListing({ get: async () => ({ directory }), patch: async () => { writes++; return {}; } }, projectId, 'public'),
      { code: 'sites_directory_unavailable' });
    assert.equal(writes, 0);
  }
});

test('already selected intent preserves the server effective visibility without another mutation', async () => {
  let writes = 0;
  const result = await updateMarketplaceListing({ get: async () => ({ directory: { ...after, effectiveVisibility: 'unlisted', canList: false } }),
    patch: async () => { writes++; return {}; } }, projectId, 'public');
  assert.equal(result.status, 'unlisted');
  assert.equal(writes, 0);
});

test('standalone listing rejects missing choices and invalid IDs before authenticating or requesting', async () => {
  const args = flags => ({ command: 'sites-listing', flags: new Map(Object.entries(flags)), rest: [] });
  await assert.rejects(dispatch(args({ 'project-id': projectId })), { code: 'sites_listing_required' });
  await assert.rejects(dispatch(args({ 'project-id': projectId, listing: true })), { code: 'sites_listing_invalid' });
  await assert.rejects(dispatch(args({ 'project-id': '../another', listing: 'public' })), { code: 'sites_project_id_invalid' });
});
