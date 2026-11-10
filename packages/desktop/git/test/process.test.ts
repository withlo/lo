// Short gits given all three pipes, on several threads at once, while long-lived gits start, as each
// open clone's `cat-file --batch`, which runs as long as the clone is open. None of the long-lived
// ones may hold an end of a short one's pipe: whoever reads the short one's output, or a git that
// reads its input to the end, would wait until the long-lived one exits.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { git } from '@lo/testing/git';
import { expect, test } from 'vitest';

import type { Child } from '../src/spawn.ts';
import { runnerIn, tempFolder } from './support.ts';

/** How many short gits run, in all, while long-lived ones start. */
const SHORT_RUNS = 2000;
/** The threads running them, besides this one. */
const THREADS = 4;
/** How many long-lived gits are alive at once, between checks. */
const BATCH = 20;

/** Runs short gits with all three pipes until the shared count reaches `runs`. */
const WORKER = `
const { spawn } = require('node:child_process');
const { workerData, parentPort } = require('node:worker_threads');
const { program, env, cwd, runs, counter } = workerData;
const count = new Int32Array(counter);
function once() {
  return new Promise((resolve, reject) => {
    const child = spawn(program, ['hash-object', '--stdin'], { env, cwd, stdio: 'pipe' });
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('git exited with ' + code))));
    child.stdin.end('some text\\n');
  });
}
(async () => {
  while (Atomics.load(count, 0) < runs) {
    await once();
    Atomics.add(count, 0, 1);
  }
})().then(() => parentPort.postMessage('done'), (error) => parentPort.postMessage(String(error)));
`;

/**
 * The pipe and socket ends each of `pids` holds besides its stdin, stdout and stderr, each named
 * by what it's an end of, so ends of the same pipe compare equal.
 */
function pipeEnds(pids: number[]): Map<number, string[]> {
  const ends = new Map<number, string[]>(pids.map((pid) => [pid, []]));
  if (existsSync('/proc/self/fd')) {
    for (const pid of pids) {
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        if (Number(fd) <= 2) continue;
        const target = readlinkSync(`/proc/${pid}/fd/${fd}`);
        if (/^(?:pipe|socket):/.test(target)) ends.get(pid)?.push(target);
      }
    }
    return ends;
  }
  // `lsof` lists each file as lines of fields: `p<pid>`, then `f<fd>`, `t<type>` and `d<device>`
  // for each, where a pipe's or socket's device names it.
  const listing = execFileSync('lsof', ['-a', '-p', pids.join(','), '-d', '3-65535', '-F', 'ftd'], {
    encoding: 'utf8',
  });
  let pid = 0;
  let type = '';
  for (const line of listing.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') pid = Number(value);
    else if (field === 't') type = value;
    else if (field === 'd' && (type === 'PIPE' || type === 'unix')) ends.get(pid)?.push(value);
  }
  return ends;
}

/** Ends `children`, each a `cat-file --batch`, by ending their input. */
async function end(children: Child[]): Promise<void> {
  for (const child of children) child.stdin?.end();
  await Promise.all(children.map((child) => child.exited));
}

test('a long lived child never holds another childs pipe', { timeout: 180_000 }, async () => {
  const dir = tempFolder();
  const clone = join(dir, 'repo.git');
  git(dir, 'init', '-q', '--bare', clone);
  const lo = await runnerIn(dir);
  const longLived = () =>
    lo.command({ gitDir: clone }).arg('cat-file', '--batch').start({ input: true });
  // What every child holds anyway: ends this process passes on to all of its children.
  const alone = longLived();
  const passedOn = new Set(pipeEnds([alone.pid ?? 0]).get(alone.pid ?? 0));
  await end([alone]);

  const counter = new SharedArrayBuffer(4);
  const count = new Int32Array(counter);
  const workerData = {
    program: lo.git.program,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' },
    cwd: dir,
    runs: SHORT_RUNS,
    counter,
  };
  const workers = Array.from({ length: THREADS }, () => {
    const worker = new Worker(WORKER, { eval: true, workerData });
    return new Promise<string>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  });

  let started = 0;
  const leaked: string[][] = [];
  while (Atomics.load(count, 0) < SHORT_RUNS) {
    const batch = Array.from({ length: BATCH }, longLived);
    started += batch.length;
    const ends = pipeEnds(batch.map((child) => child.pid ?? 0));
    for (const held of ends.values()) {
      const theirs = held.filter((each) => !passedOn.has(each));
      if (theirs.length > 0) leaked.push(theirs);
    }
    await end(batch);
  }

  expect(await Promise.all(workers)).toEqual(Array.from({ length: THREADS }, () => 'done'));
  expect(started).toBeGreaterThan(100);
  expect(leaked, `${leaked.length} of ${started} long-lived children inherited pipe ends`).toEqual(
    [],
  );
});
