import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keymapHeader } from './keymap.ts';
import { launch, openKeymapFile, textEditorCommand, type Launch } from './open.ts';

let folder: string;
let path: string;
let started: ReturnType<typeof vi.fn<Launch>>;

beforeEach(() => {
  // Resolved, as the system's temporary folder is a link on a Mac.
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'kk-open-')));
  path = join(folder, 'config', 'keymap');
  mkdirSync(join(folder, 'config'));
  started = vi.fn<Launch>(async () => undefined);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** Opens the keymap file on a Mac, with a launcher that starts nothing. */
const open = (platform: NodeJS.Platform = 'darwin') =>
  openKeymapFile(path, { platform, launch: started });

/** Why opening the keymap file was refused on each system: a reason, or none if it opened. */
async function refusals(): Promise<(string | undefined)[]> {
  const reasons: (string | undefined)[] = [];
  for (const platform of ['darwin', 'linux'] as const) {
    const result = await open(platform);
    reasons.push(result.ok ? undefined : result.reason);
  }
  return reasons;
}

/** What `refusals` gives when both systems refuse for a reason that matches `reason`. */
const bothRefuse = (reason: RegExp) => [
  expect.stringMatching(reason),
  expect.stringMatching(reason),
];

describe('opening the keymap file', () => {
  it('opens a plain file as text: open -t on a Mac, xdg-open on Linux, with the path as an argument', async () => {
    writeFileSync(path, 'bind x diff.markViewed\n');
    expect(await open('darwin')).toEqual({ ok: true });
    expect(started).toHaveBeenLastCalledWith('/usr/bin/open', ['-t', path]);
    expect(await open('linux')).toEqual({ ok: true });
    expect(started).toHaveBeenLastCalledWith('xdg-open', [path]);
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('follows a dotfile link, and opens what it leads to', async () => {
    mkdirSync(join(folder, 'dotfiles'));
    const target = join(folder, 'dotfiles', 'lo-keymap');
    writeFileSync(target, 'bind x diff.markViewed\n');
    symlinkSync(target, path);
    expect(await open()).toEqual({ ok: true });
    expect(started).toHaveBeenCalledWith('/usr/bin/open', ['-t', target]);
  });

  it('writes the file with its header first when there is none, then opens it', async () => {
    expect(await open()).toEqual({ ok: true });
    expect(readFileSync(path, 'utf8')).toBe(keymapHeader);
    expect(started).toHaveBeenCalledWith('/usr/bin/open', ['-t', path]);
  });

  it('opens a file whose name and folder look like arguments or like markup, as one argument', async () => {
    const odd = join(folder, 'a b;c $(x) -rf', 'keymap');
    mkdirSync(join(folder, 'a b;c $(x) -rf'));
    writeFileSync(odd, '');
    expect(await openKeymapFile(odd, { platform: 'darwin', launch: started })).toEqual({
      ok: true,
    });
    expect(started).toHaveBeenCalledWith('/usr/bin/open', ['-t', odd]);
  });

  it('opens a file with the program a test names, in a build run from source', async () => {
    writeFileSync(path, '');
    const editor = '/tmp/kk-editor';
    await openKeymapFile(path, { platform: 'darwin', launch: started, editor });
    expect(started).toHaveBeenCalledWith(editor, [path]);
  });

  it('refuses a file with its executable bit set, which opening could run', async () => {
    for (const mode of [0o755, 0o744, 0o700, 0o710, 0o701, 0o777]) {
      writeFileSync(path, '#!/bin/sh\necho hi\n');
      chmodSync(path, mode);
      expect(await refusals()).toEqual(bothRefuse(/executable, so Lo won't open it/));
      expect(started).not.toHaveBeenCalled();
    }
    // It is left as it was.
    expect(readFileSync(path, 'utf8')).toBe('#!/bin/sh\necho hi\n');
  });

  it('refuses a file that is executable at the end of a link', async () => {
    mkdirSync(join(folder, 'dotfiles'));
    const target = join(folder, 'dotfiles', 'keymap');
    writeFileSync(target, '# synced from another machine\n');
    chmodSync(target, 0o755);
    symlinkSync(target, path);
    expect(await refusals()).toEqual(bothRefuse(/executable/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a link to an app, which would launch it', async () => {
    const app = join(folder, 'Applications', 'Calculator.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    writeFileSync(join(app, 'Contents', 'MacOS', 'Calculator'), '#!/bin/sh\n');
    chmodSync(join(app, 'Contents', 'MacOS', 'Calculator'), 0o755);
    symlinkSync(app, path);
    expect(await refusals()).toEqual(bothRefuse(/isn't a plain file/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a link to a file inside an app that is a script, and one to a link of an app', async () => {
    const app = join(folder, 'Calculator.app');
    mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
    const script = join(app, 'Contents', 'MacOS', 'Calculator');
    writeFileSync(script, '#!/bin/sh\n');
    chmodSync(script, 0o755);
    symlinkSync(script, path);
    expect(await refusals()).toEqual(bothRefuse(/executable/));
    expect(started).not.toHaveBeenCalled();
    rmSync(path);
    symlinkSync(app, join(folder, 'first'));
    symlinkSync(join(folder, 'first'), path);
    expect(await refusals()).toEqual(bothRefuse(/isn't a plain file/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a folder', async () => {
    mkdirSync(path);
    expect(await refusals()).toEqual(bothRefuse(/isn't a plain file/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a named pipe, without waiting for anyone to write to it', async () => {
    execFileSync('mkfifo', [path]);
    expect(await refusals()).toEqual(bothRefuse(/isn't a plain file/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a huge file', async () => {
    writeFileSync(path, '');
    truncateSync(path, 64 * 1024 * 1024);
    expect(await refusals()).toEqual(bothRefuse(/over 1 MiB/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a binary file', async () => {
    writeFileSync(path, Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02]));
    expect(await refusals()).toEqual(bothRefuse(/isn't text/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses a link to nothing, and writes nothing through it', async () => {
    symlinkSync(join(folder, 'missing'), path);
    expect(await refusals()).toEqual(bothRefuse(/link to a file that isn't there/));
    expect(started).not.toHaveBeenCalled();
    expect(existsSync(join(folder, 'missing'))).toBe(false);
  });

  it('refuses a link that leads in a circle', async () => {
    symlinkSync(path, path);
    expect(await refusals()).toEqual(bothRefuse(/ELOOP/));
    expect(started).not.toHaveBeenCalled();
  });

  it('refuses where Lo has no way to open a file as text', async () => {
    writeFileSync(path, '');
    expect(await open('win32')).toEqual({
      ok: false,
      reason: "Lo can't open the keymap file on this system.",
    });
    expect(started).not.toHaveBeenCalled();
  });

  it('says so when the system’s opener fails, without its own words', async () => {
    writeFileSync(path, '');
    started.mockRejectedValueOnce(new Error('spawn /usr/bin/open ENOENT at /Users/me'));
    expect(await open()).toEqual({
      ok: false,
      reason: "Lo couldn't open the keymap file in a text editor.",
    });
  });

  it('says so when the file or its folder can’t be made', async () => {
    writeFileSync(join(folder, 'config', 'file'), '');
    expect(
      await openKeymapFile(join(folder, 'config', 'file', 'keymap'), {
        platform: 'darwin',
        launch: started,
      }),
    ).toEqual({ ok: false, reason: "Lo couldn't create the keymap file." });
    expect(started).not.toHaveBeenCalled();
  });
});

describe('textEditorCommand', () => {
  it('is open -t on a Mac, xdg-open on Linux, and nothing elsewhere', () => {
    expect(textEditorCommand('darwin', '/a/keymap')).toEqual({
      command: '/usr/bin/open',
      args: ['-t', '/a/keymap'],
    });
    expect(textEditorCommand('linux', '/a/keymap')).toEqual({
      command: 'xdg-open',
      args: ['/a/keymap'],
    });
    expect(textEditorCommand('win32', '/a/keymap')).toBeUndefined();
    expect(textEditorCommand('freebsd', '/a/keymap')).toBeUndefined();
  });

  it('is the program a test names, with the path alone', () => {
    expect(textEditorCommand('linux', '/a/keymap', '/t/editor')).toEqual({
      command: '/t/editor',
      args: ['/a/keymap'],
    });
  });
});

describe('launch', () => {
  it('resolves when the program exits with 0, and rejects when it fails or isn’t there', async () => {
    await expect(launch(process.execPath, ['-e', ''])).resolves.toBeUndefined();
    await expect(launch(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow(
      'exited with 3',
    );
    await expect(launch(join(folder, 'no-such-program'), [])).rejects.toThrow('ENOENT');
  });

  it('gives each argument as it is, to a program and never to a shell', async () => {
    const marker = join(folder, 'pwned');
    // Exits 0 only if the argument arrives whole, `;`, `$()` and spaces included.
    const argument = `x; touch ${marker}; $(touch ${marker}) \`touch ${marker}\``;
    await expect(
      launch(process.execPath, [
        '-e',
        `process.exit(process.argv[1] === ${JSON.stringify(argument)} ? 0 : 1)`,
        argument,
      ]),
    ).resolves.toBeUndefined();
    expect(() => readFileSync(marker)).toThrow('ENOENT');
  });
});
