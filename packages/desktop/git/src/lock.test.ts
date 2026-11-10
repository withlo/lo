import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { cacheLockRecord, CloneLock, lockCache, parseCacheLock, unlockCache } from './lock.ts';
import type { Activity } from './progress.ts';

function folder(): string {
  const path = mkdtempSync(join(tmpdir(), 'lo-lock-'));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('one holder at a time', async () => {
  const lock = new CloneLock();
  const held = await lock.acquire('fetching pull request #1');
  expect(lock.tryAcquire('testing')).toBeUndefined();

  // A waiter gets it once the holder lets go.
  let got = false;
  const waiter = lock.acquire('testing').then((release) => {
    got = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(got).toBe(false);
  held();
  (await waiter)();
  expect(got).toBe(true);
  expect(lock.tryAcquire('testing')).toBeDefined();
});

test('shared holders keep out anyone alone', () => {
  const lock = new CloneLock();
  const first = lock.use();
  const second = lock.use();
  expect(lock.tryRemove('removing it')).toBeUndefined();
  first();
  // Letting go twice counts once.
  first();
  expect(lock.tryRemove('removing it')).toBeUndefined();
  second();
  expect(lock.tryRemove('removing it')).toBeDefined();
});

test('what a holder records goes when it lets go', async () => {
  const path = join(folder(), 'lo-cache.lock');

  const release = await lockCache(path);
  expect(parseCacheLock(readFileSync(path, 'utf8'))).toBe(process.pid);
  await unlockCache(path, release);

  expect(existsSync(path)).toBe(false);
});

test('a long wait says every so often that its still waiting', async () => {
  const lock = new CloneLock();
  const held = await lock.acquire('fetching pull request #9');
  const told: Activity[] = [];

  const waiter = lock.acquire('testing', (activity) => told.push(activity), 20);
  while (told.length < 3) await new Promise((resolve) => setTimeout(resolve, 10));
  held();
  (await waiter)();

  expect(told[0]).toMatchObject({ kind: 'waitingForLock', holder: 'fetching pull request #9' });
  const waited = told.map((activity) =>
    activity.kind === 'waitingForLock' ? activity.waited : -1,
  );
  expect(waited.toSorted((a, b) => a - b)).toEqual(waited);
  expect(waited.at(-1)).toBeGreaterThan(0);
});

test('reads only what a holder records', () => {
  expect(parseCacheLock('lo-cache 1\n4242\n')).toBe(4242);
  expect(parseCacheLock(cacheLockRecord(7))).toBe(7);
  const notRecords = [
    '',
    '4242\n',
    'lo-cache 1\n4242',
    'lo-cache 2\n4242\n',
    'lo-cache 1\nx\n',
    'lo-cache 1\n0\n',
    'lo-cache 1\n-1\n',
    'lo-cache 1\n4242\nmore\n',
  ];
  expect(notRecords.filter((text) => parseCacheLock(text) !== undefined)).toEqual([]);
});

test('a cache another running process holds is refused, naming it', async () => {
  const path = join(folder(), 'lo-cache.lock');
  // This process's parent is running, and isn't this process.
  writeFileSync(path, cacheLockRecord(process.ppid));

  await expect(lockCache(path)).rejects.toThrow(
    `another program, process ${process.ppid}, is using ${path}`,
  );
  expect(readFileSync(path, 'utf8')).toBe(cacheLockRecord(process.ppid));
});

test('a lock a process that’s gone left is taken over', async () => {
  const dir = folder();
  const gone = spawnSync('sh', ['-c', 'echo $$']).stdout.toString('utf8').trim();
  for (const left of [cacheLockRecord(Number(gone)), 'half written', '']) {
    const path = join(dir, `${left.length}.lock`);
    writeFileSync(path, left);

    const release = await lockCache(path);

    expect(parseCacheLock(readFileSync(path, 'utf8'))).toBe(process.pid);
    await unlockCache(path, release);
  }
});

test('a cache open in this process can’t be opened again until it’s closed', async () => {
  const path = join(folder(), 'lo-cache.lock');
  const release = await lockCache(path);

  await expect(lockCache(path)).rejects.toThrow('already open in this process');
  await unlockCache(path, release);
  await unlockCache(path, await lockCache(path));
});
