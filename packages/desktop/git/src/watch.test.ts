import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';

import { DEFAULT_FETCH_LIMITS } from './limits.ts';
import type { Progress } from './progress.ts';
import { FetchState, type Stopped, stoppedError, TraceFile } from './watch.ts';

function progress(stage: string, done: number, total?: number, bytes?: number): Progress {
  return { stage, done, total, bytes };
}

/** A clock a test moves by hand. */
function clock() {
  let now = 0;
  return { now: () => now, pass: (milliseconds: number) => (now += milliseconds) };
}

const HOUR = 60 * 60 * 1000;

test('follows a fetch from connecting to resolving', () => {
  const state = new FetchState();
  expect(state.doing()).toBe('connecting to GitHub');
  expect(state.activity().kind).toBe('connecting');

  expect(state.onTrace('{"event":"version","evt":"4"}')).toBe(false);
  expect(state.traced).toBe(true);
  expect(state.activity().kind).toBe('connecting');
  expect(
    state.onTrace('{"event":"data","category":"transfer","key":"negotiated-version","value":"2"}'),
  ).toBe(true);
  expect(state.doing()).toBe('GitHub was still working out what to send');

  expect(state.onProgress('remote', progress('Counting objects', 1, 4))).toBe(true);
  expect(state.doing()).toBe(
    'GitHub was still preparing what to send (counting objects, 25% of 4)',
  );
  expect(state.onProgress('local', progress('Receiving objects', 0, 5608))).toBe(true);
  expect(state.doing()).toBe('receiving objects, 0% of 5608');
  // GitHub's last words don't take it back.
  expect(state.onProgress('remote', progress('Compressing objects', 4, 4))).toBe(false);
  expect(state.onProgress('local', progress('Resolving deltas', 3, 4))).toBe(true);
  expect(state.activity()).toMatchObject({
    kind: 'transferring',
    progress: { stage: 'Resolving deltas' },
  });
});

test('unpacking objects is receiving them', () => {
  const state = new FetchState();
  state.onProgress('local', progress('Unpacking objects', 1, 40));
  expect(state.doing()).toBe('unpacking objects, 2% of 40');
  expect(state.advanced).toBeDefined();
});

test('github progress ends connecting without a trace', () => {
  const state = new FetchState();
  state.onProgress('remote', progress('Enumerating objects', 12));
  expect(state.doing()).toBe('GitHub was still preparing what to send (enumerating objects, 12)');
});

test('runs out the connect limit only while connecting and traced', () => {
  const limits = { ...DEFAULT_FETCH_LIMITS, connect: 0 };
  const state = new FetchState();
  // Without a trace, connecting can't be told from waiting.
  expect(state.over(limits, false)).toBeUndefined();
  state.onTrace('{"event":"version"}');
  expect(state.over(limits, false)).toEqual({ reason: 'connect', limit: 0 });
  state.onTrace('{"event":"data","key":"negotiated-version","value":"2"}');
  expect(state.over(limits, false)).toBeUndefined();
});

test('once objects come in only getting no further stops a fetch', () => {
  const limits = { ...DEFAULT_FETCH_LIMITS, fetch: 0, firstFetch: HOUR, stall: HOUR };
  const time = clock();
  const state = new FetchState(time.now);
  expect(state.over(limits, false)).toEqual({ reason: 'start', limit: 0 });
  expect(state.over(limits, true)).toBeUndefined();
  // GitHub's lines while it prepares don't count as getting further.
  state.onProgress('remote', progress('Counting objects', 1, 60));
  expect(state.advanced).toBeUndefined();
  expect(state.over(limits, false)).toBeDefined();

  state.onProgress('local', progress('Receiving objects', 0, 60));
  // However long the fetch has taken, it may take longer while it gets further.
  time.pass(HOUR / 2);
  expect(state.over(limits, false)).toBeUndefined();
  expect(state.over({ ...limits, stall: 0 }, false)).toEqual({ reason: 'stall', limit: 0 });
  time.pass(HOUR);
  expect(state.over(limits, false)).toEqual({ reason: 'stall', limit: HOUR });
});

test('a fetch that brings more than it may is over its limit, whatever else it is doing', () => {
  const state = new FetchState();
  const limits = { ...DEFAULT_FETCH_LIMITS };
  state.onProgress('local', progress('Receiving objects', 0, 2, 40 * 1024 * 1024));
  expect(state.over(limits, false, 50 * 1024 * 1024)).toBeUndefined();
  state.onProgress('local', progress('Receiving objects', 1, 2, 51 * 1024 * 1024));
  expect(state.over(limits, false, 50 * 1024 * 1024)).toEqual({
    reason: 'size',
    limit: 50 * 1024 * 1024,
  });
  expect(state.over(limits, false)).toBeUndefined();
});

/** The message of a fetch of pull request #1 that stopped. */
const stopped = (reason: Stopped['reason'], doing: string, limit = 120_000) =>
  stoppedError({ reason, limit, doing, pid: 1 }, 'pull request #1').message;

test('a stopped fetch says which limit it ran out', () => {
  expect(
    stopped('start', 'GitHub was still preparing what to send (counting objects, 50% of 2)'),
  ).toBe(
    "can't fetch pull request #1: GitHub took longer than 2 min to start sending, so Lo stopped " +
      'it while GitHub was still preparing what to send (counting objects, 50% of 2)',
  );
  expect(stopped('stall', 'receiving objects, 45% of 5608')).toBe(
    "can't fetch pull request #1: it got no further for 2 min, so Lo stopped it while receiving " +
      'objects, 45% of 5608',
  );
  expect(stopped('connect', 'connecting to GitHub')).toBe(
    "can't fetch pull request #1: the network failed (GitHub didn't answer within 2 min, so Lo " +
      'stopped connecting)',
  );
  expect(stopped('size', 'receiving objects', 50 * 1024 * 1024)).toBe(
    "can't fetch pull request #1: it's more than 50 MB, so Lo stopped downloading it",
  );
  const tooLarge = stoppedError({ reason: 'size', limit: 1, doing: '', pid: 1 }, 'x');
  expect(tooLarge.isRetryable()).toBe(false);
});

test('a trace starts empty even where an old one was left', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lo-trace-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, '1-0.trace');
  // What a fetch that never finished, whose name this one reuses, left.
  writeFileSync(path, '{"event":"data","key":"negotiated-version"}\n');

  const trace = await TraceFile.create(path);
  const lines: string[] = [];
  await trace.read((line) => lines.push(line));
  expect(lines).toEqual([]);

  // git appends to it.
  appendFileSync(path, '{"event":"version"}\n{"ev');
  await trace.read((line) => lines.push(line));
  expect(lines).toEqual(['{"event":"version"}']);
  appendFileSync(path, 'ent":"exit"}\n');
  await trace.read((line) => lines.push(line));
  expect(lines).toEqual(['{"event":"version"}', '{"event":"exit"}']);
  await trace.remove();
  expect(existsSync(path)).toBe(false);
});
