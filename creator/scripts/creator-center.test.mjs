import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from './cli.mjs';
import {
  normalizeCreatorCenterItem,
  runCreatorCenterList,
  runCreatorCenterUnpublish,
  runCreatorCenterUpdate,
} from './creator-center.mjs';

test('normalizes Creator Center items without exposing raw metadata', () => {
  const item = normalizeCreatorCenterItem({
    id: 'item-1',
    name: 'Demo Skill',
    slug: 'demo-skill',
    type: 'skill',
    status: 'published',
    currentVersion: 3,
    liveInstallCount: 42,
    metadata: { privateLineage: 'do-not-return' },
    creatorUsername: 'alice',
  }, {
    siteUrl: 'https://taku.ai',
  });

  assert.equal(item.itemId, 'item-1');
  assert.equal(item.installCount, 42);
  assert.equal(item.updateRequiresPublisher, true);
  assert.equal(item.creatorPageUrl, 'https://taku.ai/profile/alice');
  assert.equal(item.publicItemUrl, 'https://taku.ai/stax/alice/demo-skill');
  assert.equal(Object.hasOwn(item, 'metadata'), false);
});

test('lists owned items with filters and trusted stats', async () => {
  const calls = [];
  const client = {
    async getMyCreatorItems(filters) {
      calls.push(filters);
      return {
        data: [{
          id: 'item-1',
          name: 'Draft Tool',
          status: 'draft',
          type: 'tool',
          creatorUsername: 'alice',
        }],
      };
    },
    async getMyProfile() {
      return { data: { username: 'alice', displayName: 'Alice' } };
    },
    async getMyCreatorStats() {
      return { data: { toolCount: 1, totalInstalls: 8 } };
    },
  };
  const result = await runCreatorCenterList(
    parseArgs(['creator-center-list', '--status', 'draft', '--search', 'tool']),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], {
    status: 'draft',
    search: 'tool',
    limit: 50,
    offset: 0,
  });
  assert.equal(result.summary.editableDraftCount, 1);
  assert.equal(result.stats.totalInstalls, 8);
});

test('uses the aggregate Stax profile when Creator Center stats are available there', async () => {
  const client = {
    async getMyCreatorItems() {
      return {
        data: [{
          id: 'item-1',
          name: 'Published Skill',
          status: 'published',
          type: 'skill',
          slug: 'published-skill',
        }],
      };
    },
    async getMyStaxProfile() {
      return {
        data: {
          username: 'alice',
          displayName: 'Alice',
          serialNumber: 'TAKU-000417',
          daysOnTaku: 12,
          platform: {
            skillInstallCount: 13,
            publishedItemCount: 2,
          },
          rank: {
            rankGrade: { grade: 'A', label: 'A · Top 5%' },
          },
        },
      };
    },
    async getMyCreatorStats() {
      return { data: { totalInstalls: 8 } };
    },
  };
  const result = await runCreatorCenterList(
    parseArgs(['creator-center-list']),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );

  assert.equal(result.account.username, 'alice');
  assert.equal(result.account.creatorPageUrl, 'https://taku.ai/profile/alice');
  assert.equal(result.items[0].publicItemUrl, 'https://taku.ai/stax/alice/published-skill');
  assert.equal(result.stats.skillInstallCount, 13);
  assert.equal(result.stats.serialNumber, 'TAKU-000417');
  assert.deepEqual(result.stats.rankGrade, { grade: 'A', label: 'A · Top 5%' });
});

test('returns a Publisher handoff for published item updates', async () => {
  const client = {
    async updateCreatorItemManagement() {
      return {
        response: { ok: false, status: 409 },
        parsedJson: true,
        data: {
          error: 'Published item updates must go through Publisher.',
          code: 'publisher_required',
          updateRequiresPublisher: true,
        },
      };
    },
  };
  const result = await runCreatorCenterUpdate(
    parseArgs([
      'creator-center-update',
      '--item-id',
      'item-1',
      '--name',
      'Updated name',
    ]),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );

  assert.equal(result.ok, false);
  assert.equal(result.updateRequiresPublisher, true);
  assert.equal(result.nextAction, 'start_publisher_update');
});

test('requires exact item confirmation before unpublishing', async () => {
  let unpublishCalls = 0;
  const client = {
    async getCreatorItemManagement() {
      return {
        data: {
          id: 'item-1',
          name: 'Published Skill',
          type: 'skill',
          status: 'published',
        },
      };
    },
    async unpublishCreatorItem() {
      unpublishCalls += 1;
      return {
        response: { ok: true, status: 200 },
        parsedJson: true,
        data: {
          ok: true,
          data: {
            id: 'item-1',
            name: 'Published Skill',
            type: 'skill',
            status: 'draft',
          },
        },
      };
    },
  };

  const pending = await runCreatorCenterUnpublish(
    parseArgs(['creator-center-unpublish', '--item-id', 'item-1']),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );
  assert.equal(pending.status, 'confirmation_required');
  assert.equal(pending.requiresAction, true);
  assert.equal(unpublishCalls, 0);

  const completed = await runCreatorCenterUnpublish(
    parseArgs([
      'creator-center-unpublish',
      '--item-id',
      'item-1',
      '--confirm-item-id',
      'item-1',
    ]),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );
  assert.equal(completed.ok, true);
  assert.equal(completed.status, 'unpublished');
  assert.equal(completed.item.status, 'draft');
  assert.equal(completed.preserved.versions, true);
  assert.equal(unpublishCalls, 1);
});

test('rejects a mismatched unpublish confirmation without mutating', async () => {
  let unpublishCalls = 0;
  const client = {
    async getCreatorItemManagement() {
      return {
        data: {
          id: 'item-1',
          name: 'Published Skill',
          type: 'skill',
          status: 'published',
        },
      };
    },
    async unpublishCreatorItem() {
      unpublishCalls += 1;
      throw new Error('must not be called');
    },
  };

  const result = await runCreatorCenterUnpublish(
    parseArgs([
      'creator-center-unpublish',
      '--item-id',
      'item-1',
      '--confirm-item-id',
      'item-2',
    ]),
    { client, token: 'test-token', siteUrl: 'https://taku.ai' },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'confirmation_item_mismatch');
  assert.equal(unpublishCalls, 0);
});
