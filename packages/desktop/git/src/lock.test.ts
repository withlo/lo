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

test('a waiter whose signal aborts leaves the queue to those behind it', async () => {
  const lock = new CloneLock();
  const held = await lock.acquire('fetching pull request #1');
  const controller = new AbortController();
  const reason = new Error('the comparison was closed');
  const aborted = lock.acquire('comparing', undefined, { signal: controller.signal });
  const behind = lock.acquire('downloading 3 files');

  controller.abort(reason);
  await expect(aborted).rejects.toBe(reason);
  held();

  // The one behind gets the lock, and nobody holds it once it lets go.
  (await behind)();
  expect(lock.holder).toBeUndefined();
  // One already aborted never waits.
  await expect(lock.acquire('comparing', undefined, { signal: controller.signal })).rejects.toBe(
    reason,
  );
});

test('a holder that gives way hears once what the first waiter wants', async () => {
  const lock = new CloneLock();
  const told: string[] = [];
  const held = lock.tryAcquire('repacking it', (waiter) => told.push(waiter));
  expect(held).toBeDefined();
  // Another holder that doesn't give way can't take it.
  expect(lock.tryAcquire('testing', () => undefined)).toBeUndefined();

  const first = lock.acquire('opening its local copy');
  const second = lock.acquire('fetching pull request #1');

  expect(told).toEqual(['opening its local copy']);
  held?.();
  (await first)();
  (await second)();
  // The next holder gives way only if it says so.
  const plain = lock.tryAcquire('removing partial packs');
  void lock.acquire('testing').then((release) => release());
  expect(told).toEqual(['opening its local copy']);
  plain?.();
});

test('passing a removal waits for a holder that removes, and for no other', async () => {
  const lock = new CloneLock();
  const fetching = await lock.acquire('fetching pull request #1');
  // A fetch removes nothing, so it's never waited for.
  await lock.passRemoval('reading its local copy');
  fetching();

  const told: string[] = [];
  const done = lock.use();
  // Nobody else can start removing once the clone has a user...
  expect(lock.tryRemove('removing it')).toBeUndefined();
  done();
  // ...but one that started is waited for, and told.
  const removing = lock.tryRemove('removing replayed trees', (waiter) => told.push(waiter));
  let passed = false;
  const passing = lock.passRemoval('reading its local copy').then(() => {
    passed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect([passed, told]).toEqual([false, ['reading its local copy']]);
  removing?.();
  await passing;
  expect(lock.holder).toBeUndefined();

  // Its signal stops it waiting.
  const again = lock.tryRemove('removing it');
  const controller = new AbortController();
  const reason = new Error('the tab was closed');
  const waiting = lock.passRemoval('reading its local copy', controller.signal);
  controller.abort(reason);
  await expect(waiting).rejects.toBe(reason);
  again?.();
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

test('says the clone is free when its holder or its last user lets go, and only then', () => {
  let free = 0;
  const lock = new CloneLock(() => (free += 1));
  const first = lock.use();
  const second = lock.use();
  const held = lock.tryAcquire('fetching');
  expect(held).toBeDefined();
  first();
  second();
  // Still held.
  expect(free).toBe(0);
  held?.();
  expect(free).toBe(1);

  const user = lock.use();
  const other = lock.use();
  other();
  // Another is still open.
  expect(free).toBe(1);
  user();
  expect(free).toBe(2);
  // Letting go twice counts once.
  user();
  expect(free).toBe(2);
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

  const waiter = lock.acquire('testing', (activity) => told.push(activity), { tellEvery: 20 });
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
