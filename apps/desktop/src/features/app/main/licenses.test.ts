import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Launch, Linux, Query } from '../../../main/editor.ts';
import { licensesPath, openLicenses } from './licenses.ts';

let folder: string;
let path: string;
let started: ReturnType<typeof vi.fn<Launch>>;
let asked: ReturnType<typeof vi.fn<Query>>;
let linux: Linux;
/** The desktop file of Linux's app for text. */
let textEditor: string;

beforeEach(() => {
  // Resolved, as the system's temporary folder is a link on a Mac.
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-licenses-')));
  path = join(folder, 'licenses.txt');
  writeFileSync(path, 'Lo\n==\n');
  started = vi.fn<Launch>(async () => undefined);
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

describe('licensesPath', () => {
  it("is in the app's resources once packaged, outside the asar, and in the build's output otherwise", () => {
    expect(
      licensesPath({
        packaged: true,
        resources: '/Applications/Lo.app/Contents/Resources',
        app: '/x',
      }),
    ).toBe('/Applications/Lo.app/Contents/Resources/licenses.txt');
    expect(
      licensesPath({
        packaged: false,
        resources: '/electron/resources',
        app: '/repo/apps/desktop',
      }),
    ).toBe('/repo/apps/desktop/dist/licenses.txt');
  });
});

describe('opening the licenses file', () => {
  it('opens it as text: open -t on a Mac, the app for text on Linux, with the path as an argument', async () => {
    expect(await openLicenses(path, { platform: 'darwin', launch: started, linux })).toEqual({
      ok: true,
    });
    expect(started).toHaveBeenLastCalledWith('/usr/bin/open', ['-t', path]);
    expect(await openLicenses(path, { platform: 'linux', launch: started, linux })).toEqual({
      ok: true,
    });
    expect(asked).toHaveBeenCalledWith('xdg-mime', ['query', 'default', 'text/plain']);
    expect(started).toHaveBeenLastCalledWith('gio', ['launch', textEditor, path]);
  });

  it('opens it with the program a test names, in a build run from source', async () => {
    const editor = '/tmp/lo-editor';
    await openLicenses(path, { platform: 'darwin', launch: started, linux, editor });
    expect(started).toHaveBeenCalledWith(editor, [path]);
  });

  it('opens nothing when the file is not there, or is not a file', async () => {
    const reason = { ok: false, reason: "Lo couldn't find its licenses file." };
    expect(
      await openLicenses(join(folder, 'missing.txt'), {
        platform: 'darwin',
        launch: started,
        linux,
      }),
    ).toEqual(reason);
    expect(await openLicenses(folder, { platform: 'darwin', launch: started, linux })).toEqual(
      reason,
    );
    expect(started).not.toHaveBeenCalled();
  });

  it('opens nothing where Lo has no way to open a file as text, and says so', async () => {
    expect(await openLicenses(path, { platform: 'win32', launch: started, linux })).toEqual({
      ok: false,
      reason: "Lo can't open the licenses file on this system.",
    });
    asked.mockRejectedValueOnce(new Error('spawn xdg-mime ENOENT'));
    expect(await openLicenses(path, { platform: 'linux', launch: started, linux })).toEqual({
      ok: false,
      reason:
        "Lo couldn't find the app for text files (`xdg-mime query default text/plain`), so it didn't open the licenses file.",
    });
    expect(started).not.toHaveBeenCalled();
  });

  it("says so when the system's opener fails, without its own words", async () => {
    started.mockRejectedValueOnce(new Error('spawn /usr/bin/open ENOENT at /Users/me'));
    expect(await openLicenses(path, { platform: 'darwin', launch: started, linux })).toEqual({
      ok: false,
      reason: "Lo couldn't open the licenses file in a text editor.",
    });
  });
});
