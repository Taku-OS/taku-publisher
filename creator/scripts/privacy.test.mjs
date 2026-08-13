import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizePublishJson } from './privacy.mjs';

test('keeps public session counts and authorship classification', () => {
  assert.deepEqual(
    sanitizePublishJson({
      sessions: 3,
      sessionCount: 4,
      tokenCount: 200,
      totalTokens: 300,
      buildSessionCount: 2,
      sessionSplit: { sessionCount: 4, buildSessionCount: 2 },
      authorshipKind: 'original',
      session: ['private', 'session', 'value'].join('-'),
      authorization: ['Bearer', ['private', 'token'].join('-')].join(' '),
    }),
    {
      sessions: 3,
      sessionCount: 4,
      tokenCount: 200,
      totalTokens: 300,
      buildSessionCount: 2,
      sessionSplit: { sessionCount: 4, buildSessionCount: 2 },
      authorshipKind: 'original',
    },
  );
});
