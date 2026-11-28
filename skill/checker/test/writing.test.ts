/**
 * `start` and `done`: the overview's writer marks the pull request's overview as being written, so
 * the skill's hook starts no other writer for it, and when it's done, learns whether a push came in
 * meanwhile and it's to write the overview again. The lock is in the repository's git folder, which
 * the hook and a command in Claude Code's sandbox, with a temporary folder of its own, both reach.
 */

import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { lockFolder, pullOf, takeLock } from '@lo/skill/hook.mjs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { git } from '@lo/testing/git';

import { runChecker, scratch, type Ran } from './support.ts';

const LINK = 'https://github.com/acme/demo/pull/7';

let root: ReturnType<typeof scratch>;
let made = 0;

beforeAll(() => {
  root = scratch('writing');
});

afterAll(() => root.remove());

/** A folder of its own. */
function fresh(name: string): string {
  const dir = join(realpathSync(root.dir), `${name}-${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A repository of its own, as the writer started in. */
function repo(): string {
  const dir = fresh('repo');
  git(dir, 'init', '-q');
  return dir;
}

/**
 * Runs the checker with `args` from a folder outside the repository, as the skill does from its
 * own, with a temporary folder of its own, as a sandboxed command has.
 */
function run(args: readonly string[]): Ran {
  const tmp = fresh('tmp');
  return runChecker(args, tmp, { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp });
}

/** The pull request `LINK` names. */
function pull(): NonNullable<ReturnType<typeof pullOf>> {
  const found = pullOf(LINK);
  if (found === undefined) throw new Error('Not a link.');
  return found;
}

describe('start and done', () => {
  test('hold the hook off while the writer writes, and hand it the push that came in', () => {
    const dir = repo();
    expect(run(['start', LINK, '--repo', dir])).toEqual({
      status: 0,
      stdout: `Lo marked the overview of ${LINK} as being written, for 30 minutes, or until done says otherwise.\n`,
      stderr: '',
    });
    // The hook, with a temporary folder of its own, for a push meanwhile, and another.
    const hook = { dir, env: { TMPDIR: fresh('hook') } };
    expect(takeLock(pull(), hook)).toBe('held');
    expect(takeLock(pull(), hook)).toBe('held');
    expect(run(['done', LINK, '--repo', dir])).toEqual({
      status: 0,
      stdout: `A push came in while you wrote: write the overview of ${LINK} again, for the pull request as it is now, starting from the overview you pushed. Then run done again.\n`,
      stderr: '',
    });
    // Still the writer's, as it writes again.
    expect(takeLock(pull(), hook)).toBe('held');
    expect(JSON.parse(run(['done', LINK, '--repo', dir, '--json']).stdout)).toEqual({
      again: true,
      failed: false,
    });
    expect(run(['done', LINK, '--repo', dir]).stdout).toBe(
      `Nothing came in while you wrote the overview of ${LINK}.\n`,
    );
    expect(takeLock(pull(), hook)).toBe('taken');
  });

  test('keep a lock the hook took, as the writer it started, from a folder in the clone', () => {
    const dir = repo();
    mkdirSync(join(dir, 'src'));
    expect(takeLock(pull(), { dir })).toBe('taken');
    expect(JSON.parse(run(['start', LINK, '--repo', join(dir, 'src'), '--json']).stdout)).toEqual({
      locked: true,
    });
    expect(JSON.parse(run(['done', LINK, '--repo', dir, '--json']).stdout)).toEqual({
      again: false,
      failed: false,
    });
  });

  test('say plainly when they couldn’t keep or give back the lock', () => {
    const nowhere = fresh('nowhere');
    expect(run(['start', LINK, '--repo', nowhere])).toEqual({
      status: 2,
      stdout: '',
      stderr: `Lo couldn't mark the overview of ${LINK} as being written: it couldn't write its lock in the git folder of ${nowhere}. Go on, and say so when you report: a push meanwhile may start another writer.\n`,
    });
    expect(run(['done', LINK, '--repo', nowhere])).toEqual({
      status: 2,
      stdout: '',
      stderr: `Lo couldn't say the overview of ${LINK} is written: it couldn't read or write its lock in the git folder of ${nowhere}. Say so when you report: a push that came in while you wrote may get no overview.\n`,
    });
    expect(JSON.parse(run(['done', LINK, '--repo', nowhere, '--json']).stdout)).toEqual({
      again: false,
      failed: true,
    });
  });

  test.skipIf(process.getuid?.() === 0)(
    'say done couldn’t when the follow-up a push left can’t be taken, never that nothing came',
    () => {
      const dir = repo();
      expect(run(['start', LINK, '--repo', dir]).status).toBe(0);
      expect(takeLock(pull(), { dir })).toBe('held');
      const folder = lockFolder(dir);
      if (folder === undefined) throw new Error('No folder of locks.');
      chmodSync(folder, 0o500);
      try {
        const ran = run(['done', LINK, '--repo', dir]);
        expect(ran.status).toBe(2);
        expect(ran.stderr).toContain("Lo couldn't say the overview");
      } finally {
        chmodSync(folder, 0o700);
      }
      expect(run(['done', LINK, '--repo', dir]).stdout).toContain('A push came in while you wrote');
    },
  );

  test('take only a pull request’s link', () => {
    for (const args of [
      ['start', 'https://github.com/acme/demo/pull/7/files'],
      ['done', '7'],
      ['start'],
      ['start', LINK, LINK],
      ['done', LINK, '--pr', '7'],
      ['done', LINK, '--repo'],
    ]) {
      const ran = run(args);
      expect({ args, status: ran.status, stdout: ran.stdout }).toEqual({
        args,
        status: 2,
        stdout: '',
      });
    }
    expect(run(['done', '7']).stderr).toBe(
      `"7" isn't a pull request's link, such as https://github.com/<owner>/<repo>/pull/<number>.\n`,
    );
  });
});
