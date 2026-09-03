const MAX_HOST_TOOL_ITEMS = 60;
const MAX_HOST_CREATION_ITEMS = 80;

export function compactScanCommandResult(scanResult = {}) {
  const usedTools = compactInventory(scanResult.usedTools, MAX_HOST_TOOL_ITEMS);
  const creationCandidates = compactInventory(
    scanResult.creationCandidates || scanResult.ownedCreations,
    MAX_HOST_CREATION_ITEMS,
  );
  const usage = scanResult.usage || {};
  const summary = scanResult.summary || {};

  return {
    ok: true,
    schemaVersion: 'taku.creator.host-scan.v1',
    generatedAt: cleanString(scanResult.generatedAt),
    privacy: {
      uploads: false,
      promptContentRead: scanResult.privacy?.promptContentRead === true,
      promptContentUploaded: false,
      sourceContentUploaded: false,
      envVarsUploaded: false,
      tokensUploaded: false,
      localPathsIncluded: false,
    },
    persona: compactPersona(scanResult.personaV2),
    badges: compactBadges(scanResult.badges),
    usage: compactUsage(usage),
    summary: compactSummary(summary),
    usedTools: usedTools.items,
    usedToolsTruncated: usedTools.truncated,
    creationCandidates: creationCandidates.items,
    creationCandidatesTruncated: creationCandidates.truncated,
  };
}

export function createEditorCommandResult(draft = {}, editorUrl = '') {
  return {
    ok: true,
    schemaVersion: 'taku.creator.editor-result.v1',
    editorUrl,
    primaryUrl: editorUrl,
    primaryAction: 'open_editor',
    persona: compactPersona(draft.personaV2),
    summary: compactSummary(draft.stats || {}),
    message:
      'Open editorUrl to review, add local tool packages, and publish the Creator Profile. Full inventory and local file paths stay in the private editor state.',
  };
}

export function createCloudStudioCommandResult(draft = {}, studioUrl = '', extra = {}) {
  const accountHint = cleanString(extra.accountHint, 160);
  return {
    ok: true,
    schemaVersion: 'taku.creator.editor-result.v1',
    editorUrl: studioUrl,
    primaryUrl: studioUrl,
    primaryAction: 'open_cloud_studio',
    cloudDraft: true,
    persona: compactPersona(draft.personaV2),
    summary: compactSummary(draft.stats || {}),
    ...(extra.workerUrl ? { workerUrl: extra.workerUrl } : {}),
    ...(accountHint ? {
      publisherAccountHint: accountHint,
      savedToAccount: accountHint,
    } : {}),
    message: accountHint
      ? `The private Studio draft was saved to Taku account ${accountHint}. Open editorUrl to review it.`
      : 'The private Studio draft was saved to the current Taku account. Open editorUrl to review it.',
  };
}

function compactInventory(items, limit) {
  const source = Array.isArray(items) ? items : [];
  return {
    items: source.slice(0, limit).map((item) => ({
      id: cleanString(item?.id),
      type: cleanString(item?.type),
      source: cleanString(item?.source),
      name: cleanString(item?.name),
      description: cleanString(item?.description, 240),
      detectedFrom: cleanString(item?.detectedFrom, 120),
      ...(item?.availability
        ? { availability: cleanString(item.availability, 80) }
        : {}),
      publishable: item?.publishable !== false,
    })),
    truncated: source.length > limit,
  };
}

function compactPersona(persona = {}) {
  return {
    code: cleanString(persona?.code, 80),
    title: cleanString(persona?.archetype?.title, 160),
    subtitle: cleanString(persona?.archetype?.subtitle, 240),
    description: cleanString(persona?.archetype?.description, 600),
    tone: cleanString(persona?.tone, 80),
    confidence: finiteNumber(persona?.confidence),
  };
}

function compactBadges(badges) {
  return (Array.isArray(badges) ? badges : []).slice(0, 12).map((badge) => ({
    id: cleanString(badge?.id, 120),
    label: cleanString(badge?.label || badge?.title, 160),
    category: cleanString(badge?.category, 120),
  }));
}

function compactUsage(usage = {}) {
  const estimatedCost =
    usage?.estimatedCost || usage?.modelUsage?.estimatedCost || {};
  return {
    periodId: cleanString(usage?.primaryPeriodId, 80),
    periodLabel: cleanString(usage?.periodLabel, 120),
    scannedFileCount: nonNegativeInteger(usage?.scannedFileCount),
    sessionCount: nonNegativeInteger(usage?.sessionCount),
    eventCount: nonNegativeInteger(usage?.eventCount),
    totalTokens: nonNegativeInteger(usage?.totalTokens),
    estimatedCostUsd: finiteNumber(estimatedCost?.totalUsd),
    localActivity: compactLocalActivity(usage?.localActivity),
    sourceCount: Array.isArray(usage?.sources) ? usage.sources.length : 0,
  };
}

function compactLocalActivity(localActivity = {}) {
  const sessionSplit = localActivity?.sessionSplit || {};
  const streak = localActivity?.buildStreak || {};
  const delta = localActivity?.delta30d || {};
  const trend = localActivity?.trend30d || {};
  const workPattern = localActivity?.workPattern || {};
  return {
    activeDayCount: nonNegativeInteger(localActivity?.activeDayCount),
    buildDayCount: nonNegativeInteger(localActivity?.buildDayCount),
    buildSessionCount: nonNegativeInteger(localActivity?.buildSessionCount),
    chatSessionCount: nonNegativeInteger(localActivity?.chatSessionCount),
    dailyHeatmap: compactDailyHeatmap(localActivity?.dailyHeatmap),
    sessionSplit: {
      sessionCount: nonNegativeInteger(sessionSplit?.sessionCount),
      buildSessionCount: nonNegativeInteger(sessionSplit?.buildSessionCount),
      chatSessionCount: nonNegativeInteger(sessionSplit?.chatSessionCount),
      buildShare: finiteRatio(sessionSplit?.buildShare),
      chatShare: finiteRatio(sessionSplit?.chatShare),
      buildTimeShare: finiteRatio(sessionSplit?.buildTimeShare),
      chatTimeShare: finiteRatio(sessionSplit?.chatTimeShare),
    },
    buildStreak: {
      currentDays: nonNegativeInteger(streak?.currentDays),
      bestDays: nonNegativeInteger(streak?.bestDays),
    },
    trend30d: {
      metric: cleanString(trend?.metric, 80) || 'buildSessions',
      buckets: compactTrendBuckets(trend?.buckets),
    },
    delta30d: {
      metric: cleanString(delta?.metric, 80) || 'buildSessions',
      current: nonNegativeInteger(delta?.current),
      previous: nonNegativeInteger(delta?.previous),
      delta: nullableFiniteNumber(delta?.delta),
      display: cleanString(delta?.display, 40),
    },
    workPattern: {
      peakHour: nullableHour(workPattern?.peakHour),
      activeHourCount: nonNegativeInteger(workPattern?.activeHourCount),
      nightShare: finiteRatio(workPattern?.nightShare),
      morningShare: finiteRatio(workPattern?.morningShare),
      businessHoursShare: finiteRatio(workPattern?.businessHoursShare),
      weekendShare: finiteRatio(workPattern?.weekendShare),
    },
  };
}

function compactDailyHeatmap(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice(-60)
    .map((row) => ({
      date: cleanDate(row?.date),
      active: row?.active !== false,
      sessionCount: nonNegativeInteger(row?.sessionCount),
      buildSessionCount: nonNegativeInteger(row?.buildSessionCount),
      eventCount: nonNegativeInteger(row?.eventCount),
      toolCallCount: nonNegativeInteger(row?.toolCallCount),
      tokenCount: nonNegativeInteger(row?.tokenCount),
      buildIntensity: Math.min(4, nonNegativeInteger(row?.buildIntensity)),
    }))
    .filter((row) => row.date);
}

function compactTrendBuckets(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row) => ({
      id: cleanString(row?.id, 40),
      label: cleanString(row?.label, 80),
      buildSessionCount: nonNegativeInteger(row?.buildSessionCount),
      activeDayCount: nonNegativeInteger(row?.activeDayCount),
      toolCallCount: nonNegativeInteger(row?.toolCallCount),
      tokenCount: nonNegativeInteger(row?.tokenCount),
    }))
    .filter((row) => row.id);
}

function compactSummary(summary = {}) {
  const keys = [
    'usedToolCount',
    'ownedCreationCount',
    'creationCandidateCount',
    'displayedToolCount',
    'hiddenToolCount',
    'creatorToolCount',
    'displayedCreationCount',
    'usagePeriodId',
    'usagePeriodLabel',
    'usageTokenCount',
    'usageSessionCount',
    'personaCode',
    'personaTitle',
    'personaTone',
    'creatorProfileSynced',
  ];
  const result = {};
  for (const key of keys) {
    const value = summary?.[key];
    if (typeof value === 'boolean' || typeof value === 'number') {
      result[key] = value;
    } else if (typeof value === 'string' && value.trim()) {
      result[key] = cleanString(value, 240);
    }
  }
  return result;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function nullableFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function nullableHour(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 23 ? number : null;
}

function cleanDate(value) {
  const text = cleanString(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function cleanString(value, limit = 1000) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}
