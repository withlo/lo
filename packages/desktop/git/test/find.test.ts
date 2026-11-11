import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { gitProgram } from '@lo/testing/git';
import { describe, expect, onTestFinished, test, vi } from 'vitest';

import { defaultPlaces, findGit, gitAt } from '../src/find.ts';
import { STOP_GRACE } from '../src/spawn.ts';
import { compareVersions, MINIMUM_VERSION } from '../src/version.ts';
import { eventually, fakeGit, script, tempFolder, wrappedGit } from './support.ts';

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

  test('takes a newer git from Homebrew over Apple’s', async () => {
    const { dir, places } = apple(true);
    const brew = join(dir, 'homebrew');
    mkdirSync(brew);
    // Newer than any git Apple ships.
    const newer = wrappedGit(join(brew, 'git'), { version: '3.0.0' });
    const status = await findGit({
      env: { PATH: '' },
      platform: 'darwin',
      places: { ...places, folders: [brew] },
    });
    expect(status.status === 'found' && status.git.program).toBe(newer);
  });
});

test('takes the newest git new enough wherever it’s found, and the first found of those as new', async () => {
  const dir = tempFolder();
  const folder = (name: string) => {
    mkdirSync(join(dir, name));
    return join(dir, name);
  };
  const [onPath, system] = [folder('path'), folder('system')];
  wrappedGit(join(onPath, 'git'), { version: '2.45.1' });
  const newest = wrappedGit(join(system, 'git'), { version: '2.47.0' });
  const places = { folders: [system], groups };

  const found = await findGit({ env: { PATH: onPath }, platform, places });
  if (found.status !== 'found') throw new Error(found.status);
  expect(found.git.program).toBe(newest);
  expect(found.git.version).toEqual({ major: 2, minor: 47, patch: 0 });

  // Two as new as each other: the first found, as PATH comes before the system's folders.
  const same = folder('same');
  const first = wrappedGit(join(same, 'git'), { version: '2.47.0' });
  const tie = await findGit({ env: { PATH: same }, platform, places });
  expect(tie.status === 'found' && tie.git.program).toBe(first);

  // A newer git that can't be kept from downloading is passed over for the next newest.
  const eager = folder('eager');
  wrappedGit(join(eager, 'git'), {
    version: '2.48.0',
    before: 'GIT_NO_LAZY_FETCH=0; export GIT_NO_LAZY_FETCH',
  });
  const next = await findGit({ env: { PATH: `${eager}:${onPath}` }, platform, places });
  expect(next.status === 'found' && next.git.program).toBe(newest);
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

/** What a git may say when `GIT_NO_LAZY_FETCH` keeps it from downloading a missing object. */
const WARNING = 'warning: lazy fetching disabled; some objects may not be available';

/** A line of shell that prints `text` on stderr when git runs `cat-file`. */
function says(text: string): string {
  return `case " $* " in *" cat-file "*) echo '${text}' >&2;; esac`;
}

test('refuses a git that gives up on a file a clone lacks rather than saying its missing', async () => {
  const dir = tempFolder();
  // As the May 2024 updates of 2.41 to 2.44 do: an object nothing names is missing, but one a tree
  // in a pack names, as each file of a blobless clone is, is a fatal error.
  const givesUp = wrappedGit(join(dir, 'git'), {
    version: '2.43.7',
    before: [
      'case " $* " in *" cat-file -e "*)',
      '  for arg; do case "$arg" in --git-dir=*) dir="${arg#--git-dir=}";; esac; last=$arg; done',
      '  for idx in "$dir"/objects/pack/*.idx; do',
      '    [ -e "$idx" ] || continue',
      `    for object in $('${gitProgram()}' show-index < "$idx" | cut -d ' ' -f 2); do`,
      `      if '${gitProgram()}' --git-dir="$dir" ls-tree "$object" 2>/dev/null | grep -q "$last"; then`,
      `        echo '${WARNING}' >&2; echo "fatal: could not fetch $last from promisor remote" >&2; exit 128`,
      '      fi',
      '    done',
      '  done;;',
      'esac',
    ].join('\n'),
  });

  const status = await gitAt(givesUp, { env, platform });

  expect(status).toMatchObject({ status: 'tooOld', check: 'lazyFetch' });
});

test('takes a git that says lazy fetching is off', async () => {
  const dir = tempFolder();
  // A git may say so on stderr when the variable keeps it from downloading.
  const saying = wrappedGit(join(dir, 'git'), { version: '2.45.4', before: says(WARNING) });
  const other = wrappedGit(join(dir, 'git-other'), {
    version: '2.45.4',
    before: says('warning: something else'),
  });
  const twice = wrappedGit(join(dir, 'git-twice'), {
    version: '2.45.4',
    before: `${says(WARNING)}\n${says('error: and more')}`,
  });

  const found = await gitAt(saying, { env, platform });
  expect(found.status === 'found' && found.git.version).toEqual({ major: 2, minor: 45, patch: 4 });
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

/** Whether nothing is left running in the group `pid` led. */
function groupGone(pid: number): boolean {
  try {
    process.kill(-pid, 0);
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ESRCH';
  }
  // Something is in the group: only a process that has exited and waits to be collected, as one
  // whose parent exited first does until the system collects it, isn't running.
  return execFileSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .every((line) => {
      const [group, state = ''] = line.trim().split(/\s+/);
      return Number(group) !== pid || state.startsWith('Z');
    });
}

/**
 * The real git, in a folder of its own, noting each process it runs as. The command `slow`
 * matches, a `case` pattern, waits half a minute first, having made `started`.
 */
function slowGit(slow: string) {
  const dir = tempFolder();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const [pids, started] = [join(dir, 'pids'), join(dir, 'started')];
  const program = wrappedGit(join(bin, 'git'), {
    before: [
      `echo $$ >> '${pids}'`,
      // By their paths, since the look may give git no PATH to find them on.
      `case " $* " in ${slow}) /usr/bin/touch '${started}'; /bin/sleep 30;; esac`,
    ].join('\n'),
  });
  // Where the probe makes its throwaway clone.
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp);
  vi.stubEnv('TMPDIR', tmp);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const ran = () =>
    existsSync(pids) ? readFileSync(pids, 'utf8').trim().split('\n').map(Number) : [];
  return { bin, program, started, tmp, ran };
}

describe('a look that’s stopped stops every git it runs, and leaves nothing behind', () => {
  test('while it asks a git its version', async () => {
    const slow = slowGit('*" --version "*');
    const stopping = new AbortController();
    const looking = gitAt(slow.program, { env, platform, signal: stopping.signal });
    await eventually(() => existsSync(slow.started));

    const reason = new Error('Lo is quitting');
    const began = Date.now();
    stopping.abort(reason);

    await expect(looking).rejects.toBe(reason);
    // Within the grace a git gets to stop by itself.
    expect(Date.now() - began).toBeLessThan(STOP_GRACE + 1000);
    expect(slow.ran().length).toBeGreaterThan(0);
    expect(slow.ran().filter((pid) => !groupGone(pid))).toEqual([]);
  });

  test('while it asks a git whether it can be kept from downloading', async () => {
    const slow = slowGit('*" mktree "*');
    const stopping = new AbortController();
    const looking = findGit({
      env: { PATH: slow.bin },
      platform,
      places: { folders: [], groups },
      signal: stopping.signal,
    });
    await eventually(() => existsSync(slow.started));
    expect(readdirSync(slow.tmp)).toHaveLength(1);

    const reason = new Error('Lo is quitting');
    const began = Date.now();
    stopping.abort(reason);

    await expect(looking).rejects.toBe(reason);
    // Within the grace a git gets to stop by itself.
    expect(Date.now() - began).toBeLessThan(STOP_GRACE + 1000);
    expect(slow.ran().filter((pid) => !groupGone(pid))).toEqual([]);
    // The probe's throwaway clone is gone.
    expect(readdirSync(slow.tmp)).toEqual([]);
  });

  test('before it starts', async () => {
    const slow = slowGit('*');
    const reason = new Error('Lo is quitting');
    const signal = AbortSignal.abort(reason);
    await expect(findGit({ env: { PATH: slow.bin }, platform, signal })).rejects.toBe(reason);
    await expect(gitAt(slow.program, { env, platform, signal })).rejects.toBe(reason);
    expect(slow.ran()).toEqual([]);
  });
});
