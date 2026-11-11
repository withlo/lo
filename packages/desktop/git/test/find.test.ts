import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, statSync, symlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { defaultPlaces, findGit, gitAt } from '../src/find.ts';
import { compareVersions, MINIMUM_VERSION } from '../src/version.ts';
import { fakeGit, script, tempFolder, wrappedGit } from './support.ts';

const env = process.env;
const { platform } = process;
const { groups } = defaultPlaces(platform);

test('finds a git new enough', async () => {
  const status = await findGit({ env, platform });
  if (status.status !== 'found') throw new Error(status.message);
  expect(compareVersions(status.git.version, MINIMUM_VERSION)).toBeGreaterThanOrEqual(0);
  expect(isAbsolute(status.git.program)).toBe(true);
});

test('refuses a git older than 2 41', async () => {
  const dir = tempFolder();
  const old = await gitAt(fakeGit(join(dir, 'git'), '2.39.5 (Apple Git-154)'), {
    env,
    platform: 'darwin',
  });
  if (old.status !== 'tooOld') throw new Error(`found ${old.status}`);
  expect(old.version).toEqual({ major: 2, minor: 39, patch: 5 });
  expect(old.check).toBe('version');
  expect(old.message).toContain('git 2.41.0 or newer');
  expect(old.message).toContain('is git 2.39.5');
  expect(old.install).toContain('xcode-select --install');
  // 2.40 has no `--attr-source`, which keeps a repository's attributes out of what Lo reads.
  const older = await gitAt(fakeGit(join(dir, 'git-2.40'), '2.40.1'), { env, platform });
  expect(older.status).toBe('tooOld');

  const floor = await gitAt(wrappedGit(join(dir, 'git-2.41'), { version: '2.41.0' }), {
    env,
    platform,
  });
  if (floor.status !== 'found') throw new Error(`found ${floor.status}`);
  expect(floor.git.version).toEqual({ major: 2, minor: 41, patch: 0 });
});

test('missing git says how to install it', async () => {
  const dir = tempFolder();
  const missing = await gitAt(join(dir, 'no-git-here'), { env, platform: 'darwin' });
  expect(missing.status).toBe('missing');
  if (missing.status === 'found') return;
  expect(missing.install).toContain('xcode-select --install');

  // Something that runs but isn't git counts as missing too.
  const notGit = script(join(dir, 'git'), 'echo hello');
  expect((await gitAt(notGit, { env, platform })).status).toBe('missing');
});

/** A folder with an Apple git that leaves a marker when it runs, and an `xcode-select`. */
function apple(commandLineTools: boolean) {
  const dir = tempFolder();
  const bin = join(dir, 'usr-bin');
  mkdirSync(bin);
  const marker = join(dir, 'apple-git-ran');
  const git = wrappedGit(join(bin, 'git'), { before: `/usr/bin/touch '${marker}'` });
  const developer = join(dir, 'CommandLineTools');
  if (commandLineTools) {
    mkdirSync(join(developer, 'usr', 'bin'), { recursive: true });
    wrappedGit(join(developer, 'usr', 'bin', 'git'));
  }
  const xcodeSelect = script(
    join(dir, 'xcode-select'),
    commandLineTools
      ? `echo '${developer}'`
      : 'echo "xcode-select: error: unable to get active developer directory" >&2; exit 2',
  );
  return { dir, bin, git, marker, places: { apple: { git, xcodeSelect }, folders: [], groups } };
}

describe('on a Mac', () => {
  test('never runs Apple’s git without the Command Line Tools, which would offer to install them', async () => {
    const { bin, marker, places } = apple(false);
    // On PATH too, as /usr/bin is.
    const status = await findGit({ env: { PATH: bin }, platform: 'darwin', places });
    expect(status.status).toBe('missing');
    expect(existsSync(marker)).toBe(false);
  });

  test('runs Apple’s git first once the Command Line Tools are there', async () => {
    const { dir, git, marker, places } = apple(true);
    const other = join(dir, 'homebrew');
    mkdirSync(other);
    wrappedGit(join(other, 'git'));
    const status = await findGit({ env: { PATH: other }, platform: 'darwin', places });
    expect(status.status === 'found' && status.git.program).toBe(git);
    expect(existsSync(marker)).toBe(true);
  });
});

test('looks on PATH, then in the system’s folders, and takes the first git new enough', async () => {
  const dir = tempFolder();
  const folder = (name: string) => {
    mkdirSync(join(dir, name));
    return join(dir, name);
  };
  const [first, second, third] = [folder('first'), folder('second'), folder('third')];
  fakeGit(join(first, 'git'), '2.39.5');
  const newEnough = wrappedGit(join(third, 'git'));
  const places = { folders: [third], groups };

  const found = await findGit({ env: { PATH: `${first}:${second}` }, platform, places });
  expect(found.status === 'found' && found.git.program).toBe(newEnough);

  // With none new enough, the first too old is the one named.
  const tooOld = await findGit({
    env: { PATH: first },
    platform: 'linux',
    places: { folders: [], groups },
  });
  expect(tooOld).toMatchObject({ status: 'tooOld', program: join(first, 'git') });
  if (tooOld.status !== 'tooOld') return;
  expect(tooOld.install).toContain('package manager');
});

test('finds a git installed since it last looked', async () => {
  const dir = tempFolder();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const options = { env: { PATH: bin }, platform, places: { folders: [], groups } };
  expect((await findGit(options)).status).toBe('missing');

  wrappedGit(join(bin, 'git'));

  expect((await findGit(options)).status).toBe('found');
});

test('refuses a git that would download what a clone lacks without being asked', async () => {
  const dir = tempFolder();
  // As a git that doesn't know the variable behaves.
  const eager = wrappedGit(join(dir, 'git'), {
    before: 'GIT_NO_LAZY_FETCH=0; export GIT_NO_LAZY_FETCH',
  });

  const status = await gitAt(eager, { env, platform });

  expect(status).toMatchObject({ status: 'tooOld', check: 'lazyFetch' });
  if (status.status !== 'tooOld') return;
  expect(status.message).toContain('GIT_NO_LAZY_FETCH');
  expect(status.message).toContain(eager);
});

/** What the May 2024 maintenance releases say when they don't download a missing object. */
const WARNING = 'warning: lazy fetching disabled; some objects may not be available';

/** A line of shell that prints `text` on stderr when git runs `cat-file`. */
function says(text: string): string {
  return `case " $* " in *" cat-file "*) echo '${text}' >&2;; esac`;
}

test('takes a maintenance release that says lazy fetching is off', async () => {
  const dir = tempFolder();
  // As 2.43.4 does: it honors the variable, and says so on stderr.
  const maintenance = wrappedGit(join(dir, 'git'), { version: '2.43.4', before: says(WARNING) });
  const other = wrappedGit(join(dir, 'git-other'), {
    version: '2.43.4',
    before: says('warning: something else'),
  });
  const twice = wrappedGit(join(dir, 'git-twice'), {
    version: '2.43.4',
    before: `${says(WARNING)}\n${says('error: and more')}`,
  });

  const found = await gitAt(maintenance, { env, platform });
  expect(found.status === 'found' && found.git.version).toEqual({ major: 2, minor: 43, patch: 4 });
  // Only that line, alone.
  expect(await gitAt(other, { env, platform })).toMatchObject({ check: 'lazyFetch' });
  expect(await gitAt(twice, { env, platform })).toMatchObject({ check: 'lazyFetch' });
});

describe('passes over a git someone else could change, and says so', () => {
  test.each([
    ['a git others may write to', 0o700, 0o777, 'other users can change it'],
    ['a git its group may write to', 0o700, 0o775, 'other users can change it'],
    ['a git in a folder its group may write to', 0o775, 0o755, 'other users can change {bin}'],
    ['a git in a folder anyone may write to', 0o777, 0o755, 'other users can change {bin}'],
    [
      'a git in a folder anyone may write to, sticky as /tmp is',
      0o1777,
      0o755,
      'other users can change {bin}',
    ],
  ])('%s', async (_, folderMode, fileMode, reason) => {
    const dir = tempFolder();
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const git = wrappedGit(join(bin, 'git'));
    chmodSync(git, fileMode);
    chmodSync(bin, folderMode);
    const options = { env: { PATH: bin }, platform, places: { folders: [], groups } };

    expect(await findGit(options)).toMatchObject({
      status: 'missing',
      message: `Lo found git at ${git}, but ${reason.replace('{bin}', bin)}, so Lo won't run it.`,
    });

    chmodSync(git, 0o755);
    chmodSync(bin, 0o755);
    expect((await findGit(options)).status).toBe('found');
  });

  test('a git whose folder sits in a folder anyone may write to, unless it’s sticky', async () => {
    const dir = tempFolder();
    const open = join(dir, 'open');
    const bin = join(open, 'bin');
    mkdirSync(bin, { recursive: true });
    wrappedGit(join(bin, 'git'));
    // Anyone could move `bin` aside and put another in its place.
    chmodSync(open, 0o777);
    const options = { env: { PATH: bin }, platform, places: { folders: [], groups } };

    expect(await findGit(options)).toMatchObject({
      status: 'missing',
      message: expect.stringContaining(`other users can change ${open}`),
    });

    // Sticky, nobody else can move what's this user's in it, as in /tmp.
    chmodSync(open, 0o1777);
    expect((await findGit(options)).status).toBe('found');
  });

  test('a link to a git in a folder anyone may write to', async () => {
    const dir = tempFolder();
    const [bin, open] = [join(dir, 'bin'), join(dir, 'open')];
    mkdirSync(bin);
    mkdirSync(open);
    const git = wrappedGit(join(open, 'git'));
    symlinkSync(git, join(bin, 'git'));
    chmodSync(open, 0o777);
    const options = { env: { PATH: bin }, platform, places: { folders: [], groups } };

    expect(await findGit(options)).toMatchObject({
      status: 'missing',
      message: expect.stringContaining(`other users can change ${open}`),
    });

    chmodSync(open, 0o755);
    expect((await findGit(options)).status).toBe('found');
  });
});

/** Homebrew's layout: `bin/git` links to the git in `Cellar`, and its folders are 775. */
function homebrew(): { bin: string; folders: string[] } {
  const prefix = join(tempFolder(), 'homebrew');
  const cellar = join(prefix, 'Cellar', 'git', '2.51.0', 'bin');
  mkdirSync(cellar, { recursive: true });
  mkdirSync(join(prefix, 'bin'));
  const git = wrappedGit(join(cellar, 'git'));
  symlinkSync(git, join(prefix, 'bin', 'git'));
  const folders = [join(prefix, 'bin'), join(prefix, 'Cellar'), cellar];
  for (const folder of folders) chmodSync(folder, 0o775);
  return { bin: join(prefix, 'bin'), folders };
}

/** Whether this user is in the Mac's `admin` group, and so may give it a folder. */
const admin =
  platform === 'darwin' &&
  execFileSync('id', ['-G'], { encoding: 'utf8' }).trim().split(' ').includes('80');

describe('takes a git whose folders root’s or admin’s group may write to, as Homebrew’s are', () => {
  test('only in a group trusted to', async () => {
    const { bin } = homebrew();
    const gid = statSync(bin).gid;
    const options = (trusted: readonly number[]) => ({
      env: { PATH: bin },
      platform,
      places: { folders: [], groups: trusted },
    });

    // The folders' group here is the user's, not root's or admin's, so its members could change git.
    expect(groups).not.toContain(gid);
    expect(await findGit(options(groups))).toMatchObject({
      status: 'missing',
      message: expect.stringContaining('other users can change'),
    });
    expect((await findGit(options([...groups, gid]))).status).toBe('found');
  });

  test('trusted are root’s group, and on a Mac admin’s, Homebrew’s', () => {
    expect(defaultPlaces('darwin').groups).toEqual([0, 80]);
    expect(defaultPlaces('linux').groups).toEqual([0]);
  });

  test.runIf(admin)('in admin, on a Mac', async () => {
    const { bin, folders } = homebrew();
    for (const folder of folders) execFileSync('chgrp', ['admin', folder]);

    expect((await findGit({ env: { PATH: bin }, platform })).status).toBe('found');
  });
});
