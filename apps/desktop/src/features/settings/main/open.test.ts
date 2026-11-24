// Opening the settings file: as text, by its real path, and only a plain file within the limit
// that can't run.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Launch, Linux } from '../../../main/editor.ts';
import { openSettingsFile } from './open.ts';

let folder: string;
let path: string;
let started: ReturnType<typeof vi.fn<Launch>>;
/** Linux with no app for text, which these tests don't reach. */
const linux: Linux = { query: () => Promise.reject(new Error('none')), env: {}, home: '/' };

beforeEach(() => {
  // Resolved, as the system's temporary folder is a link on a Mac.
  folder = realpathSync(mkdtempSync(join(tmpdir(), 'lo-settings-open-')));
  path = join(folder, 'config', 'settings.json');
  mkdirSync(join(folder, 'config'));
  started = vi.fn<Launch>(async () => undefined);
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const open = () => openSettingsFile(path, { platform: 'darwin', launch: started, linux });

describe('opening the settings file', () => {
  it('opens it as text by where it really is, whatever it holds', async () => {
    writeFileSync(join(folder, 'dotfiles.json'), '{ "theme": ');
    symlinkSync(join(folder, 'dotfiles.json'), path);
    expect(await open()).toEqual({ ok: true });
    expect(started).toHaveBeenCalledWith('/usr/bin/open', ['-t', join(folder, 'dotfiles.json')]);
  });

  it('opens it with the program a test names, in a build run from source', async () => {
    writeFileSync(path, '{}');
    await openSettingsFile(path, { platform: 'darwin', launch: started, linux, editor: '/t/ed' });
    expect(started).toHaveBeenCalledWith('/t/ed', [path]);
  });

  it('refuses, starting nothing, a file that isn’t there, isn’t plain, is too big or can run', async () => {
    expect(await open()).toEqual({ ok: false, reason: 'There’s no settings file yet.' });
    mkdirSync(path);
    expect(await open()).toMatchObject({ ok: false, reason: expect.stringMatching(/plain file/) });
    rmSync(path, { recursive: true });
    writeFileSync(path, 'x'.repeat(1024 * 1024 + 1));
    expect(await open()).toEqual({ ok: false, reason: 'settings.json is over 1 MB' });
    writeFileSync(path, '{}');
    chmodSync(path, 0o755);
    expect(await open()).toMatchObject({ ok: false, reason: expect.stringMatching(/executable/) });
    expect(started).not.toHaveBeenCalled();
  });

  it('says so when the system’s opener fails, or there’s none', async () => {
    writeFileSync(path, '{}');
    started.mockRejectedValueOnce(new Error('open failed'));
    expect(await open()).toEqual({
      ok: false,
      reason: 'Lo couldn’t open the settings file in a text editor.',
    });
    expect(await openSettingsFile(path, { platform: 'win32', launch: started, linux })).toEqual({
      ok: false,
      reason: 'Lo can’t open the settings file on this system.',
    });
  });
});
