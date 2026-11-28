/**
 * `start` and `done`: the overview's writer marks the pull request's overview as being written, so
 * the skill's hook starts no other writer for it, and when it's done, learns whether a push came in
 * meanwhile and it's to write the overview again. The lock is in the repository's git folder, which
 * the hook and a command in Claude Code's sandbox, with a temporary folder of its own, both reach.
 */

import { chmodSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { cloneLink, lockFolder, pullOf, takeLock } from '@lo/skill/hook.mjs';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

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

/** The person's temporary folder, where `/tmp`'s folder of locks goes, shared by the hook. */
let shared: { LO_OVERVIEW_TMP: string };

beforeEach(() => {
  shared = { LO_OVERVIEW_TMP: fresh('shared') };
});

/**
 * Runs the checker with `args` from a folder outside the repository, as the skill does from its
 * own, with a temporary folder of its own, as a sandboxed command has.
 */
function run(args: readonly string[]): Ran {
  const tmp = fresh('tmp');
  return runChecker(args, tmp, { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, ...shared });
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
    const hook = { dir, env: { TMPDIR: fresh('hook'), ...shared } };
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
    expect(takeLock(pull(), { dir, env: shared })).toBe('taken');
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
    // Outside a repository, start keeps it in /tmp, but done can't see a git folder's.
    expect(run(['start', LINK, '--repo', nowhere]).status).toBe(0);
    expect(run(['done', LINK, '--repo', nowhere])).toEqual({
      status: 2,
      stdout: '',
      stderr: `Lo couldn't say the overview of ${LINK} is written: it couldn't read or remove its lock for ${nowhere}, in the repository's git folder or in /tmp. Say so when you report: a push that came in while you wrote may get no overview.\n`,
    });
    expect(JSON.parse(run(['done', LINK, '--repo', nowhere, '--json']).stdout)).toEqual({
      again: false,
      failed: true,
    });
    // With /tmp's folder someone else's to write, start has nowhere to keep it.
    const open = join(shared.LO_OVERVIEW_TMP, `lo-overview-${process.getuid?.() ?? ''}`);
    mkdirSync(open, { recursive: true });
    chmodSync(open, 0o777);
    expect(run(['start', LINK, '--repo', nowhere])).toEqual({
      status: 2,
      stdout: '',
      stderr: `Lo couldn't mark the overview of ${LINK} as being written: it could write its lock neither in the git folder of ${nowhere} nor in /tmp. Go on, and say so when you report: a push meanwhile may start another writer.\n`,
    });
  });

  test('take the clone the hook names by its link, whatever its path holds', () => {
    const dir = join(fresh('odd'), "it's a clone");
    mkdirSync(dir);
    git(dir, 'init', '-q');
    expect(takeLock(pull(), { dir, env: shared })).toBe('taken');
    const link = cloneLink(dir);
    expect(run(['start', LINK, '--repo', link]).status).toBe(0);
    expect(takeLock(pull(), { dir, env: shared })).toBe('held');
    expect(JSON.parse(run(['done', LINK, '--repo', link, '--json']).stdout)).toEqual({
      again: true,
      failed: false,
    });
    expect(run(['done', LINK, '--repo', 'file://elsewhere/x']).stderr).toBe(
      `"file://elsewhere/x" isn't a link to a folder here.\n`,
    );
  });

  test.skipIf(process.getuid?.() === 0)(
    'keep and give back the lock in /tmp where they can’t write the git folder, as in Codex',
    () => {
      const dir = repo();
      // Codex's hook takes it in /tmp, which its sandbox lets its commands write.
      expect(takeLock(pull(), { dir, env: shared, host: 'codex' })).toBe('taken');
      const folder = lockFolder(dir);
      if (folder === undefined) throw new Error('No folder of locks.');
      chmodSync(folder, 0o500);
      try {
        expect(run(['start', LINK, '--repo', dir]).status).toBe(0);
        expect(takeLock(pull(), { dir, env: shared, host: 'codex' })).toBe('held');
        expect(run(['done', LINK, '--repo', dir]).stdout).toContain(
          'A push came in while you wrote',
        );
        expect(run(['done', LINK, '--repo', dir]).stdout).toContain('Nothing came in');
      } finally {
        chmodSync(folder, 0o700);
      }
      expect(takeLock(pull(), { dir, env: shared, host: 'codex' })).toBe('taken');
    },
  );

  test.skipIf(process.getuid?.() === 0)(
    'say done couldn’t when the follow-up a push left can’t be taken, never that nothing came',
    () => {
      const dir = repo();
      expect(run(['start', LINK, '--repo', dir]).status).toBe(0);
      expect(takeLock(pull(), { dir, env: shared })).toBe('held');
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
