// A git under watch, as a process: stopped isn't exited, and stopping one that's gone is nothing.

import { execFileSync } from 'node:child_process';

import { expect, test } from 'vitest';

import { Child } from '../src/spawn.ts';
import { eventually, tempFolder } from './support.ts';

/** A child in a process group of its own that exits with status 3 once its stdin closes. */
function waitingChild(): Child {
  return new Child('/bin/sh', {
    args: ['-c', 'read line; exit 3'],
    env: { PATH: '/usr/bin:/bin' },
    cwd: tempFolder(),
    input: true,
    display: 'sh',
  });
}

/** Whether `promise` has settled, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  const first = await Promise.race([promise.then(() => true), Promise.resolve(pending)]);
  return first !== pending;
}

/** The state `ps` gives process `pid`, such as `T` for stopped. */
function state(pid: number): string {
  return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
}

test('a stopped git hasnt exited', async () => {
  const child = waitingChild();
  const pid = child.pid ?? 0;
  process.kill(pid, 'SIGSTOP');
  await eventually(() => state(pid).startsWith('T'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  // Taken for exited, it would be killed, and its fetch would fail.
  expect(await settled(child.gone)).toBe(false);

  // Once it goes on and exits, it has, with its own exit status rather than a kill's.
  process.kill(pid, 'SIGCONT');
  child.stdin?.end();
  expect(await child.exited).toEqual({ code: 3, signal: null });
});

test('stopping a git that has exited warns of nothing', async () => {
  const child = waitingChild();
  child.stdin?.end();
  await child.gone;

  // Its group is gone, as when git exits just as its fetch runs out a limit.
  expect(() => child.stop('SIGTERM')).not.toThrow();
  expect(() => child.stop()).not.toThrow();

  expect(await child.exited).toEqual({ code: 3, signal: null });
});
