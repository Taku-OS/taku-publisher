export const AI_BURN_USAGE_SCHEMA = 'taku.creator.ai-burn-usage.v3';

export const STAX_CHALLENGE_SCHEDULES = Object.freeze({
  productionTest: Object.freeze({
    label: 'Sep 17 - Sep 20, 2026',
    startsAt: '2026-09-16T16:00:00.000Z',
    endsAt: '2026-09-20T15:59:59.999Z',
  }),
  official: Object.freeze({
    label: 'Sep 22 - Oct 30, 2026',
    startsAt: '2026-09-21T16:00:00.000Z',
    endsAt: '2026-10-30T15:59:59.999Z',
  }),
});

// Switch this one key after the production test window closes. Keep both
// schedules in Asia/Shanghai boundaries expressed as fixed UTC instants.
export const ACTIVE_STAX_CHALLENGE_SCHEDULE = 'productionTest';

export const AI_BURN_PERIOD = Object.freeze({
  id: 'aiBurn',
  ...STAX_CHALLENGE_SCHEDULES[ACTIVE_STAX_CHALLENGE_SCHEDULE],
  usageSchema: AI_BURN_USAGE_SCHEMA,
});
