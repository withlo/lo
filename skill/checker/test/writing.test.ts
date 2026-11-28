/**
 * `start` and `done`: the overview's writer marks the pull request's overview as being written, so
 * the skill's hook starts no other writer for it, and when it's done, learns whether a push came in
 * meanwhile and it's to write the overview again.
 */

import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { pullOf, takeLock } from '@lo/skill/hook.mjs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { runChecker, scratch, type Ran } from './support.ts';

const LINK = 'https://github.com/acme/demo/pull/7';

let root: ReturnType<typeof scratch>;
let made = 0;

beforeAll(() => {
  root = scratch('writing');
});

afterAll(() => root.remove());

/** A temporary folder of its own, for one writer and its hook. */
function freshTemp(): string {
  const dir = join(realpathSync(root.dir), `tmp-${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs the checker with `args`, with `tmp` as the temporary folder. */
function run(args: readonly string[], tmp: string): Ran {
  return runChecker(args, tmp, { PATH: process.env.PATH, HOME: tmp, LO_OVERVIEW_TMP: tmp });
}

describe('start and done', () => {
  test('hold the hook off while the writer writes, and hand it the push that came in', () => {
    const tmp = freshTemp();
    const pull = pullOf(LINK);
    if (pull === undefined) throw new Error('Not a link.');
    expect(run(['start', LINK], tmp)).toEqual({
      status: 0,
      stdout: `Lo marked the overview of ${LINK} as being written, for 30 minutes, or until done says otherwise.\n`,
      stderr: '',
    });
    // The hook, for a push meanwhile, and another.
    expect(takeLock(pull, { env: { LO_OVERVIEW_TMP: tmp } })).toBe('held');
    expect(takeLock(pull, { env: { LO_OVERVIEW_TMP: tmp } })).toBe('held');
    expect(run(['done', LINK], tmp)).toEqual({
      status: 0,
      stdout: `A push came in while you wrote: write the overview of ${LINK} again, for the pull request as it is now, starting from the overview you pushed. Then run done again.\n`,
      stderr: '',
    });
    // Still the writer's, as it writes again.
    expect(takeLock(pull, { env: { LO_OVERVIEW_TMP: tmp } })).toBe('held');
    expect(JSON.parse(run(['done', LINK, '--json'], tmp).stdout)).toEqual({ again: true });
    expect(run(['done', LINK], tmp).stdout).toBe(
      `Nothing came in while you wrote the overview of ${LINK}.\n`,
    );
    expect(takeLock(pull, { env: { LO_OVERVIEW_TMP: tmp } })).toBe('taken');
  });

  test('keep a lock the hook took, as the writer it started', () => {
    const tmp = freshTemp();
    const pull = pullOf(LINK);
    if (pull === undefined) throw new Error('Not a link.');
    expect(takeLock(pull, { env: { LO_OVERVIEW_TMP: tmp } })).toBe('taken');
    expect(JSON.parse(run(['start', LINK, '--json'], tmp).stdout)).toEqual({ locked: true });
    expect(JSON.parse(run(['done', LINK, '--json'], tmp).stdout)).toEqual({ again: false });
  });

  test('take only a pull request’s link', () => {
    const tmp = freshTemp();
    for (const args of [
      ['start', 'https://github.com/acme/demo/pull/7/files'],
      ['done', '7'],
      ['start'],
      ['start', LINK, LINK],
      ['done', LINK, '--pr', '7'],
    ]) {
      const ran = run(args, tmp);
      expect({ args, status: ran.status, stdout: ran.stdout }).toEqual({
        args,
        status: 2,
        stdout: '',
      });
    }
    expect(run(['done', '7'], tmp).stderr).toBe(
      `"7" isn't a pull request's link, such as https://github.com/<owner>/<repo>/pull/<number>.\n`,
    );
  });
});
