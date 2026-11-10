import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { findGit, gitAt } from '../src/find.ts';
import { compareVersions, MINIMUM_VERSION } from '../src/version.ts';
import { fakeGit, script, tempFolder, wrappedGit } from './support.ts';

const env = process.env;
const { platform } = process;

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
  return { dir, bin, git, marker, places: { apple: { git, xcodeSelect }, folders: [] } };
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
  const places = { folders: [third] };

  const found = await findGit({ env: { PATH: `${first}:${second}` }, platform, places });
  expect(found.status === 'found' && found.git.program).toBe(newEnough);

  // With none new enough, the first too old is the one named.
  const tooOld = await findGit({
    env: { PATH: first },
    platform: 'linux',
    places: { folders: [] },
  });
  expect(tooOld).toMatchObject({ status: 'tooOld', program: join(first, 'git') });
  if (tooOld.status !== 'tooOld') return;
  expect(tooOld.install).toContain('package manager');
});

test('finds a git installed since it last looked', async () => {
  const dir = tempFolder();
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const options = { env: { PATH: bin }, platform, places: { folders: [] } };
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
