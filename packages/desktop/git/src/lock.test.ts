import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import {
  cacheLockRecord,
  CloneLock,
  lockCache,
  parseCacheLock,
  startTime,
  unlockCache,
} from './lock.ts';
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
  expect(parseCacheLock(readFileSync(path, 'utf8'))).toEqual({
    pid: process.pid,
    started: await startTime(process.pid),
  });
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
  const started = 'Tue Nov 10 15:42:53 2026';
  expect(parseCacheLock(`lo-cache 2\n4242\n${started}\n`)).toEqual({ pid: 4242, started });
  expect(parseCacheLock(cacheLockRecord(7, started))).toEqual({ pid: 7, started });
  const notRecords = [
    '',
    '4242\n',
    'lo-cache 1\n4242\n',
    `lo-cache 2\n4242\n${started}`,
    'lo-cache 2\n4242\n\n',
    `lo-cache 3\n4242\n${started}\n`,
    `lo-cache 2\nx\n${started}\n`,
    `lo-cache 2\n0\n${started}\n`,
    `lo-cache 2\n-1\n${started}\n`,
    `lo-cache 2\n4242\n${started}\nmore\n`,
  ];
  expect(notRecords.filter((text) => parseCacheLock(text) !== undefined)).toEqual([]);
});

/** The record of this process's parent, which is running, and isn't this process. */
async function parentsRecord(started?: string): Promise<string> {
  return cacheLockRecord(process.ppid, started ?? (await startTime(process.ppid)) ?? 'unknown');
}

test('a cache another running process holds is refused, naming it', async () => {
  const path = join(folder(), 'lo-cache.lock');
  const record = await parentsRecord();
  writeFileSync(path, record);

  await expect(lockCache(path)).rejects.toThrow(
    `another program, process ${process.ppid}, is using ${path}`,
  );
  expect(readFileSync(path, 'utf8')).toBe(record);
});

test('a lock a process that’s gone left is taken over', async () => {
  const dir = folder();
  const gone = Number(spawnSync('sh', ['-c', 'echo $$']).stdout.toString('utf8').trim());
  const reused = await parentsRecord('Thu Jan  1 00:00:00 1970');
  for (const left of [
    cacheLockRecord(gone, 'Thu Jan  1 00:00:00 1970'),
    reused,
    'half written',
    '',
  ]) {
    const path = join(dir, `${left.length}.lock`);
    writeFileSync(path, left);

    const release = await lockCache(path);

    expect(parseCacheLock(readFileSync(path, 'utf8'))?.pid).toBe(process.pid);
    expect(readdirSync(dir).filter((name) => name.includes('.lock.'))).toEqual([]);
    await unlockCache(path, release);
  }
});

test('of two processes taking over one stale lock at once, one gets it', async () => {
  const dir = folder();
  const path = join(dir, 'lo-cache.lock');
  const gone = Number(spawnSync('sh', ['-c', 'echo $$']).stdout.toString('utf8').trim());
  writeFileSync(path, cacheLockRecord(gone, 'Thu Jan  1 00:00:00 1970'));
  // Each child takes the lock with the code under test, says whether it got it, and holds on
  // until its input ends, so none lets go before all have tried.
  const script = join(dir, 'take.ts');
  writeFileSync(
    script,
    `import { lockCache } from ${JSON.stringify(new URL('./lock.ts', import.meta.url).pathname)};\n` +
      `lockCache(${JSON.stringify(path)}).then(() => console.log('got'), (e) => console.log(String(e.message)));\n` +
      'process.stdin.resume();\n',
  );
  const take = () => {
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'inherit'] });
    const said = new Promise<string>((resolve) => {
      child.stdout.once('data', (data: Buffer) => resolve(data.toString('utf8').trim()));
    });
    const done = new Promise((resolve) => child.once('close', resolve));
    return { said, end: () => child.stdin.end(), done };
  };

  for (let round = 0; round < 10; round++) {
    writeFileSync(path, cacheLockRecord(gone, 'Thu Jan  1 00:00:00 1970'));
    const takers = [take(), take(), take()];
    const results = await Promise.all(takers.map((taker) => taker.said));
    for (const taker of takers) taker.end();
    await Promise.all(takers.map((taker) => taker.done));
    expect(results.filter((result) => result === 'got')).toHaveLength(1);
  }
}, 60_000);

test('a cache open in this process can’t be opened again until it’s closed', async () => {
  const path = join(folder(), 'lo-cache.lock');
  const release = await lockCache(path);

  await expect(lockCache(path)).rejects.toThrow('already open in this process');
  await unlockCache(path, release);
  await unlockCache(path, await lockCache(path));
});
