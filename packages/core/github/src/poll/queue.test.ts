import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { RequestQueue } from './queue.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** What ran, and when it started and finished, in milliseconds from the start. */
type Log = [string, number, number][];

/** A request that takes `takes` milliseconds and logs itself. */
function request(name: string, takes: number, log: Log, start: number): () => Promise<void> {
  return async () => {
    const began = performance.now() - start;
    await new Promise((resolve) => setTimeout(resolve, takes));
    log.push([name, began, performance.now() - start]);
  };
}

/** Runs what's ready without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Moves the clock to `millis` after `start`, 100 ms at a time. */
async function advanceTo(start: number, millis: number): Promise<void> {
  while (performance.now() - start < millis) await vi.advanceTimersByTimeAsync(100);
}

test('requests run one at a time', async () => {
  const queue = new RequestQueue(1000);
  const log: Log = [];
  const start = performance.now();
  for (const name of ['a', 'b', 'c']) {
    void queue.read(request(name, 300, log, start));
    await settle();
  }
  await advanceTo(start, 1000);
  expect(log).toEqual([
    ['a', 0, 300],
    ['b', 300, 600],
    ['c', 600, 900],
  ]);
});

test('writes start a second after the previous write', async () => {
  const queue = new RequestQueue(1000);
  const log: Log = [];
  const start = performance.now();
  const send = async (name: string, write: boolean, takes: number) => {
    const made = request(name, takes, log, start);
    void (write ? queue.write(made) : queue.read(made));
    await settle();
  };
  await send('write a', true, 500);
  await send('read', false, 200);
  await advanceTo(start, 700);
  await send('write b', true, 100);
  await send('write c', true, 100);
  await advanceTo(start, 4000);
  expect(log).toEqual([
    ['write a', 0, 500],
    // A read doesn't wait for the spacing.
    ['read', 500, 700],
    // A second after "write a" finished.
    ['write b', 1500, 1600],
    ['write c', 2600, 2700],
  ]);
});

test('a request is made only once it holds the queue', async () => {
  const queue = new RequestQueue(1000);
  const log: Log = [];
  const start = performance.now();
  const made: string[] = [];
  for (const [name, write] of [
    ['write', true],
    ['read', false],
  ] as const) {
    const sent = request(name, 500, log, start);
    const make = () => {
      made.push(name);
      return sent();
    };
    void (write ? queue.write(make) : queue.read(make));
    await settle();
  }
  // The read waits for the write without having been made: a promise would already be running.
  expect(made).toEqual(['write']);
  await advanceTo(start, 1000);
  expect(made).toEqual(['write', 'read']);
  expect(log).toEqual([
    ['write', 0, 500],
    ['read', 500, 1000],
  ]);
});

test('waiting requests run in order writes first', async () => {
  const queue = new RequestQueue(0);
  const log: Log = [];
  const start = performance.now();
  for (const [name, write] of [
    ['read a', false],
    ['read b', false],
    ['read c', false],
    ['write d', true],
    ['read e', false],
    ['write f', true],
  ] as const) {
    const made = request(name, 100, log, start);
    void (write ? queue.write(made) : queue.read(made));
    await settle();
  }
  await advanceTo(start, 1000);
  expect(log.map(([name]) => name)).toEqual([
    'read a',
    'write d',
    'write f',
    'read b',
    'read c',
    'read e',
  ]);
});

test('foreground reads go ahead of waiting background reads, behind writes', async () => {
  const queue = new RequestQueue(0);
  const log: Log = [];
  const start = performance.now();
  for (const [name, kind] of [
    ['poll a', 'background'],
    ['poll b', 'background'],
    ['open c', 'foreground'],
    ['write d', 'write'],
    ['poll e', 'background'],
    ['open f', 'foreground'],
  ] as const) {
    const made = request(name, 100, log, start);
    void (kind === 'write' ? queue.write(made) : queue.read(made, undefined, kind));
    await settle();
  }
  await advanceTo(start, 1000);
  // The poll under way finishes first: nothing cuts a request short.
  expect(log.map(([name]) => name)).toEqual([
    'poll a',
    'write d',
    'open c',
    'open f',
    'poll b',
    'poll e',
  ]);
});

test('a foreground read given up on while waiting leaves the queue', async () => {
  const queue = new RequestQueue(0);
  const log: Log = [];
  const start = performance.now();
  void queue.read(request('poll a', 100, log, start));
  await settle();
  const giveUp = new AbortController();
  const refused = queue.read(request('open b', 100, log, start), giveUp.signal, 'foreground').then(
    () => 'made',
    () => 'refused',
  );
  void queue.read(request('poll c', 100, log, start));
  await settle();
  giveUp.abort();
  await advanceTo(start, 500);
  expect(await refused).toBe('refused');
  expect(log.map(([name]) => name)).toEqual(['poll a', 'poll c']);
});

test('a request given up on while waiting doesnt hold up the rest', async () => {
  const queue = new RequestQueue(0);
  const log: Log = [];
  const start = performance.now();
  const first = queue.read(request('first', 100, log, start));
  await settle();
  const giveUp = new AbortController();
  const abandoned = queue.read(request('abandoned', 100, log, start), giveUp.signal);
  const refused = abandoned.then(
    () => 'made',
    () => 'refused',
  );
  await settle();
  const last = queue.read(request('last', 100, log, start));
  await settle();
  giveUp.abort();
  await advanceTo(start, 500);
  await Promise.all([first, last]);
  expect(await refused).toBe('refused');
  expect(log).toEqual([
    ['first', 0, 100],
    ['last', 100, 200],
  ]);
});
