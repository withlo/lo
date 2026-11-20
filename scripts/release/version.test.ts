import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, onTestFinished, test } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'version.sh');

/** git, in `dir`, with no config but this, so the machine's hooks and signing stay out. */
function git(dir: string, ...args: string[]): string {
  const run = spawnSync('git', ['-c', 'user.name=Lo', '-c', 'user.email=lo@example.com', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/**
 * A repository whose main has two commits, with a branch `side` off it holding one more, checked
 * out at main's head. It's removed when the test finishes.
 */
function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lo-version-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'commit', '--quiet', '--allow-empty', '--message=first');
  git(dir, 'commit', '--quiet', '--allow-empty', '--message=second');
  git(dir, 'switch', '--quiet', '--create', 'side');
  git(dir, 'commit', '--quiet', '--allow-empty', '--message=on a branch');
  git(dir, 'switch', '--quiet', 'main');
  return dir;
}

/** What version.sh says for `ref`, checked against main, run in `dir`. */
function version(dir: string, ref: string) {
  const run = spawnSync('sh', [script, ref, 'main'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('version.sh', () => {
  test.each([
    ['a release', 'v0.1.0', '0.1.0', 'false'],
    ['a release with numbers past 9', 'v10.20.30', '10.20.30', 'false'],
    ['a release candidate', 'v0.1.0-rc.1', '0.1.0-rc.1', 'true'],
    ['a prerelease of names and hyphens', 'v1.0.0-alpha-2.beta', '1.0.0-alpha-2.beta', 'true'],
    ['a prerelease identifier that starts with a digit', 'v1.0.0-0a', '1.0.0-0a', 'true'],
  ])('takes %s, %s', (_, tag, expected, prerelease) => {
    const dir = repository();
    git(dir, 'tag', tag);
    expect(version(dir, `refs/tags/${tag}`)).toEqual({
      status: 0,
      stdout: `version=${expected}\nprerelease=${prerelease}\n`,
      stderr: '',
    });
  });

  test('takes an annotated tag', () => {
    const dir = repository();
    git(dir, 'tag', '--annotate', '--message=Lo 0.1.0', 'v0.1.0');
    expect(version(dir, 'refs/tags/v0.1.0').stdout).toBe('version=0.1.0\nprerelease=false\n');
  });

  test('takes a tag on an older commit of main, checked out', () => {
    const dir = repository();
    git(dir, 'switch', '--quiet', '--detach', 'main~1');
    git(dir, 'tag', 'v0.1.0');
    expect(version(dir, 'refs/tags/v0.1.0').status).toBe(0);
  });

  test.each([
    ['no v', '0.1.0', "isn't a release's tag"],
    ['two vs', 'vv0.1.0', "isn't a v and a SemVer version"],
    ['a capital V', 'V0.1.0', "isn't a release's tag"],
    ['two numbers', 'v0.1', "isn't a v and a SemVer version"],
    ['four numbers', 'v0.1.0.1', "isn't a v and a SemVer version"],
    ['a leading zero', 'v01.1.0', "isn't a v and a SemVer version"],
    [
      'a numeric prerelease identifier with a leading zero',
      'v0.1.0-rc.01',
      "isn't a v and a SemVer version",
    ],
    ['an empty prerelease', 'v0.1.0-', "isn't a v and a SemVer version"],
    ['an empty prerelease identifier', 'v0.1.0-rc..1', "isn't a v and a SemVer version"],
    ['an underscore', 'v0.1.0-rc_1', "isn't a v and a SemVer version"],
    ['build metadata', 'v0.1.0+build.1', 'has build metadata'],
    ['build metadata after a prerelease', 'v0.1.0-rc.1+build', 'has build metadata'],
    ['a letter that only looks like a digit', 'v0.1.０', "isn't a v and a SemVer version"],
  ])('refuses a tag with %s, %s', (_, tag, why) => {
    // Refused by its name alone, so it needn't exist; git wouldn't make some of these.
    const run = version(repository(), `refs/tags/${tag}`);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain(why);
  });

  test('refuses a ref with a line break before reading anything else', () => {
    const run = version(repository(), 'refs/tags/v0.1.0\nversion=9.9.9');
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain('line break');
  });

  test('refuses a branch', () => {
    const run = version(repository(), 'refs/heads/main');
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain("isn't a tag");
  });

  test("refuses a tag that isn't here", () => {
    const run = version(repository(), 'refs/tags/v0.1.0');
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain("There's no tag v0.1.0 here.");
  });

  test("refuses a tag on a commit main doesn't hold", () => {
    const dir = repository();
    git(dir, 'switch', '--quiet', 'side');
    git(dir, 'tag', 'v0.1.0');
    const run = version(dir, 'refs/tags/v0.1.0');
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain("which main doesn't hold");
  });

  test("refuses a tag that isn't on the commit checked out", () => {
    const dir = repository();
    git(dir, 'tag', 'v0.1.0', 'main~1');
    const run = version(dir, 'refs/tags/v0.1.0');
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain("isn't on the commit checked out");
  });
});
