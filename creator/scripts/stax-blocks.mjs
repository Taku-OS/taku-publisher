import { cleanText, isRecord } from './privacy.mjs';

export const STAX_BLOCKS_SCHEMA = 'taku.stax.blocks.v1';

export const STAX_BLOCK_KEYS = [
  'hero',
  'team',
  'type',
  'tier1',
  'aura',
  'basic',
  'seal',
  'bars90',
  'pie',
  'cgauge',
  'rings',
  'ctxring',
  'clock',
  'heat',
  'dots',
  'water',
  'vsavg',
  'trend',
  'tally',
  'dial',
  'wave',
  'peaks',
  'ratio',
  'badges',
  'tools',
  'stadium',
  'knock',
  'bracket',
  'tier4',
  'node',
  'splitring',
];

const SERVER_BLOCK_KEYS = new Set(['tier1', 'aura', 'basic', 'seal', 'cgauge', 'water', 'tally', 'dial', 'tier4']);
const COMMUNITY_RANK_LOCK_LABEL = 'GROW ON TAKU';
const COMMUNITY_RANK_LOCK_REASON = 'Publish a tool or gain subscribers on Taku to unlock community rank.';
const QUOTA_LOCK_LABEL = 'CONNECT TAKU';
const QUOTA_LOCK_REASON = 'Connect Taku to show monthly quota usage and reset date.';

export function buildStaxBlocks(draft = {}) {
  const usage = record(draft.stats?.usage);
  const localActivity = record(usage.localActivity);
  const sessionSplit = record(localActivity.sessionSplit);
  const behaviorProfile = firstRecord(
    usage.behaviorProfile,
    usage.behaviorProfileV1,
    draft.behaviorProfileV1,
    draft.personaSignals?.behaviorProfile,
    draft.personaSignals?.behaviorProfileV1,
  );
  const modelUsage = record(usage.modelUsage);
  const usagePeriodId = clean(usage.periodId || usage.primaryPeriodId || localActivity.period?.id, 80) || 'thisMonth';
  const usagePeriodLabel = clean(usage.label || usage.periodLabel || localActivity.period?.label, 80) || 'This Month';
  const staxProfile = record(draft.staxProfile);
  const serverBlocks = record(staxProfile.blocks);
  const external = firstRecord(
    draft.personaSignals?.external,
    draft.creatorStats,
    draft.externalMetrics,
  );
  const platform = {
    ...record(external.taku),
    ...record(staxProfile.platform),
  };
  const rank = {
    ...record(external),
    ...record(staxProfile.rank),
  };
  const persona = record(draft.personaV2);
  const archetype = record(persona.archetype);
  const identity = record(persona.identity);
  const hidden = record(identity.hidden);
  const badges = pickBadges(persona, staxProfile);
  const capabilityItems = inventoryItems(draft, ['creator-tools']);
  const capabilityCategories = capabilityTypeMix(capabilityItems);
  const tools = inventoryItems(draft, ['creator-tools', 'using-tools']).slice(0, 3);
  const madeItems = inventoryItems(draft, ['made-items']);
  const dailyHeatmap = array(localActivity.dailyHeatmap);
  const heatDays = dailyHeatmap
    .map((row) => ({
      date: clean(row?.date, 20),
      observed: true,
      builds: integer(row?.buildSessionCount),
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-90);
  const heatComplete90Days = heatDays.length === 90 && hasConsecutiveDates(heatDays);
  const trendBuckets = array(localActivity.trend30d?.buckets);
  const observedTrendBuckets = trendBuckets
    .filter((bucket) => integer(bucket.activeDayCount) > 0 || integer(bucket.buildSessionCount) > 0)
    .slice(-5)
    .map(safeTrendBucket);
  const buildMomentum = buildMomentumFromBuckets(observedTrendBuckets);
  const trendBuildCount = observedTrendBuckets.reduce(
    (sum, bucket) => sum + bucket.buildSessionCount,
    0,
  );
  const trendObservedDayCount = observedTrendBuckets.reduce(
    (sum, bucket) => sum + bucket.activeDayCount,
    0,
  );
  const topModels = topModelRows(modelUsage);
  const workPattern = record(localActivity.workPattern);
  const hasActiveHourPattern = integer(workPattern.activeHourCount) > 0 || array(workPattern.hourBuckets).some((count) => integer(count) > 0);
  const topPercent = firstPositiveNumber(
    staxProfile.rank?.topPercent,
    staxProfile.rank?.rankGrade?.topPercent,
    rank.rankGrade?.topPercent,
    external.rankGrade?.topPercent,
  );
  const totalTokens = integer(usage.totalTokens || modelUsage.totalTokens);
  const allTimeUsage = usagePeriodById(usage, 'allTimeLocal');
  const allTimeTokens = integer(allTimeUsage.totalTokens || allTimeUsage.modelUsage?.totalTokens);
  const usageScanCoverage = record(usage.scanCoverage);
  const usageScanPartial = usage.partial === true || usageScanCoverage.partial === true;
  const hasCompleteAllTime = !usageScanPartial && usageScanCoverage.periodFiltered !== true && allTimeTokens > 0;
  const stadiumTokens = hasCompleteAllTime ? allTimeTokens : totalTokens;
  const stadiumPeriodId = hasCompleteAllTime ? 'allTimeLocal' : usagePeriodId;
  const stadiumPeriodLabel = usageScanPartial
    ? 'Observed Sample'
    : hasCompleteAllTime
      ? 'All Time'
      : usagePeriodLabel;
  const eventCount = integer(usage.eventCount || modelUsage.observedEventCount);
  const promptCount = integer(behaviorProfile.userTurnCount);
  const buildSessionCount = integer(sessionSplit.buildSessionCount || localActivity.buildSessionCount);
  const trustedShipValue = staxProfile.platform?.publishedItemCount;
  const hasTrustedShipCount = trustedShipValue !== undefined &&
    trustedShipValue !== null &&
    Number.isFinite(Number(trustedShipValue));
  const shipCount = hasTrustedShipCount ? integer(trustedShipValue) : 0;
  const averageInput = averageInputPerRequest(modelUsage, eventCount);
  const toolCallCount = integer(localActivity.toolCallCount) ||
    dailyHeatmap.reduce((sum, row) => sum + integer(row.toolCallCount), 0);
  const daysOnTaku = integer(staxProfile.daysOnTaku);
  const serial = clean(staxProfile.serial?.display || staxProfile.serial || displaySerial(staxProfile.serialNumber), 80);
  const handle = clean(staxProfile.handle || staxProfile.username || draft.creator?.username || draft.creator?.handle, 80);
  const family = clean(staxProfile.family || persona.family || familyForPersonaCode(persona.code), 80);
  const tokens90d = tokenBuckets(dailyHeatmap, 12);
  const observedTokenBucketCount = tokens90d.filter((value) => Number(value) > 0.02).length;
  const isPartialTokenSample = usageScanPartial || (dailyHeatmap.length > 0 && dailyHeatmap.length < 30);
  const tokenBarsNeedDisplayScaffold = isPartialTokenSample || observedTokenBucketCount < 4;
  const blockByKey = {
    hero: supportedIf(persona.code || archetype.title, 'publisher.persona', {
      n1: clean(archetype.title || persona.title || persona.code, 80),
      n2: clean(archetype.subtitle || persona.subtitle, 120),
      type: clean(persona.code, 20),
      handle,
      family,
      signature: clean(archetype.signature || persona.signature, 180),
    }, 'persona summary is not available yet'),
    team: supportedIf(array(usage.sources).length, 'publisher.usage.sources', {
      team: primaryTeam(usage.sources),
      sources: array(usage.sources).slice(0, 4).map((source) => ({
        source: clean(source?.source, 80),
        label: clean(source?.label, 80),
      })),
    }, 'no Codex or Claude Code usage source was found'),
    type: supportedIf(persona.code, 'publisher.persona', {
      type: clean(persona.code, 20),
      axes: array(persona.axes).slice(0, 4),
      influences: array(persona.influences).slice(0, 4),
    }, 'persona type is not available yet'),
    tier1: serverOrFallback(serverBlocks, 'tier1', supportedIf(topPercent > 0, 'server.rank', {
      tier: ladderTier(topPercent),
    }, COMMUNITY_RANK_LOCK_REASON, 'supported', {
      lockLabel: COMMUNITY_RANK_LOCK_LABEL,
    })),
    aura: serverOrFallback(serverBlocks, 'aura', rankBlock(topPercent, 0.01, 'REACH TOP 1%')),
    basic: serverOrFallback(serverBlocks, 'basic', supportedIf(daysOnTaku > 0, 'server.profile', {
      basicLbl: 'DAYS · ON TAKU',
      basicVal: String(daysOnTaku),
    }, 'days on Taku requires a signed-in Taku profile')),
    seal: serverOrFallback(serverBlocks, 'seal', supportedIf(serial, 'server.profile', {
      serial,
      serialNumber: clean(staxProfile.serialNumber, 80),
    }, 'serial number requires a minted Taku profile')),
    bars90: supportedIf(dailyHeatmap.length || totalTokens > 0, 'publisher.local_usage', {
      tokens90d,
      visualBuckets: visualTokenBuckets(tokens90d, tokenBarsNeedDisplayScaffold),
      tokens90dTotal: compactNumber(totalTokens || sumField(dailyHeatmap, 'tokenCount')),
      dayCount: dailyHeatmap.length,
      observedBucketCount: observedTokenBucketCount,
      isPartialSample: isPartialTokenSample,
      periodId: usagePeriodId,
      periodLabel: usageScanPartial ? 'Observed Sample' : usagePeriodLabel,
    }, 'no local token activity was found', dailyHeatmap.length >= 30 && !usageScanPartial ? 'supported' : 'partial', dailyHeatmap.length >= 30 && !usageScanPartial ? {} : qualityMeta(
      usageScanPartial ? 'bounded_scan' : 'partial_period',
      '部分样本',
      usageScanPartial
        ? 'The local usage scan reached its safety budget; this card uses a bounded recent sample.'
        : `Only ${dailyHeatmap.length} local activity day(s) are available for this period; the 90-day view is incomplete.`,
    )),
    pie: supportedIf(topModels.length, 'publisher.local_usage', {
      modelMix: topModels.slice(0, 3).map((model) => ({
        name: clean(model.name || model.modelId, 120),
        share: ratio(model.share),
        percentage: clean(model.percentage, 20),
      })),
      periodId: usagePeriodId,
    }, 'model mix is unavailable in the scanned local usage logs', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Model mix is computed from scanned local Codex/Claude logs, not provider billing records.',
    )),
    cgauge: quotaBlock(serverBlocks),
    rings: supportedIf(promptCount || buildSessionCount || hasTrustedShipCount, 'publisher.activity_snapshot', {
      metrics: [
        activityMetric('prompts', 'PROMPTS', promptCount, {
          available: promptCount > 0,
          periodLabel: usagePeriodLabel,
          source: 'publisher.local_usage.user_turns',
          confidence: 'medium',
        }),
        activityMetric('builds', 'BUILDS', buildSessionCount, {
          available: buildSessionCount > 0,
          periodLabel: usagePeriodLabel,
          source: 'publisher.local_activity.build_sessions',
          confidence: 'medium',
        }),
        activityMetric('ships', 'SHIPS', shipCount, {
          available: hasTrustedShipCount,
          periodLabel: 'All Time',
          source: 'server.creator_stats',
          confidence: hasTrustedShipCount ? 'high' : 'unavailable',
          verified: hasTrustedShipCount,
        }),
      ],
      streakToday: integer(localActivity.buildStreak?.currentDays),
      streakLabel: 'LOCAL BUILD-DAY STREAK',
      periodId: usagePeriodId,
      periodLabel: usagePeriodLabel,
      coverage: {
        startsAt: clean(localActivity.period?.startsAt, 80),
        endsAt: clean(localActivity.period?.endsAt, 80),
        activeDayCount: integer(localActivity.activeDayCount),
      },
      sourceLabel: hasTrustedShipCount ? 'LOCAL LOGS + TAKU' : 'LOCAL LOGS',
    }, 'activity snapshot requires local usage or trusted Taku ship stats', 'partial', qualityMeta(
      'mixed_sources',
      '本地推导 + Taku',
      'Prompts are observed local user turns, builds are locally classified sessions, and ships are verified all-time Taku stats when available.',
      true,
    )),
    ctxring: supportedIf(averageInput, 'publisher.local_usage', averageInput, 'average input tokens require local input-token counts and request counts', 'partial', qualityMeta(
      'local_logs',
      '本地日志',
      'Average input tokens per observed local request.',
      false,
    )),
    clock: supportedIf(hasActiveHourPattern, 'publisher.local_activity', {
      peakH: integer(workPattern.peakHour),
      peakLabel: `PEAK ${String(integer(workPattern.peakHour)).padStart(2, '0')}:00`,
      bird: birdLabel(workPattern),
      band: activeHourBand(workPattern),
      hourBuckets: array(workPattern.hourBuckets).slice(0, 24).map(integer),
      timezone: clean(workPattern.timezone, 40) || 'local',
    }, 'active hour distribution is not available yet'),
    heat: supportedIf(heatDays.length, 'publisher.local_activity', {
      days: heatDays,
      buildsDaily: heatDays.map((row) => row.builds),
      observedDayCount: heatDays.length,
      activeDayCount: integer(localActivity.activeDayCount),
      currentStreak: integer(localActivity.buildStreak?.currentDays),
      bestStreak: integer(localActivity.buildStreak?.bestDays),
      coverage: {
        startsOn: heatDays[0]?.date || '',
        endsOn: heatDays.at(-1)?.date || '',
        observedDayCount: heatDays.length,
        complete90Days: heatComplete90Days,
      },
    }, 'daily heatmap requires local activity logs', heatComplete90Days ? 'supported' : 'partial', heatComplete90Days ? {} : qualityMeta(
      'partial_period',
      '部分样本',
      `Only ${heatDays.length} dated local activity days are available; unobserved dates remain unknown rather than zero.`,
      false,
    )),
    dots: supportedIf(toolCallCount, 'publisher.local_activity.tool_calls', {
      toolCallCount,
      display: compactNumber(toolCallCount),
      periodId: usagePeriodId,
      periodLabel: usagePeriodLabel,
      dailyToolCalls: dailyHeatmap.slice(-15).map((row) => ({
        date: clean(row?.date, 20),
        count: integer(row?.toolCallCount),
      })),
    }, 'no local tool calls were found in the scanned activity logs', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Tool calls are observed in the local usage files included in this scan; this is not a provider API-call total.',
      false,
    )),
    water: serverOrFallback(serverBlocks, 'water', rankBlock(topPercent, Number.POSITIVE_INFINITY, COMMUNITY_RANK_LOCK_REASON)),
    vsavg: serverOrFallback(
      serverBlocks,
      'vsavg',
      unsupported('community token median is not available from the Worker yet'),
    ),
    trend: supportedIf(buildMomentum, 'publisher.local_activity', buildMomentum, 'two comparable observed build periods are required', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Build momentum compares the two latest observed local activity buckets; missing history is never treated as zero.',
      false,
    )),
    tally: serverOrFallback(serverBlocks, 'tally', supportedIf(hasTrustedShipCount, 'server.creator_stats', {
      shipped: shipCount,
    }, 'published Stax count is not available from Taku yet')),
    dial: serverOrFallback(
      serverBlocks,
      'dial',
      unsupported('builder score is not available from the Worker yet'),
    ),
    wave: supportedIf(trendBuildCount > 0, 'publisher.local_activity', {
      waves: observedTrendBuckets,
      totalBuildSessions: trendBuildCount,
      observedDayCount: trendObservedDayCount,
      metric: 'buildSessions',
      periodId: 'last30Days',
    }, 'build rhythm requires observed local build activity', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Build rhythm uses only observed local build-session buckets; unscanned dates are not treated as zero.',
    )),
    peaks: supportedIf(dailyHeatmap.length, 'publisher.local_activity', bestDayValue(dailyHeatmap), 'best-day peak requires daily local activity', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Best-day peak is computed from local daily token/build aggregates.',
    )),
    ratio: supportedIf(modelUsage.totalInputTokens || modelUsage.totalOutputTokens, 'publisher.local_usage', {
      tokensIn: compactNumber(modelUsage.totalInputTokens),
      tokensOut: compactNumber(modelUsage.totalOutputTokens),
      tokensInValue: integer(modelUsage.totalInputTokens),
      tokensOutValue: integer(modelUsage.totalOutputTokens),
      inShare: ratio(modelUsage.totalInputTokens / Math.max(1, modelUsage.totalInputTokens + modelUsage.totalOutputTokens)),
      periodId: usagePeriodId,
      periodLabel: usagePeriodLabel,
    }, 'input/output token split is not available in the scanned logs', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Input/output split is read from local usage logs and may differ from provider billing.',
    )),
    badges: supportedIf(badges.length, 'publisher.persona', {
      badges: badges.slice(0, 2),
      allBadges: badges.slice(0, 12),
    }, 'persona badges are not available yet'),
    tools: supportedIf(tools.length, 'publisher.inventory', {
      tools: tools.map((item) => ({
        name: clean(item.name || item.title, 120),
        type: clean(item.type, 80),
        source: clean(item.source, 80),
      })),
    }, 'no local tools selected for the card yet', 'partial', qualityMeta(
      'partial_selection',
      '待用户选择',
      'Publisher can find tools, but the final public set should be selected by the user.',
    )),
    stadium: supportedIf(stadiumTokens > 0, hasCompleteAllTime
      ? 'publisher.local_usage.all_time'
      : usageScanPartial
        ? 'publisher.local_usage.sample'
        : 'publisher.local_usage', {
      tokensAllTime: compactNumber(stadiumTokens),
      tokensTotal: compactNumber(stadiumTokens),
      allTimeTokens: stadiumTokens,
      totalTokens: stadiumTokens,
      periodId: stadiumPeriodId,
      periodLabel: stadiumPeriodLabel,
    }, 'token total is not available yet', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      hasCompleteAllTime
        ? 'All-time token total is a local scanned aggregate, not an official provider total.'
        : usageScanPartial
          ? 'Token total is a bounded local sample for the selected period, not a complete provider total.'
          : 'Token total is a local scanned aggregate for the selected period, not an official provider total.',
    )),
    knock: supportedIf(eventCount || toolCallCount, 'publisher.local_usage', {
      label: eventCount ? 'EVENTS' : 'TOOL CALLS',
      value: compactNumber(eventCount || toolCallCount),
    }, 'no small stat is available for this slot', 'partial', qualityMeta(
      'local_log',
      '本地日志',
      'Small stat is computed from local event/tool-call counts.',
    )),
    bracket: supportedIf(usage.estimatedCost?.totalUsd || totalTokens, 'publisher.local_usage', {
      label: usage.estimatedCost?.totalUsd ? 'EST. SPEND' : 'TOKENS',
      value: usage.estimatedCost?.totalUsd ? `$${Math.round(Number(usage.estimatedCost.totalUsd))}` : compactNumber(totalTokens),
      estimated: Boolean(usage.estimatedCost?.totalUsd),
      periodId: usagePeriodId,
      periodLabel: usagePeriodLabel,
      priceTableUpdatedAt: clean(usage.estimatedCost?.priceTableUpdatedAt, 40),
      pricedTokenCount: integer(usage.estimatedCost?.pricedTokenCount),
      unpricedTokenCount: integer(usage.estimatedCost?.unpricedTokenCount),
    }, 'no small stat is available for this slot', 'partial', usage.estimatedCost?.totalUsd ? qualityMeta(
      'estimate',
      '估算',
      'Spend is estimated from local token counts and the publisher price table; it is not an official bill.',
      true,
    ) : qualityMeta(
      'local_log',
      '本地日志',
      'Token stat is computed from local scanned logs.',
    )),
    tier4: serverOrFallback(serverBlocks, 'tier4', rankBlock(topPercent, 0.001, 'REACH TOP .1%')),
    node: supportedIf(capabilityItems.length > 0, 'publisher.inventory', {
      totalCount: capabilityItems.length,
      categories: capabilityCategories.slice(0, 4),
      otherCount: capabilityCategories.slice(4).reduce((sum, category) => sum + category.count, 0),
    }, 'no local capabilities were detected for the stack overview', 'partial', qualityMeta(
      'local_inventory',
      '本地扫描',
      'Capability mix is aggregated from locally detected tools without exposing local paths.',
    )),
    splitring: supportedIf(sessionSplit.sessionCount, 'publisher.local_activity', {
      chatShare: ratio(sessionSplit.chatShare || sessionSplit.chatTimeShare),
      buildShare: ratio(sessionSplit.buildShare || sessionSplit.buildTimeShare),
      sessionCount: integer(sessionSplit.sessionCount),
      chatSessionCount: integer(sessionSplit.chatSessionCount),
      buildSessionCount: integer(sessionSplit.buildSessionCount),
      periodId: usagePeriodId,
      periodLabel: usagePeriodLabel,
    }, 'local chat/build session mix is not available yet', 'partial', qualityMeta(
      'estimate',
      '估算',
      'Build/chat session classification is inferred from local tool-call signals and session metadata.',
      true,
    )),
  };

  const blocks = STAX_BLOCK_KEYS.map((key) => normalizeBlock(key, blockByKey[key]));
  return {
    schemaVersion: STAX_BLOCKS_SCHEMA,
    generatedAt: new Date().toISOString(),
    blocks,
    summary: {
      total: blocks.length,
      supported: blocks.filter((block) => block.status === 'supported').length,
      partial: blocks.filter((block) => block.status === 'partial').length,
      unsupported: blocks.filter((block) => block.status === 'unsupported').length,
    },
  };
}

function normalizeBlock(key, block) {
  const raw = record(block);
  const status = ['supported', 'partial', 'unsupported', 'locked'].includes(raw.status)
    ? raw.status
    : raw.supported === false
      ? 'unsupported'
      : 'supported';
  return {
    key,
    status,
    source: clean(raw.source, 120) || (status === 'unsupported' ? 'unavailable' : 'publisher'),
    ...(raw.estimated === true ? { estimated: true } : {}),
    ...(isRecord(raw.quality) ? { quality: normalizeQuality(raw.quality) } : {}),
    ...(raw.confidence !== undefined ? { confidence: ratio(raw.confidence) } : {}),
    ...(raw.lockReason ? { lockReason: clean(raw.lockReason, 160) } : {}),
    ...(raw.lockLabel || raw.lock_label ? { lockLabel: clean(raw.lockLabel || raw.lock_label, 80) } : {}),
    ...(raw.reason ? { reason: clean(raw.reason, 240) } : {}),
    ...(isRecord(raw.value) ? { value: raw.value } : {}),
  };
}

function supportedIf(condition, source, value, reason, status = 'supported', meta = {}) {
  if (condition) return { status, source, value, ...meta };
  return unsupported(reason, meta);
}

function activityMetric(id, label, count, options = {}) {
  const available = options.available !== false;
  return {
    id: clean(id, 40),
    label: clean(label, 40),
    count: available ? integer(count) : null,
    display: available ? compactNumber(count) : '—',
    available,
    periodLabel: clean(options.periodLabel, 80),
    source: clean(options.source, 120),
    confidence: clean(options.confidence, 40),
    verified: options.verified === true,
  };
}

function qualityMeta(kind, label, reason, estimated = false) {
  return {
    ...(estimated ? { estimated: true } : {}),
    quality: {
      kind,
      label,
      reason,
    },
  };
}

function normalizeQuality(value) {
  const raw = record(value);
  return {
    kind: clean(raw.kind, 40) || 'partial',
    label: clean(raw.label, 40) || '部分支持',
    reason: clean(raw.reason, 240),
  };
}

function unsupported(reason, meta = {}) {
  return {
    status: 'unsupported',
    source: clean(meta.source, 120) || 'unavailable',
    reason,
    ...(meta.lockLabel ? { lockLabel: clean(meta.lockLabel, 80) } : {}),
    ...(meta.lockReason ? { lockReason: clean(meta.lockReason, 160) } : {}),
  };
}

function serverOrFallback(serverBlocks, key, fallback) {
  const server = record(serverBlocks[key]);
  if (Object.keys(server).length === 0) return fallback;
  if (server.supported === false) {
    const {
      supported,
      source,
      reason,
      lockLabel,
      lock_label: lockLabelLegacy,
      lockReason,
      lock_reason: lockReasonLegacy,
      ...value
    } = server;
    return {
      ...unsupported(reason || `${key} is unavailable from the server`, {
        source: clean(source, 120) || (SERVER_BLOCK_KEYS.has(key) ? 'server' : 'server.profile'),
        lockLabel: lockLabel || lockLabelLegacy,
        lockReason: lockReason || lockReasonLegacy,
      }),
      ...(Object.keys(value).length ? { value } : {}),
    };
  }
  const { supported, ...value } = server;
  return {
    status: 'supported',
    source: clean(server.source, 120) || (SERVER_BLOCK_KEYS.has(key) ? 'server' : 'server.profile'),
    value,
  };
}

function quotaBlock(serverBlocks) {
  const server = record(serverBlocks.cgauge);
  const fallback = unsupported('monthly quota and reset date are not available from local Codex or Claude Code data', {
    lockLabel: QUOTA_LOCK_LABEL,
    lockReason: QUOTA_LOCK_REASON,
  });
  if (Object.keys(server).length === 0) return fallback;

  const status = clean(server.status, 40).toLowerCase();
  if (server.supported === false || server.available === false || status === 'unsupported' || status === 'locked') {
    return unsupported(server.reason || 'monthly quota and reset date are not available from Taku billing data', {
      source: server.source || 'server.billing_quota',
      lockLabel: server.lockLabel || server.lock_label || QUOTA_LOCK_LABEL,
      lockReason: server.lockReason || server.lock_reason || QUOTA_LOCK_REASON,
    });
  }

  const raw = {
    ...server,
    ...record(server.value),
  };
  const usedCredits = quotaNumber(raw.usedCredits ?? raw.used_credits);
  const totalCredits = quotaNumber(raw.totalCredits ?? raw.total_credits);
  const remainingCredits = quotaNumber(raw.remainingCredits ?? raw.remaining_credits);
  const usedPercent = quotaPercent(
    raw.usedPercent ??
    raw.used_percent ??
    (usedCredits !== null && totalCredits > 0 ? (usedCredits / totalCredits) * 100 : undefined),
  );
  const resetAt = clean(raw.resetAt ?? raw.reset_at, 40);

  if (usedPercent === null || !resetAt) {
    return unsupported('monthly quota usage and reset date are incomplete in Taku billing data', {
      source: raw.source || 'server.billing_quota',
      lockLabel: QUOTA_LOCK_LABEL,
      lockReason: QUOTA_LOCK_REASON,
    });
  }

  return {
    status: 'supported',
    source: clean(raw.source, 120) || 'server.billing_quota',
    value: {
      usedPercent,
      ...(usedCredits !== null ? { usedCredits } : {}),
      ...(totalCredits !== null ? { totalCredits } : {}),
      ...(remainingCredits !== null ? { remainingCredits } : {}),
      resetAt,
      ...(raw.periodStart || raw.period_start ? { periodStart: clean(raw.periodStart ?? raw.period_start, 40) } : {}),
      ...(raw.periodEnd || raw.period_end ? { periodEnd: clean(raw.periodEnd ?? raw.period_end, 40) } : {}),
      ...(raw.periodId || raw.period_id ? { periodId: clean(raw.periodId ?? raw.period_id, 80) } : {}),
      ...(raw.planName || raw.plan_name ? { planName: clean(raw.planName ?? raw.plan_name, 80) } : {}),
    },
  };
}

function rankBlock(topPercent, unlockThreshold, lockReason) {
  const hasRank = Number.isFinite(topPercent) && topPercent > 0;
  return supportedIf(hasRank, 'server.rank', {
    topPercent,
    unlocked: hasRank && topPercent <= unlockThreshold,
    tier: ladderTier(topPercent),
  }, hasRank ? lockReason : COMMUNITY_RANK_LOCK_REASON, 'supported', {
    lockLabel: hasRank ? lockReason : COMMUNITY_RANK_LOCK_LABEL,
  });
}

function inventoryItems(draft, sectionIds) {
  const aliases = new Set(sectionIds);
  const sections = array(draft.sections);
  return sections
    .filter((section) => aliases.has(section?.id))
    .flatMap((section) => array(section.items))
    .filter(isRecord);
}

function capabilityTypeMix(items) {
  const counts = new Map();
  items.forEach((item) => {
    const id = clean(item?.type, 40).toLowerCase() || 'other';
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: capabilityCategoryLabel(id),
      count,
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function capabilityCategoryLabel(id) {
  return {
    'agents-md': 'AGENTS.MD',
    agent: 'AGENTS',
    'mcp-server': 'MCP',
    plugin: 'PLUGINS',
    skill: 'SKILLS',
    'slash-command': 'COMMANDS',
    subagent: 'SUBAGENTS',
    workflow: 'WORKFLOWS',
  }[id] || id.replaceAll('-', ' ').toUpperCase();
}

function pickBadges(persona, staxProfile) {
  return [
    ...array(staxProfile.persona?.badges),
    ...array(staxProfile.badges),
    ...array(persona.identity?.badges),
    ...array(persona.traits),
    ...array(persona.badges),
  ]
    .map((badge) => clean(badge?.label || badge?.title || badge, 100))
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
}

function topModelRows(modelUsage) {
  const rows = array(modelUsage.topModels).length ? array(modelUsage.topModels) : array(modelUsage.models);
  return rows.filter(isRecord);
}

function tokenBuckets(rows, count) {
  const source = array(rows).slice(-90);
  if (!source.length) return [];
  const bucketSize = Math.max(1, Math.ceil(source.length / count));
  const raw = [];
  for (let index = 0; index < count; index += 1) {
    const bucket = source.slice(index * bucketSize, index * bucketSize + bucketSize);
    raw.push(sumField(bucket, 'tokenCount'));
  }
  const max = Math.max(1, ...raw);
  return raw.map((value) => Math.round((value / max) * 1000) / 1000);
}

function visualTokenBuckets(values, useScaffold) {
  if (!useScaffold) return values;
  return [0.3, 0.45, 0.4, 0.6, 0.5, 0.75, 0.62, 0.85, 0.7, 0.95, 0.8, 1];
}

function usagePeriodById(usage, id) {
  return array(usage.periods)
    .map(record)
    .find((period) => clean(period.id || period.periodId, 80) === id) || {};
}

function safeTrendBucket(bucket) {
  return {
    id: clean(bucket.id, 40),
    label: clean(bucket.label, 80),
    buildSessionCount: integer(bucket.buildSessionCount),
    activeDayCount: integer(bucket.activeDayCount),
    tokenCount: integer(bucket.tokenCount),
  };
}

function hasConsecutiveDates(rows) {
  return rows.every((row, index) => {
    if (index === 0) return true;
    const previous = Date.parse(`${rows[index - 1].date}T00:00:00Z`);
    const current = Date.parse(`${row.date}T00:00:00Z`);
    return Number.isFinite(previous) && Number.isFinite(current) && current - previous === 86_400_000;
  });
}

function averageInputPerRequest(modelUsage, eventCount) {
  const requestCount = integer(modelUsage.observedEventCount || modelUsage.requestCount || eventCount);
  const inputTokens = integer(modelUsage.totalInputTokens || modelUsage.inputTokens);
  if (!requestCount || !inputTokens) return null;
  const avgInputTokens = Math.round(inputTokens / requestCount);
  return {
    label: 'AVG INPUT',
    display: compactNumber(avgInputTokens),
    avgInputTokens,
    requestCount,
    unit: 'tokens/request',
    method: 'observed local input tokens / observed local requests',
    estimate: false,
  };
}

function buildMomentumFromBuckets(rows) {
  const observed = array(rows).filter(isRecord).slice(-2);
  if (observed.length < 2) return null;
  const previous = observed[0];
  const current = observed[1];
  const previousBuilds = integer(previous.buildSessionCount);
  const currentBuilds = integer(current.buildSessionCount);
  if (previousBuilds <= 0) return null;
  const delta = round((currentBuilds - previousBuilds) / previousBuilds, 3);
  const percent = Math.round(delta * 100);
  return {
    metric: 'buildSessions',
    delta,
    display: percent > 0 ? `+${percent}%` : `${percent}%`,
    currentBuilds,
    previousBuilds,
    comparison: `${currentBuilds} VS ${previousBuilds}`,
    currentPeriodLabel: clean(current.label, 40),
    previousPeriodLabel: clean(previous.label, 40),
  };
}

function bestDayValue(rows) {
  const observed = array(rows)
    .filter(isRecord)
    .sort((left, right) => clean(left.date, 20).localeCompare(clean(right.date, 20)))
    .slice(-30);
  const best = [...observed]
    .sort((left, right) =>
      integer(right.tokenCount) - integer(left.tokenCount) ||
      integer(right.buildSessionCount) - integer(left.buildSessionCount)
    )[0];
  const usesTokens = integer(best?.tokenCount) > 0;
  return {
    bestDay: usesTokens ? compactNumber(best.tokenCount) : compactNumber(best?.buildSessionCount),
    date: clean(best?.date, 20),
    metric: usesTokens ? 'tokens' : 'buildSessions',
    observedDayCount: observed.length,
    peakShape: observed.map((row) => integer(usesTokens ? row.tokenCount : row.buildSessionCount)),
    peakDates: observed.map((row) => clean(row.date, 20)),
  };
}

function primaryTeam(sources) {
  const first = [...array(sources)]
    .filter((source) => source?.source || source?.label)
    .sort((left, right) =>
      integer(right?.totalTokens) - integer(left?.totalTokens) ||
      integer(right?.sessionCount) - integer(left?.sessionCount)
    )[0];
  const raw = clean(first?.source || first?.label, 80).toLowerCase();
  if (raw.includes('claude')) return ['CLAUDE', 'claude'];
  if (raw.includes('cursor')) return ['CURSOR', 'cursor'];
  if (raw.includes('gemini')) return ['GEMINI', 'gemini'];
  return ['CODEX', 'codex'];
}

function birdLabel(workPattern) {
  const peakHour = integer(workPattern?.peakHour);
  if (peakHour >= 22 || peakHour <= 4) return 'OWL';
  if (peakHour >= 5 && peakHour <= 11) return 'LARK';
  return 'BURST';
}

function activeHourBand(workPattern) {
  const buckets = array(workPattern?.hourBuckets);
  const active = buckets
    .map((count, hour) => (integer(count) > 0 ? hour : -1))
    .filter((hour) => hour >= 0);
  if (!active.length) return [];
  return [active[0], active[active.length - 1]];
}

function ladderTier(topPercent) {
  if (topPercent > 0 && topPercent <= 0.001) return 'LASER';
  if (topPercent > 0 && topPercent <= 0.01) return 'NEON';
  if (topPercent > 0 && topPercent <= 0.1) return 'SWEEP';
  return 'STANDARD';
}

function familyForPersonaCode(code) {
  const text = clean(code, 20).toUpperCase();
  if (text.includes('I')) return 'HACKERS';
  if (text.includes('A')) return 'ARCHITECTS';
  if (text.includes('M')) return 'MAKERS';
  return '';
}

function displaySerial(value) {
  const text = clean(value, 80);
  const digits = text.match(/\d+$/)?.[0];
  return digits ? `No. ${digits}` : text;
}

function quotaNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return round(number, 2);
}

function quotaPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const percent = number > 0 && number <= 1 ? number * 100 : number;
  return Math.max(0, Math.min(100, round(percent, 1)));
}

function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '0';
  if (number >= 1_000_000_000) return `${round(number / 1_000_000_000, 1)}B`;
  if (number >= 1_000_000) return `${round(number / 1_000_000, 1)}M`;
  if (number >= 1_000) return `${round(number / 1_000, 1)}K`;
  return String(Math.round(number));
}

function firstRecord(...values) {
  return values.map(record).find((value) => Object.keys(value).length > 0) || {};
}

function record(value) {
  return isRecord(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clean(value, maxLength) {
  return cleanText(value, maxLength) || '';
}

function integer(value) {
  const next = Math.floor(Number(value));
  return Number.isFinite(next) && next > 0 ? next : 0;
}

function ratio(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.max(0, Math.min(1, round(next, 3)));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const next = Number(value);
    if (Number.isFinite(next) && next > 0) return next;
  }
  return 0;
}

function sumField(rows, field) {
  return array(rows).reduce((sum, row) => sum + integer(row?.[field]), 0);
}
