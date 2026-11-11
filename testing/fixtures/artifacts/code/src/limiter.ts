import { config } from './config.ts';

export interface Bucket {
  /** The tokens left. */
  tokens: number;
  /** The most tokens the bucket holds: the tenant's quota for a minute. */
  size: number;
  /** Tokens added a millisecond. */
  rate: number;
  /** When it was last filled, in milliseconds. */
  at: number;
}

const buckets = new Map<string, Bucket>();

/** The tenant's bucket, made full on the tenant's first request. */
export function bucketOf(tenant: string, quota: number, now: number): Bucket {
  let bucket = buckets.get(tenant);
  if (!bucket) {
    bucket = { tokens: quota, size: quota, rate: quota / 60_000, at: now };
    buckets.set(tenant, bucket);
  }
  return bucket;
}

/** Adds the tokens due since the bucket was last filled. */
export function refill(bucket: Bucket, now: number): void {
  bucket.tokens = Math.min(bucket.size, bucket.tokens + (now - bucket.at) * bucket.rate);
  bucket.at = now;
}

/** Requests waiting for a token, the longest-waiting first. */
const waiting: (() => void)[] = [];

/** Takes a token, if one is free. */
function take(bucket: Bucket, now: number): boolean {
  refill(bucket, now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * Waits for a token from the tenant's bucket, then lets the request go on to the API. A request
 * that waits longer than the timeout fails.
 */
export async function limit(tenant: string, quota: number): Promise<void> {
  const bucket = bucketOf(tenant, quota, Date.now());
  if (take(bucket, Date.now())) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(go), 1);
      reject(new Error(`${tenant} waited longer than ${config.timeout} ms`));
    }, config.timeout);
    const go = (): void => {
      clearTimeout(timer);
      resolve();
    };
    waiting.push(go);
  });
}

/** Wakes the request that has waited longest, once a token comes back. */
export function release(): void {
  const next = waiting.shift();
  next?.();
}
