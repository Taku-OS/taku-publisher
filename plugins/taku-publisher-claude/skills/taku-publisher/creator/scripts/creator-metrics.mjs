import * as path from 'node:path';

import {
  createEmptyCreatorMetrics,
  normalizeCreatorMetrics,
} from '#taku-passport-core';
import {
  getFlag,
  hasFlag,
  redactPath,
} from './cli.mjs';
import { readJsonFile } from './draft-state.mjs';
import { createTakuStaxClient } from './publish-client.mjs';
import { readPublishToken, resolveWorkerUrl } from './publish-config.mjs';
import { cleanText } from './privacy.mjs';
import { asRecord } from './usage.mjs';

export {
  createEmptyCreatorMetrics,
  isMetricTopPercent,
  mergeCreatorMetrics,
  metricTopPercent,
  normalizeCreatorMetrics,
  topPercentEvidence,
} from '#taku-passport-core';

export async function loadCreatorMetrics(parsed) {
  const explicitPath =
    getFlag(parsed, 'creator-metrics') ||
    getFlag(parsed, 'metrics') ||
    process.env.TAKU_CREATOR_METRICS_PATH;
  if (!explicitPath) return createEmptyCreatorMetrics();
  const candidatePath = path.resolve(explicitPath);
  const raw = await readJsonFile(candidatePath);
  if (!raw) {
    return createEmptyCreatorMetrics({
      warnings: [
        `Creator metrics file could not be read: ${redactPath(candidatePath)}`,
      ],
    });
  }
  return normalizeCreatorMetrics(raw, {
    source: 'creator-metrics-file',
    path: redactPath(candidatePath),
  });
}

export async function fetchCreatorMetricsFromWorker(parsed) {
  const shouldFetch =
    hasFlag(parsed, 'fetch-creator-stats') ||
    hasFlag(parsed, 'creator-stats') ||
    process.env.TAKU_FETCH_CREATOR_STATS === '1';
  if (!shouldFetch) return createEmptyCreatorMetrics();
  const token = readPublishToken(parsed);
  if (!token) {
    return createEmptyCreatorMetrics({
      warnings: ['Creator stats fetch skipped: missing Taku bearer token.'],
    });
  }
  const workerUrl = resolveWorkerUrl(parsed);
  if (!workerUrl) {
    return createEmptyCreatorMetrics({
      warnings: ['Creator stats fetch skipped: missing worker URL.'],
    });
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const warnings = [];
  const staxProfileEndpoint = `${workerUrl}/stax/profile`;
  const staxProfileResult = await fetchOptionalWorkerJson(staxProfileEndpoint, {
    method: 'GET',
    headers,
  });
  if (staxProfileResult.ok) {
    return normalizeCreatorMetrics(
      creatorMetricsFromStaxProfile(extractWorkerPayload(staxProfileResult.data)),
      {
        source: 'taku-worker-stax-profile',
        warnings,
      },
    );
  }
  if (staxProfileResult.status && staxProfileResult.status !== 404) {
    warnings.push(staxProfileResult.warning);
  }

  const statsEndpoint = `${workerUrl}/stax/creators/me/stats`;
  const statsResult = await fetchOptionalWorkerJson(statsEndpoint, {
    method: 'GET',
    headers,
  });
  if (statsResult.ok) {
    return normalizeCreatorMetrics(extractWorkerPayload(statsResult.data), {
      source: 'taku-worker-creator-stats',
      warnings,
    });
  }
  if (statsResult.status && statsResult.status !== 404) {
    warnings.push(statsResult.warning);
  }

  const profileEndpoint = `${workerUrl}/stax/creators/me`;
  const profileResult = await fetchOptionalWorkerJson(profileEndpoint, {
    method: 'GET',
    headers,
  });
  if (!profileResult.ok) {
    warnings.push(
      profileResult.warning || 'Creator profile stats unavailable.',
    );
    return createEmptyCreatorMetrics({ warnings });
  }

  const profile = asRecord(extractWorkerPayload(profileResult.data)) || {};
  const subscriberResult = await fetchOptionalWorkerJson(
    `${workerUrl}/stax/subscriptions/subscribers`,
    { method: 'GET', headers },
  );
  const subscriberPayload = subscriberResult.ok
    ? asRecord(extractWorkerPayload(subscriberResult.data))
    : {};
  if (
    !subscriberResult.ok &&
    subscriberResult.status &&
    subscriberResult.status !== 404
  ) {
    warnings.push(subscriberResult.warning);
  }

  return normalizeCreatorMetrics(
    {
      taku: {
        ...profile,
        skillInstallCount:
          profile.totalInstalls ?? profile.total_installs,
        publishedItemCount:
          profile.publishedItemCount ??
          profile.published_item_count ??
          profile.toolCount ??
          profile.tool_count,
        subscriberCount:
          profile.subscriberCount ??
          profile.subscriber_count ??
          subscriberPayload.total,
      },
    },
    {
      source: 'taku-worker-creator-profile',
      warnings,
    },
  );
}

function creatorMetricsFromStaxProfile(profile) {
  const record = asRecord(profile) || {};
  const platform = asRecord(record.platform) || {};
  const rank = asRecord(record.rank) || {};
  return {
    taku: {
      ...platform,
      ...(record.handle ? { username: record.handle } : {}),
      ...(record.username ? { username: record.username } : {}),
      ...(record.daysOnTaku !== undefined ? { daysOnTaku: record.daysOnTaku } : {}),
      ...(record.serialNumber ? { serialNumber: record.serialNumber } : {}),
      rankGrade: rank.rankGrade,
      percentiles: rank.percentiles,
      topPercentiles: rank.topPercentiles,
    },
    rankGrade: rank.rankGrade,
    percentiles: rank.percentiles,
    topPercentiles: rank.topPercentiles,
  };
}

async function fetchOptionalWorkerJson(endpoint, init) {
  try {
    const { response, data, parsedJson } =
      await createTakuStaxClient().fetchJson(endpoint, init, { token: null });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data,
        warning: parsedJson
          ? `Worker ${response.status} at ${new URL(endpoint).pathname}: ${
              cleanText(data?.error || data?.message, 180) ||
              'request failed'
            }`
          : `Worker ${response.status} at ${
              new URL(endpoint).pathname
            }: non-JSON response`,
      };
    }
    return { ok: true, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {},
      warning: `Worker request failed at ${safeEndpointPath(endpoint)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function safeEndpointPath(endpoint) {
  try {
    return new URL(endpoint).pathname;
  } catch {
    return 'worker endpoint';
  }
}

function extractWorkerPayload(payload) {
  const record = asRecord(payload) || {};
  return record.data ?? record.stats ?? record.profile ?? record.creator ?? record;
}
