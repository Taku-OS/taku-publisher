export interface UsageSummaryInput {
  primary: Record<string, any>;
  periods: unknown[];
  personaUsage: Record<string, any>;
  warnings?: unknown[];
  privateWorkspaceKeys?: unknown[];
}

export function composeUsageSummary({
  primary,
  periods,
  personaUsage,
  warnings = [],
  privateWorkspaceKeys = [],
}: UsageSummaryInput) {
  const result = {
    scanned: true,
    primaryPeriodId: primary.id,
    periodLabel: primary.label,
    startsAt: primary.startsAt,
    endsAt: primary.endsAt,
    scannedFileCount: primary.scannedFileCount,
    sessionCount: primary.sessionCount,
    eventCount: primary.eventCount,
    totalInputTokens: primary.totalInputTokens,
    totalOutputTokens: primary.totalOutputTokens,
    totalCacheReadTokens: primary.totalCacheReadTokens,
    totalCacheCreationTokens: primary.totalCacheCreationTokens,
    totalReasoningTokens: primary.totalReasoningTokens,
    totalTokens: primary.totalTokens,
    sources: primary.sources,
    periods,
    activity: personaUsage.activity,
    workspaces: personaUsage.workspaces,
    toolUsage: personaUsage.toolUsage,
    localActivity: personaUsage.localActivity,
    modelUsage: primary.modelUsage,
    estimatedCost: primary.estimatedCost,
    behaviorProfile: personaUsage.behaviorProfile,
    behaviorProfileV1: personaUsage.behaviorProfile,
    promptStyle: personaUsage.promptStyle,
    warnings: Array.from(new Set(warnings)),
  };
  Object.defineProperty(result, '__privateWorkspaceKeys', {
    value: Array.from(
      new Set(privateWorkspaceKeys.filter((value) => Boolean(value))),
    ),
    enumerable: false,
  });
  return result;
}
