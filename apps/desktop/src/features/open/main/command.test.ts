import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import {
  BUNDLE_ID,
  commandScript,
  findCommand,
  installCommand,
  isOurs,
  MARK,
  shellQuote,
  type Elevated,
} from './command.ts';

/** A new folder, removed when the test ends. */
function folder(): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'lo-command-test-')));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/**
 * A program standing in for what the command starts: it writes each argument it gets, ended by a
 * NUL, to `got` beside it, so a test sees exactly the arguments, whatever they hold.
 */
function stub(at: string): { program: string; got: () => string[] | undefined } {
  const program = join(at, 'stub');
  const got = join(at, 'got');
  writeFileSync(program, `#!/bin/sh\nprintf '%s\\0' "$@" > ${shellQuote(got)}\n`);
  chmodSync(program, 0o755);
  return {
    program,
    got: () => (existsSync(got) ? readFileSync(got, 'utf8').split('\0').slice(0, -1) : undefined),
  };
}

/** Runs the script at `path` with `args`, as a shell would, and says how it ended. */
function run(
  path: string,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      '/bin/sh',
      [path, ...args],
      { cwd, env: { PATH: '/usr/bin:/bin' } },
      (error, _out, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stderr });
      },
    );
  });
}

/** Writes `script` as a program in `at`. */
function install(at: string, script: string): string {
  const path = join(at, 'lo');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

const E2E_LINK = 'https://github.com/rozed-dev/e2e/pull/78';

/** Links, each with what a shell or Lo might read as more than one. */
const HOSTILE = [
  'https://github.com/withlo/lo/pull/1',
  'lo://github.com/withlo/lo/pull/1',
  'HTTP://github.com/withlo/lo/pull/1',
  'https://github.com/withlo/lo/pull/1 --remote-debugging-port=9222',
  "https://github.com/it's/a/'quoted'/\"link\"",
  'https://$(touch pwned)',
  'https://`touch pwned`; touch pwned',
  'https://a\nb\n--inspect',
  'https://"$@" $1 \\ * ?',
];

/** Arguments that aren't links: options, even after whitespace, which Chromium trims, and the rest. */
const REFUSED = [
  '-n',
  '--args',
  '--remote-debugging-port=9222',
  '-',
  ' --ssl-key-log-file=/tmp/keys.log',
  '\t--log-net-log=/tmp/net.json',
  '\n--remote-debugging-port=9222',
  '\r--ignore-certificate-errors',
  ' https://github.com/withlo/lo/pull/1',
  'rozed-dev/e2e#78',
  'file:///etc/passwd',
  '$(touch pwned)',
  '',
];

describe('the lo command on macOS', () => {
  it.each(HOSTILE)(
    'hands %j to open as one argument, after --args, and runs nothing else',
    async (argument) => {
      const at = folder();
      const open = stub(at);
      const path = install(
        at,
        commandScript({ kind: 'bundle', bundleId: BUNDLE_ID, open: open.program }),
      );
      expect(await run(path, [argument], at)).toEqual({ code: 0, stderr: '' });
      expect(open.got()).toEqual(['-n', '-b', BUNDLE_ID, '--args', argument]);
      expect(existsSync(join(at, 'pwned'))).toBe(false);
    },
  );

  it.each(REFUSED)('refuses %j, which isn’t a link, and runs nothing', async (argument) => {
    const at = folder();
    const open = stub(at);
    const path = install(
      at,
      commandScript({ kind: 'bundle', bundleId: BUNDLE_ID, open: open.program }),
    );
    const { code, stderr } = await run(path, [argument], at);
    expect(code).toBe(2);
    expect(stderr).toContain('give it a link to a pull request');
    expect(existsSync(join(at, 'pwned'))).toBe(false);
    expect(open.got()).toBeUndefined();
  });

  it('takes exactly one argument', async () => {
    const at = folder();
    const open = stub(at);
    const path = install(
      at,
      commandScript({ kind: 'bundle', bundleId: BUNDLE_ID, open: open.program }),
    );
    for (const args of [[], ['https://github.com/a/b/pull/1', 'https://github.com/a/b/pull/2']]) {
      const { code, stderr } = await run(path, args, at);
      expect(code).toBe(2);
      expect(stderr).toContain('usage: lo <link to a pull request>');
    }
    expect(open.got()).toBeUndefined();
  });

  it('starts the app by the bundle ID electron-builder gives it', () => {
    const config = readFileSync(
      new URL('../../../../build/electron-builder.yml', import.meta.url),
      'utf8',
    );
    expect(config).toMatch(new RegExp(`^appId: ${BUNDLE_ID.replaceAll('.', '\\.')}$`, 'm'));
    expect(commandScript({ kind: 'bundle', bundleId: BUNDLE_ID })).toContain(
      `exec '/usr/bin/open' -n -b '${BUNDLE_ID}' --args "$1"`,
    );
  });
});

describe('the lo command that runs Lo’s program', () => {
  it.each(HOSTILE)('hands %j to the program as one argument after its own', async (argument) => {
    const at = folder();
    const program = stub(at);
    const own = join(at, "Lo's app folder, with spaces");
    const path = install(
      at,
      commandScript({ kind: 'program', program: program.program, args: [own] }),
    );
    expect(await run(path, [argument], at)).toEqual({ code: 0, stderr: '' });
    expect(program.got()).toEqual([own, argument]);
    expect(existsSync(join(at, 'pwned'))).toBe(false);
  });

  it('starts the program with the variables it’s given, quoted as the rest is', async () => {
    const at = folder();
    const program = join(at, 'program');
    const seen = join(at, 'seen');
    writeFileSync(
      program,
      `#!/bin/sh\nprintf '%s|%s' "$LO_USER_DATA_DIR" "$1" > ${shellQuote(seen)}\n`,
    );
    chmodSync(program, 0o755);
    const data = join(at, "Lo's data $(touch pwned)");
    const path = install(
      at,
      commandScript({ kind: 'program', program, args: [], env: { LO_USER_DATA_DIR: data } }),
    );
    expect(await run(path, [E2E_LINK], at)).toEqual({ code: 0, stderr: '' });
    expect(readFileSync(seen, 'utf8')).toBe(`${data}|${E2E_LINK}`);
    expect(existsSync(join(at, 'pwned'))).toBe(false);
    expect(() =>
      commandScript({ kind: 'program', program, args: [], env: { 'A=B; touch x #': 'y' } }),
    ).toThrow("Not a variable's name");
  });

  it('refuses an argument that isn’t a link', async () => {
    const at = folder();
    const program = stub(at);
    const path = install(
      at,
      commandScript({ kind: 'program', program: program.program, args: [] }),
    );
    for (const argument of ['--no-sandbox', ' --no-sandbox', 'x.txt']) {
      expect((await run(path, [argument], at)).code).toBe(2);
    }
    expect(program.got()).toBeUndefined();
  });
});

describe('installing the lo command', () => {
  const script = commandScript({ kind: 'bundle', bundleId: BUNDLE_ID });

  it('writes it in the system’s folder when Lo may, as a program', async () => {
    const at = folder();
    const folders = { system: join(at, 'system'), user: join(at, 'user') };
    mkdirSync(folders.system);
    const done = await installCommand({ folders, script });
    expect(done).toEqual({ kind: 'installed', path: join(folders.system, 'lo'), onPath: true });
    expect(readFileSync(join(folders.system, 'lo'), 'utf8')).toBe(script);
    expect(statSync(join(folders.system, 'lo')).mode & 0o777).toBe(0o755);
    expect(existsSync(folders.user)).toBe(false);
    expect(await findCommand(folders, script)).toEqual({
      installed: [{ path: join(folders.system, 'lo'), current: true }],
    });
  });

  it('asks for an administrator when Lo can’t write the system’s folder, with the script in a file of its own', async () => {
    const at = folder();
    const folders = { system: join(at, 'system'), user: join(at, 'user') };
    const asked: string[] = [];
    const done = await installCommand({
      folders,
      script,
      elevate(from, to): Promise<Elevated> {
        asked.push(to);
        expect(readFileSync(from, 'utf8')).toBe(script);
        mkdirSync(folders.system);
        writeFileSync(to, readFileSync(from));
        return Promise.resolve({ kind: 'done' });
      },
    });
    expect(asked).toEqual([join(folders.system, 'lo')]);
    expect(done).toEqual({ kind: 'installed', path: join(folders.system, 'lo'), onPath: true });
  });

  it('writes it in the person’s own folder when they won’t give an administrator’s password', async () => {
    const at = folder();
    const folders = { system: join(at, 'system'), user: join(at, 'home', '.local', 'bin') };
    for (const answer of [{ kind: 'declined' }, { kind: 'failed', message: 'no' }] as const) {
      const done = await installCommand({
        folders,
        script,
        elevate: () => Promise.resolve(answer),
        path: `/usr/bin:${folders.user}`,
      });
      expect(done).toEqual({ kind: 'installed', path: join(folders.user, 'lo'), onPath: true });
    }
    expect(statSync(join(folders.user, 'lo')).mode & 0o777).toBe(0o755);
    expect(existsSync(folders.system)).toBe(false);
    // Whether the shell finds it there is up to its PATH.
    const elsewhere = await installCommand({
      folders: { user: folders.user },
      script,
      path: '/usr/bin',
    });
    expect(elsewhere).toEqual({ kind: 'installed', path: join(folders.user, 'lo'), onPath: false });
  });

  it('never replaces a lo Lo didn’t write', async () => {
    const at = folder();
    const folders = { system: join(at, 'system'), user: join(at, 'user') };
    mkdirSync(folders.system);
    writeFileSync(join(folders.system, 'lo'), '#!/bin/sh\necho another lo\n');
    expect(await installCommand({ folders, script })).toEqual({
      kind: 'taken',
      path: join(folders.system, 'lo'),
    });
    expect(readFileSync(join(folders.system, 'lo'), 'utf8')).toContain('another lo');
    expect(await findCommand(folders, script)).toEqual({ installed: [] });
  });

  it('knows its own, and whether it’s this Lo’s', async () => {
    const at = folder();
    const folders = { user: join(at, 'user') };
    expect(isOurs(script)).toBe(true);
    expect(script.split('\n')[1]).toBe(MARK);
    await installCommand({
      folders,
      script: commandScript({ kind: 'bundle', bundleId: 'old.id' }),
    });
    expect(await findCommand(folders, script)).toEqual({
      installed: [{ path: join(folders.user, 'lo'), current: false }],
    });
  });
});
