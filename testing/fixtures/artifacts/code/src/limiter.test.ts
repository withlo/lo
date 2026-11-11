import { expect, test } from 'vitest';

import { bucketOf, refill } from './limiter.ts';

test('a bucket refills at its rate, up to its size', () => {
  const bucket = bucketOf('t', 60, 0);
  bucket.tokens = 0;
  refill(bucket, 30_000);
  expect(bucket.tokens).toBe(30);
  refill(bucket, 120_000);
  expect(bucket.tokens).toBe(60);
});
