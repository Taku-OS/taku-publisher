import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createTakuAgentAssetPlayback } from './asset-playback';
import type { TakuAgentAssetOpenOptions } from './client';
import type { TakuAgentAssetOpenResult } from './types';

const NOW = 1_800_000_000_000;
const SCOPE = `scope_${'a'.repeat(43)}`;

class Visibility extends EventTarget {
  hidden = false;
  setHidden(value: boolean) {
    this.hidden = value;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

class Media extends EventTarget {
  private source = '';
  currentTime = 0;
  duration = 4;
  paused = true;
  playbackRate = 1;
  error: { code: number } | null = null;
  playCount = 0;
  get src() {
    return this.source;
  }
  set src(value: string) {
    this.source = value;
    this.currentTime = 0;
    this.paused = true;
  }
  get currentSrc() {
    return this.src;
  }
  load() {}
  async play() {
    this.paused = false;
    this.playCount += 1;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
}

function grant(index: number, expiresAt = Date.now() + 60_000): TakuAgentAssetOpenResult {
  return {
    playbackUrl: `taku://file/subapp-asset/test-${index}`,
    expiresAt: new Date(expiresAt).toISOString(),
    methods: ['GET', 'HEAD'],
    acceptRanges: 'bytes',
  };
}

async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function setup(t: TestContext, open?: () => Promise<TakuAgentAssetOpenResult>) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const element = new Media();
  const visibility = new Visibility();
  const calls: { assetRef: string; options?: TakuAgentAssetOpenOptions }[] = [];
  const errors: unknown[] = [];
  const lease = createTakuAgentAssetPlayback({
    client: {
      async openAsset(assetRef, options) {
        calls.push({ assetRef, options });
        return open ? open() : grant(calls.length);
      },
    },
    assetRef: 'asset_fixture',
    expectedRecoveryScope: SCOPE,
    element: element as unknown as HTMLVideoElement,
    visibility,
    onError: (error) => errors.push(error),
  });
  t.after(() => lease.dispose());
  return { element, visibility, calls, errors, lease };
}

test('renews the same asset before expiry and preserves playing video position', async (t) => {
  const { element, calls } = setup(t);
  await settle();
  element.currentTime = 2;
  element.paused = false;
  element.playbackRate = 1.5;
  t.mock.timers.tick(55_000);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(
    calls.every((call) => call.assetRef === 'asset_fixture'),
    true
  );
  assert.equal(
    calls.every((call) => call.options?.expectedRecoveryScope === SCOPE),
    true
  );
  assert.equal(
    calls.every((call) => call.options?.signal === undefined),
    true
  );
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.currentTime, 2);
  assert.equal(element.paused, false);
  assert.equal(element.playbackRate, 1.5);
  assert.equal(element.playCount, 1);
});

test('paused seek position is clamped and never starts playback on renewal', async (t) => {
  const { element, lease } = setup(t);
  await settle();
  element.currentTime = 3;
  await lease.refresh();
  element.duration = 2;
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.currentTime, 2);
  assert.equal(element.paused, true);
  assert.equal(element.playCount, 0);
});

test('session-clipped and sub-margin grants wait until expiry without a refresh storm', async (t) => {
  let expiresAt = NOW + 60_000;
  const { calls } = setup(t, async () => grant(1, expiresAt));
  await settle();
  t.mock.timers.tick(55_000);
  await settle();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(5_000);
  await settle();
  assert.equal(calls.length, 2);
  expiresAt = Date.now() + 1_001;
  t.mock.timers.tick(1);
  await settle();
  assert.equal(calls.length, 3);
  t.mock.timers.tick(999);
  await settle();
  assert.equal(calls.length, 3);
});

test('concurrent renewals coalesce and hidden late grants cannot overwrite the visible lease', async (t) => {
  const resolvers: ((value: TakuAgentAssetOpenResult) => void)[] = [];
  const { calls, visibility, element, lease } = setup(
    t,
    () => new Promise((resolve) => resolvers.push(resolve))
  );
  void lease.refresh();
  void lease.refresh();
  assert.equal(calls.length, 1);
  visibility.setHidden(true);
  visibility.setHidden(false);
  resolvers[0](grant(1));
  await settle();
  assert.equal(element.src, '');
  assert.equal(calls.length, 2);
  resolvers[1](grant(2));
  await settle();
  assert.equal(element.src, grant(2).playbackUrl);
});

test('hidden pages stop renewal; visible pages reopen an expired asset once', async (t) => {
  const { calls, visibility } = setup(t);
  await settle();
  visibility.setHidden(true);
  t.mock.timers.tick(600_001);
  await settle();
  assert.equal(calls.length, 1);
  visibility.setHidden(false);
  await settle();
  assert.equal(calls.length, 2);
});

test('dispose ignores in-flight responses and removes metadata/error/visibility listeners', async (t) => {
  let resolve!: (value: TakuAgentAssetOpenResult) => void;
  const { lease, calls, element, visibility } = setup(
    t,
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  lease.dispose();
  resolve(grant(1));
  await settle();
  element.error = { code: 2 };
  element.dispatchEvent(new Event('error'));
  element.dispatchEvent(new Event('loadedmetadata'));
  visibility.setHidden(false);
  await lease.refresh();
  t.mock.timers.tick(600_000);
  assert.equal(calls.length, 1);
  assert.equal(element.src, '');
});

test('a network error gets one recovery only; explicit retry never starts a run', async (t) => {
  const { lease, calls, element, errors } = setup(t);
  await settle();
  element.error = { code: 2 };
  element.dispatchEvent(new Event('error'));
  await settle();
  assert.equal(calls.length, 2);
  element.dispatchEvent(new Event('error'));
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 1);
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(calls.length, 2);
  await lease.refresh();
  assert.equal(calls.length, 3);
});

test('failed renewal stops timers and seeking/visibility cannot silently loop retries', async (t) => {
  let failed = false;
  const { calls, element, visibility, errors, lease } = setup(t, async () => {
    if (failed) throw new Error('offline');
    return grant(1);
  });
  await settle();
  failed = true;
  t.mock.timers.tick(55_000);
  await settle();
  t.mock.timers.tick(600_000);
  element.dispatchEvent(new Event('seeking'));
  visibility.setHidden(true);
  visibility.setHidden(false);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 1);
  failed = false;
  await lease.refresh();
  assert.equal(calls.length, 3);
});

test('images use the same expiry and bounded error recovery lifecycle', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  const image = Object.assign(new EventTarget(), {
    src: '',
    removeAttribute() {
      this.src = '';
    },
  });
  let calls = 0;
  const lease = createTakuAgentAssetPlayback({
    client: {
      async openAsset() {
        return grant(++calls);
      },
    },
    assetRef: 'asset_image',
    expectedRecoveryScope: SCOPE,
    element: image as unknown as HTMLImageElement,
    visibility: new Visibility(),
  });
  t.after(() => lease.dispose());
  await settle();
  t.mock.timers.tick(55_000);
  await settle();
  assert.equal(calls, 2);
  image.dispatchEvent(new Event('error'));
  await settle();
  assert.equal(calls, 3);
  lease.dispose();
  assert.equal(image.src, '');
});

test('metadata arriving while hidden defers seek and playback until visible exactly once', async (t) => {
  const { lease, element, visibility, calls } = setup(t);
  await settle();
  element.currentTime = 2;
  element.paused = false;
  element.playbackRate = 1.5;
  await lease.refresh();
  visibility.setHidden(true);
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.currentTime, 0);
  assert.equal(element.paused, true);
  assert.equal(element.playCount, 0);
  visibility.setHidden(false);
  assert.equal(element.currentTime, 2);
  assert.equal(element.paused, false);
  assert.equal(element.playbackRate, 1.5);
  assert.equal(element.playCount, 1);
  visibility.setHidden(false);
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.playCount, 1);
  assert.equal(calls.length, 2);
});

test('network errors while hidden recover once on visibility without resetting the retry budget', async (t) => {
  const { element, visibility, calls, errors } = setup(t);
  await settle();
  visibility.setHidden(true);
  element.error = { code: 2 };
  element.dispatchEvent(new Event('error'));
  element.dispatchEvent(new Event('error'));
  assert.equal(calls.length, 1);
  visibility.setHidden(false);
  await settle();
  assert.equal(calls.length, 2);
  visibility.setHidden(true);
  element.dispatchEvent(new Event('error'));
  visibility.setHidden(false);
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(errors.length, 1);
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(calls.length, 2);
});

test('hidden network recovery coalesces with an in-flight renewal and ignores its stale metadata', async (t) => {
  const resolvers: ((value: TakuAgentAssetOpenResult) => void)[] = [];
  const { lease, element, visibility, calls } = setup(
    t,
    () => new Promise((resolve) => resolvers.push(resolve))
  );
  resolvers[0](grant(1));
  await settle();
  element.currentTime = 2;
  element.paused = false;
  void lease.refresh();
  visibility.setHidden(true);
  element.error = { code: 2 };
  element.dispatchEvent(new Event('error'));
  visibility.setHidden(false);
  assert.equal(calls.length, 2);
  resolvers[1](grant(2));
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(element.src, grant(1).playbackUrl);
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.playCount, 0);
  resolvers[2](grant(3));
  await settle();
  element.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(element.currentTime, 2);
  assert.equal(element.paused, false);
  assert.equal(element.playCount, 1);
});
