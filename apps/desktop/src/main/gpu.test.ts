import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SETTINGS_SIZE_LIMIT } from '../features/settings/main/file.ts';
import { hardwareAcceleration, settingsText } from './gpu.ts';

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'lo-gpu-'));
  path = join(folder, 'settings.json');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe('hardwareAcceleration', () => {
  it('is on without a file, and as the file says', () => {
    expect(hardwareAcceleration(undefined)).toBe(true);
    expect(hardwareAcceleration('')).toBe(true);
    expect(hardwareAcceleration('{ "theme": "dark" }')).toBe(true);
    expect(hardwareAcceleration('{ "app.gpu": false }')).toBe(false);
    expect(hardwareAcceleration('{ "app.gpu": true }')).toBe(true);
  });

  it('reads the file as the settings feature does: comments, trailing commas, a byte order mark', () => {
    expect(hardwareAcceleration('﻿// Mine.\n{\n  "app.gpu": false, // Blank otherwise.\n}\n')).toBe(
      false,
    );
    // A key given twice is read as the last one says.
    expect(hardwareAcceleration('{ "app.gpu": true, "app.gpu": false }')).toBe(false);
  });

  it('is on when the value isn’t true or false, or the file has a problem', () => {
    for (const text of [
      '{ "app.gpu": "false" }',
      '{ "app.gpu": 0 }',
      '{ "app.gpu": null }',
      '{ "app": { "gpu": false } }',
      '{ "app.gpu": false',
      '[{ "app.gpu": false }]',
      '"app.gpu"',
      `{ "app.gpu": false, "deep": ${'['.repeat(10_000)}${']'.repeat(10_000)} }`,
    ]) {
      expect({ text, on: hardwareAcceleration(text) }).toEqual({ text, on: true });
    }
    // Nothing from an object's prototype counts.
    expect(hardwareAcceleration('{ "__proto__": { "app.gpu": false } }')).toBe(true);
  });
});

describe('settingsText', () => {
  it('reads the file, following a link, and nothing where there’s none', () => {
    expect(settingsText(path)).toBeUndefined();
    expect(settingsText(join(folder, 'none', 'settings.json'))).toBeUndefined();
    writeFileSync(path, '{ "app.gpu": false }\n');
    expect(settingsText(path)).toBe('{ "app.gpu": false }\n');
    const link = join(folder, 'link.json');
    symlinkSync(path, link);
    expect(settingsText(link)).toBe('{ "app.gpu": false }\n');
  });

  it('reads a file of exactly the limit, and leaves one a byte over unread', () => {
    writeFileSync(path, `{${' '.repeat(SETTINGS_SIZE_LIMIT - 2)}}`);
    expect(settingsText(path)?.length).toBe(SETTINGS_SIZE_LIMIT);
    writeFileSync(path, `{${' '.repeat(SETTINGS_SIZE_LIMIT - 1)}}`);
    expect(settingsText(path)).toBeUndefined();
  });

  it('leaves a folder, a pipe and a file that isn’t text unread, without waiting on any', () => {
    mkdirSync(path);
    expect(settingsText(path)).toBeUndefined();
    rmSync(path, { recursive: true });
    // Opening a pipe for reading would otherwise wait for a writer for ever.
    execFileSync('mkfifo', [path]);
    expect(settingsText(path)).toBeUndefined();
    rmSync(path);
    writeFileSync(path, Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]));
    expect(settingsText(path)).toBeUndefined();
  });
});
