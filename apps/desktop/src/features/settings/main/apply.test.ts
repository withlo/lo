import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GB } from '../settings.ts';
import { applySettings, type Appearance } from './apply.ts';
import { createSettings, type Settings } from './store.ts';

let folder: string;
let path: string;
const stops: (() => Promise<void>)[] = [];

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'st-apply-'));
  path = join(folder, 'config', 'settings.json');
});

afterEach(() => {
  for (const stop of stops.splice(0)) void stop();
  rmSync(folder, { recursive: true, force: true });
});

function write(text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

function open(): Settings {
  const settings = createSettings({
    path,
    shown: path,
    changed: () => undefined,
    log: () => undefined,
    interval: 3_600_000,
  });
  stops.push(() => settings.stop());
  return settings;
}

/** What `applySettings` is given, and what it did to it. */
function applied(settings: Settings) {
  const appearance: Appearance = { themeSource: 'system' };
  const caps: number[] = [];
  const log = vi.fn<(message: string, error: unknown) => void>();
  const stop = applySettings(settings, {
    appearance,
    git: {
      setCap: (bytes) => {
        caps.push(bytes);
        return Promise.resolve();
      },
    },
    log,
  });
  return { appearance, caps, log, stop };
}

/** A change to the file seen, held still for a poll, and read. */
async function settle(settings: Settings): Promise<void> {
  await settings.check();
  await settings.check();
}

describe('applySettings', () => {
  it('applies what the file says once it has been read, and the defaults when it says nothing', async () => {
    write('{ "theme": "light", "cache.cap": 25 }');
    const settings = open();
    const { appearance, caps } = applied(settings);
    // Nothing is applied at a default before the file has been read.
    expect(caps).toEqual([]);
    await settings.state();
    expect(appearance.themeSource).toBe('light');
    expect(caps).toEqual([25 * GB]);
  });

  it('starts at the theme following the system and the cache at its own cap with no file', async () => {
    const settings = open();
    const { appearance, caps } = applied(settings);
    await settings.state();
    expect(appearance.themeSource).toBe('system');
    expect(caps).toEqual([10 * GB]);
  });

  it('applies a change to the file as it is made, by hand or from Settings', async () => {
    write('{ "theme": "dark" }');
    const settings = open();
    const { appearance, caps } = applied(settings);
    await settings.state();
    write('{ "theme": "light", "cache.cap": 5 }');
    await settle(settings);
    expect(appearance.themeSource).toBe('light');
    expect(caps).toEqual([10 * GB, 5 * GB]);
    await settings.set('theme', 'system');
    await settings.set('cache.cap', 7);
    expect(appearance.themeSource).toBe('system');
    expect(caps.at(-1)).toBe(7 * GB);
  });

  it('goes back to the default for a value that is wrong, and does not set the cap again for it', async () => {
    write('{ "theme": "dark", "cache.cap": 5 }');
    const settings = open();
    const { appearance, caps } = applied(settings);
    await settings.state();
    write('{ "theme": "purple", "cache.cap": 5 }');
    await settle(settings);
    expect(appearance.themeSource).toBe('system');
    expect(caps).toEqual([5 * GB]);
  });

  it('logs a cap the cache refuses, and goes on', async () => {
    const settings = open();
    const log = vi.fn<(message: string, error: unknown) => void>();
    const failure = new RangeError('The cache cap must be over 0.');
    applySettings(settings, {
      appearance: { themeSource: 'system' },
      git: { setCap: () => Promise.reject(failure) },
      log,
    });
    await settings.state();
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith("Lo couldn't set the cache's cap:", failure),
    );
  });

  it('stops applying when told to', async () => {
    write('{ "theme": "dark" }');
    const settings = open();
    const { appearance, stop } = applied(settings);
    await settings.state();
    stop();
    write('{ "theme": "light" }');
    await settle(settings);
    expect(appearance.themeSource).toBe('dark');
  });
});
