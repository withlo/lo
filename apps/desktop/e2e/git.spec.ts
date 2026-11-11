// Git in the app: Lo started with a test git and a test remote reports git through app.info, keeps
// its cache in the data folder, cleans it up once the window is up, runs every git in an
// environment of its own, and leaves no git running once it quits. And without a git, or with one
// too old, the window opens and says why.

import { execFile, execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { git, gitProgram, RepoServer, testGitEnvironment } from '@lo/testing/git';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, test } from './app.ts';

/** Starts Lo on the test's data folder, with `env` added to its environment. */
async function launch(
  env: Record<string, string>,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appFolder],
    env: { ...appEnvironment(dataFolder()), ...env },
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { app, page };
}

/** What app.info says of git. */
async function gitInfo(page: Page): Promise<unknown> {
  const reply = await page.evaluate(() => window.lo.invoke('app.info'));
  const info = reply.ok ? reply.value : undefined;
  return typeof info === 'object' && info !== null && 'git' in info ? info.git : reply;
}

/** What app.info says of git once Lo has looked. */
async function gitFound(page: Page): Promise<unknown> {
  await expect.poll(() => gitInfo(page), { timeout: 15_000 }).not.toEqual({ status: 'checking' });
  return gitInfo(page);
}

/** An executable shell script at `path`. */
function script(path: string, lines: readonly string[]): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${lines.join('\n')}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** The version of the test's own git, as Lo writes it. */
function testGitVersion(): string {
  const said = execFileSync(gitProgram(), ['--version'], { encoding: 'utf8' });
  const [, major, minor, patch = '0'] = /^git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(said) ?? [];
  return `${major}.${minor}.${patch}`;
}

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

/** The background process's environment, read from outside it, as the system reports it. */
async function backgroundEnvironment(app: ElectronApplication): Promise<string> {
  const pid = () =>
    app.evaluate(
      (electronModule) =>
        electronModule.app.getAppMetrics().find((metric) => metric.name === 'Lo background')?.pid,
    );
  await expect.poll(pid).toBeDefined();
  const found = await pid();
  if (process.platform === 'linux') {
    return (await readFile(`/proc/${found}/environ`, 'utf8')).replaceAll('\0', '\n');
  }
  const { stdout } = await promisify(execFile)('ps', [
    'eww',
    '-o',
    'command=',
    '-p',
    String(found),
  ]);
  return stdout;
}

test('with a test git and remote, Lo finds git, cleans its cache up, and leaves no git running', async () => {
  const data = dataFolder();
  const runs = test.info().outputPath('runs');
  mkdirSync(runs, { recursive: true });
  // The real git, noting each process it runs as and the environment it got. It takes a moment
  // to say its version, so Lo is seen looking, and holds a repack until it's stopped, for a minute
  // at most.
  const program = script(test.info().outputPath('git', 'git'), [
    `echo $$ >> '${runs}/pids'`,
    `env > '${runs}/env.'$$`,
    'case "$1" in --version) sleep 2;; esac',
    'case " $* " in *" repack "*)',
    `  touch '${runs}/repacking'`,
    '  i=0; while [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done;;',
    'esac',
    `exec '${gitProgram()}' "$@"`,
  ]);
  // A clone already in the cache, with packs enough to repack as Lo cleans up.
  const clone = join(data, 'cache', 'repos', 'github.com', 'owner', 'repo.git');
  mkdirSync(dirname(clone), { recursive: true });
  git(dirname(clone), 'init', '--quiet', '--bare', '--template=', clone);
  execFileSync(
    'sh',
    [
      '-c',
      'for i in $(seq 1 51); do echo "$i" | git --git-dir="$0" hash-object -w --stdin | ' +
        'git --git-dir="$0" pack-objects -q "$0/objects/pack/pack" >/dev/null; done; ' +
        'git --git-dir="$0" prune-packed',
      clone,
    ],
    { env: testGitEnvironment() },
  );
  const remote = new RepoServer(test.info().outputPath('remote'));

  const { app, page } = await launch({
    LO_GIT: program,
    LO_GIT_REMOTE: remote.baseUrl,
    GITHUB_TOKEN: 'hunter2',
    LO_PLANTED: 'planted-value',
  });
  let pids: number[] = [];
  try {
    // The window opens before Lo has found git, and hears when it has.
    const heard = page.evaluate(
      () =>
        new Promise((resolve) => {
          const stop = window.lo.subscribe('app.git', (value) => {
            stop();
            resolve(value);
          });
        }),
    );
    expect(await gitInfo(page)).toEqual({ status: 'checking' });
    const found = { status: 'found', version: testGitVersion() };
    expect(await heard).toEqual(found);
    expect(await gitInfo(page)).toEqual(found);

    // The cache is in the data folder, and cleaning it up repacks the clone while the window
    // goes on answering.
    const cache = join(data, 'cache');
    await expect.poll(() => existsSync(join(cache, 'lo-cache.lock'))).toBe(true);
    expect(existsSync(join(cache, 'git-env', 'home'))).toBe(true);
    await expect.poll(() => existsSync(join(runs, 'repacking')), { timeout: 15_000 }).toBe(true);
    expect(await gitInfo(page)).toEqual(found);
    pids = readFileSync(join(runs, 'pids'), 'utf8').trim().split('\n').map(Number);
    expect(pids.filter((pid) => !groupGone(pid))).toHaveLength(1);

    // Nothing of git reaches the background process: not the git Lo runs, nor a PATH to find one.
    const background = await backgroundEnvironment(app);
    expect(background).toContain('LO_BACKGROUND=1');
    expect(background).not.toContain(program);
    expect(background).not.toMatch(/(^|\s)(PATH|LO_GIT)=/);

    await app.close();

    // No git is left, and the cache was closed.
    expect(pids.filter((pid) => !groupGone(pid))).toEqual([]);
    expect(existsSync(join(cache, 'lo-cache.lock'))).toBe(false);
    // Every git got an environment of Lo's making: nothing of main's, so no token.
    const environments = readdirSync(runs).filter((name) => name.startsWith('env.'));
    expect(environments.length).toBe(pids.length);
    for (const name of environments) {
      const text = readFileSync(join(runs, name), 'utf8');
      const names = text.split('\n').map((line) => line.split('=')[0]);
      expect(text).toContain('GIT_CONFIG_NOSYSTEM=1');
      for (const mains of [
        'GITHUB_TOKEN',
        'LO_PLANTED',
        'LO_GIT',
        'LO_GIT_REMOTE',
        'LO_USER_DATA_DIR',
      ]) {
        expect(names).not.toContain(mains);
      }
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('planted-value');
    }
  } finally {
    await app.close();
    // A test that failed leaves nothing running.
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Gone already.
      }
    }
    remote.remove();
  }
});

for (const [when, slow, clones] of [
  ['asks git its version', '*" --version "*', 0],
  ['asks whether git can be kept from downloading', '*" mktree "*', 1],
] as const) {
  test(`quitting while Lo ${when} leaves no git running and nothing behind`, async () => {
    const runs = test.info().outputPath('runs');
    // A short path: on Linux, Chromium keeps a socket in it, and a socket's path is short.
    const tmp = mkdtempSync(join(tmpdir(), 'lo-e2e-'));
    mkdirSync(runs, { recursive: true });
    // The real git, noting each process it runs as, which waits half a minute before the step.
    const program = script(test.info().outputPath('git', 'git'), [
      `echo $$ >> '${runs}/pids'`,
      `case " $* " in ${slow}) /usr/bin/touch '${runs}/started'; /bin/sleep 30;; esac`,
      `exec '${gitProgram()}' "$@"`,
    ]);
    // Where the look makes the throwaway clone it asks git about.
    const { app, page } = await launch({ LO_GIT: program, TMPDIR: tmp });
    const throwaway = () => readdirSync(tmp).filter((name) => name.startsWith('lo-git-'));
    let pids: number[] = [];
    try {
      await expect.poll(() => existsSync(join(runs, 'started')), { timeout: 15_000 }).toBe(true);
      expect(await gitInfo(page)).toEqual({ status: 'checking' });
      expect(throwaway()).toHaveLength(clones);
      pids = readFileSync(join(runs, 'pids'), 'utf8').trim().split('\n').map(Number);

      const began = Date.now();
      await app.close();

      // Well within the half minute the git would take, and the most quitting waits for git.
      expect(Date.now() - began).toBeLessThan(4000);
      expect(pids.filter((pid) => !groupGone(pid))).toEqual([]);
      expect(throwaway()).toEqual([]);
    } finally {
      await app.close();
      for (const pid of pids) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Gone already.
        }
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

test('with no git, the window opens and says so, and Lo keeps no cache', async () => {
  const { app, page } = await launch({ LO_GIT: 'none' });
  try {
    expect(await gitFound(page)).toEqual({
      status: 'missing',
      message: "Lo can't find git.",
      install: expect.stringContaining('git'),
    });
    expect(existsSync(join(dataFolder(), 'cache'))).toBe(false);
  } finally {
    await app.close();
  }
});

test('with a git too old, the window opens and says why, and Lo keeps no cache', async () => {
  const old = script(test.info().outputPath('git', 'git'), ["echo 'git version 2.30.0'"]);
  const { app, page } = await launch({ LO_GIT: old });
  try {
    expect(await gitFound(page)).toEqual({
      status: 'tooOld',
      version: '2.30.0',
      check: 'version',
      message: `Lo needs git 2.41.0 or newer, and ${old} is git 2.30.0.`,
      install: expect.stringContaining('git'),
    });
    expect(existsSync(join(dataFolder(), 'cache'))).toBe(false);
  } finally {
    await app.close();
  }
});
