import { expect, test } from 'vitest';

import { PullRequestCheckDocument } from './generated/graphql.ts';
import { CHECKED_THREADS } from './queries.ts';

test('the check reads as many threads as it says', () => {
  expect(String(PullRequestCheckDocument)).toContain(`reviewThreads(first: ${CHECKED_THREADS})`);
});
