// Opening a file as text: the program and arguments on each system, the app for text on Linux,
// and how programs run, each with an argument list and no shell.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applicationFolders,
  desktopPaths,
  launch,
  query,
  textApp,
  textEditorCommand,
  type Linux,
  type Query,
} from './editor.ts';

let folder: string;
/** What `xdg-mime` says when asked which app opens text. */
let asked: ReturnType<typeof vi.fn<Query>>;
/** Linux, as the tests set it up: its apps in `folder/share`, and an app for text. */
let linux: Linux;
/** The desktop file of Linux's app for text. */
let textEditor: string;

beforeEach(() => {
  // Resolved, as the system's temporary folder is a link on a Mac.
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-editor-')));
  mkdirSync(join(folder, 'share', 'applications'), { recursive: true });
  textEditor = join(folder, 'share', 'applications', 'org.example.Editor.desktop');
  writeFileSync(textEditor, '[Desktop Entry]\nExec=editor %F\n');
  asked = vi.fn<Query>(async () => 'org.example.Editor.desktop\n');
  linux = {
    query: asked,
    env: { XDG_DATA_HOME: join(folder, 'share'), XDG_DATA_DIRS: join(folder, 'system') },
    home: folder,
  };
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('textEditorCommand', () => {
  it('is open -t on a Mac, the app for text by gio on Linux, and nothing elsewhere', async () => {
    expect(await textEditorCommand('darwin', '/a/keymap', { linux })).toEqual({
      command: '/usr/bin/open',
      args: ['-t', '/a/keymap'],
    });
    expect(await textEditorCommand('linux', '/a/keymap', { linux })).toEqual({
      command: 'gio',
      args: ['launch', textEditor, '/a/keymap'],
    });
    expect(await textEditorCommand('win32', '/a/keymap', { linux })).toBeUndefined();
    expect(await textEditorCommand('freebsd', '/a/keymap', { linux })).toBeUndefined();
  });

  it('is the program a test names, with the path alone', async () => {
    expect(await textEditorCommand('linux', '/a/keymap', { linux, editor: '/t/editor' })).toEqual({
      command: '/t/editor',
      args: ['/a/keymap'],
    });
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('the app for text on Linux', () => {
  it('is looked for in the folders apps are listed in, the person’s own first', async () => {
    expect(applicationFolders({}, '/home/tess')).toEqual([
      '/home/tess/.local/share/applications',
      '/usr/local/share/applications',
      '/usr/share/applications',
    ]);
    expect(
      applicationFolders(
        { XDG_DATA_HOME: '/data', XDG_DATA_DIRS: '/a:relative:/b/:' },
        '/home/tess',
      ),
    ).toEqual(['/data/applications', '/a/applications', '/b/applications']);
    // A relative XDG_DATA_HOME is ignored, as the spec says.
    expect(applicationFolders({ XDG_DATA_HOME: 'data' }, '/home/tess')[0]).toBe(
      '/home/tess/.local/share/applications',
    );
    // The person's own copy wins over the system's.
    mkdirSync(join(folder, 'system', 'applications'), { recursive: true });
    const system = join(folder, 'system', 'applications', 'org.example.Editor.desktop');
    writeFileSync(system, '[Desktop Entry]\n');
    expect(await textApp(linux)).toBe(textEditor);
    rmSync(textEditor);
    expect(await textApp(linux)).toBe(system);
  });

  it('is found in a folder its ID names with a dash', async () => {
    expect(desktopPaths('kde4-kate.desktop')).toEqual(['kde4-kate.desktop', 'kde4/kate.desktop']);
    expect(desktopPaths('a-b-c.desktop')).toEqual([
      'a-b-c.desktop',
      'a-b/c.desktop',
      'a/b-c.desktop',
      'a/b/c.desktop',
    ]);
    // Never out of the folder of apps, nor in a folder with no name.
    const outside = ['a-..-..-x.desktop', 'a--x.desktop', 'a-.-x.desktop'].flatMap((id) =>
      desktopPaths(id).filter((reading) =>
        reading.split('/').some((name) => name === '' || name === '.' || name === '..'),
      ),
    );
    expect(outside).toEqual([]);
    mkdirSync(join(folder, 'share', 'applications', 'kde4'));
    writeFileSync(join(folder, 'share', 'applications', 'kde4', 'kate.desktop'), '');
    asked.mockResolvedValueOnce('kde4-kate.desktop\n');
    expect(await textApp(linux)).toBe(
      join(folder, 'share', 'applications', 'kde4', 'kate.desktop'),
    );
  });

  it('is the first app xdg-mime names', async () => {
    asked.mockResolvedValueOnce('org.example.Editor.desktop;org.example.Other.desktop\n');
    expect(await textApp(linux)).toBe(textEditor);
  });
});

describe('query', () => {
  it('gives what the program printed, and rejects when it fails or isn’t there', async () => {
    await expect(query(process.execPath, ['-e', 'process.stdout.write("hi")'])).resolves.toBe('hi');
    await expect(query(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow(
      `${process.execPath} failed`,
    );
    await expect(query(join(folder, 'no-such-program'), [])).rejects.toThrow('ENOENT');
  });

  it('gives each argument as it is, to a program and never to a shell', async () => {
    const argument = 'x; echo pwned $(echo pwned) `echo pwned`';
    await expect(
      query(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', argument]),
    ).resolves.toBe(argument);
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
