import type { TakuAgentClient } from './client';
import { validateTakuAgentRecoveryScope } from './contract';

const RENEW_BEFORE_MS = 5_000;

export type TakuAgentAssetPlaybackOptions = {
  client: Pick<TakuAgentClient, 'openAsset'>;
  assetRef: string;
  /** The authenticated scope which produced this asset, not a newly refreshed scope. */
  expectedRecoveryScope: string;
  element: HTMLImageElement | HTMLMediaElement;
  visibility?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  onChange?: (grant: { expiresAt: string }) => void;
  onError?: (error: unknown) => void;
};

export type TakuAgentAssetPlayback = {
  /** Explicit playback-only retry. Never starts or replays a generation operation. */
  refresh: () => Promise<void>;
  /** One automatic media-network-error recovery per lease (reset by explicit refresh). */
  recover: () => Promise<void>;
  dispose: () => void;
};

/**
 * Own an element's ephemeral src while retaining only its Host assetRef and original
 * scope. Do not also set src from a UI framework. Dispose when the element unmounts.
 * Failures stop automatic retries and are reported through onError.
 */
export function createTakuAgentAssetPlayback(
  options: TakuAgentAssetPlaybackOptions
): TakuAgentAssetPlayback {
  const expectedRecoveryScope = validateTakuAgentRecoveryScope(options.expectedRecoveryScope);
  const { element } = options;
  const media = 'currentTime' in element ? element : null;
  const visibility = options.visibility ?? (typeof document === 'undefined' ? undefined : document);
  let disposed = false;
  let stopped = false;
  let generation = 0;
  let requestGeneration = 0;
  let pending: Promise<void> | null = null;
  let queuedRefresh = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ownedUrl = '';
  let expiresAt = 0;
  let renewAt = 0;
  let recovered = false;
  let hiddenNetworkError = false;
  let hiddenMetadataReady = false;
  let restore: { time: number; paused: boolean; rate: number } | null = null;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function fail(error: unknown) {
    stopped = true;
    queuedRefresh = false;
    clearTimer();
    options.onError?.(error);
  }

  function schedule() {
    clearTimer();
    if (disposed || stopped || visibility?.hidden || !expiresAt) return;
    timer = setTimeout(
      () => {
        void renew();
      },
      Math.max(1, renewAt - Date.now())
    );
  }

  function renew(): Promise<void> {
    if (disposed || stopped || visibility?.hidden) return Promise.resolve();
    if (pending) {
      // A request begun before hiding must settle before a fresh visible request.
      // Do not abort it: the SDK may share an authenticated signing queue with runs.
      if (requestGeneration !== generation) queuedRefresh = true;
      return pending;
    }
    clearTimer();
    const currentGeneration = generation;
    requestGeneration = generation;
    pending = (async () => {
      try {
        const opened = await options.client.openAsset(options.assetRef, { expectedRecoveryScope });
        if (disposed || stopped || currentGeneration !== generation || visibility?.hidden) return;
        const nextExpiry = Date.parse(opened.expiresAt);
        if (!Number.isFinite(nextExpiry) || nextExpiry <= Date.now()) {
          throw new Error('The Host returned an expired playback grant');
        }
        if (media && ownedUrl && !restore) {
          restore = { time: media.currentTime, paused: media.paused, rate: media.playbackRate };
        }
        // Near the absolute session boundary a new grant may have the same expiry,
        // or only milliseconds left. Wait past that boundary instead of spinning.
        renewAt =
          nextExpiry <= expiresAt || nextExpiry - Date.now() <= RENEW_BEFORE_MS
            ? nextExpiry + 1
            : nextExpiry - RENEW_BEFORE_MS;
        expiresAt = nextExpiry;
        ownedUrl = opened.playbackUrl;
        hiddenMetadataReady = false;
        element.src = ownedUrl;
        media?.load();
        options.onChange?.({ expiresAt: opened.expiresAt });
        schedule();
      } catch (error) {
        if (!disposed && currentGeneration === generation && !visibility?.hidden) fail(error);
      }
    })().finally(() => {
      pending = null;
      if (queuedRefresh) {
        queuedRefresh = false;
        void renew();
      }
    });
    return pending;
  }

  function onMetadata() {
    if (disposed || stopped || !media || media.currentSrc !== ownedUrl || !restore) return;
    if (visibility?.hidden) {
      hiddenMetadataReady = true;
      return;
    }
    hiddenMetadataReady = false;
    const saved = restore;
    restore = null;
    const duration = Number.isFinite(media.duration) ? media.duration : saved.time;
    media.currentTime = Math.max(0, Math.min(saved.time, duration));
    media.playbackRate = saved.rate;
    if (!saved.paused)
      void media.play().catch(() => {
        // A browser autoplay restriction is not an expired grant. Keep native controls.
      });
  }

  function recover(): Promise<void> {
    if (disposed || stopped) return Promise.resolve();
    if (visibility?.hidden) {
      hiddenNetworkError = true;
      return Promise.resolve();
    }
    hiddenNetworkError = false;
    if (recovered) {
      fail(new Error('Playback could not be recovered; retry playback explicitly'));
      return Promise.resolve();
    }
    recovered = true;
    return renew();
  }

  function onMediaError() {
    if (media && media.error?.code !== 2) return;
    void recover();
  }

  function onAccess() {
    if (Date.now() >= renewAt) void renew();
  }

  function onVisibility() {
    if (visibility?.hidden) {
      generation += 1;
      queuedRefresh = false;
      clearTimer();
    } else if (hiddenNetworkError) {
      void recover();
    } else if (!expiresAt || Date.now() >= renewAt || pending) {
      void renew();
    } else {
      if (hiddenMetadataReady) onMetadata();
      schedule();
    }
  }

  element.addEventListener('error', onMediaError);
  media?.addEventListener('loadedmetadata', onMetadata);
  media?.addEventListener('play', onAccess);
  media?.addEventListener('seeking', onAccess);
  visibility?.addEventListener('visibilitychange', onVisibility);
  void renew();

  return {
    refresh() {
      stopped = false;
      recovered = false;
      return renew();
    },
    recover,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      queuedRefresh = false;
      hiddenNetworkError = false;
      hiddenMetadataReady = false;
      restore = null;
      clearTimer();
      element.removeEventListener('error', onMediaError);
      media?.removeEventListener('loadedmetadata', onMetadata);
      media?.removeEventListener('play', onAccess);
      media?.removeEventListener('seeking', onAccess);
      visibility?.removeEventListener('visibilitychange', onVisibility);
      if (ownedUrl && element.src === ownedUrl) {
        element.removeAttribute('src');
        media?.load();
      }
    },
  };
}
