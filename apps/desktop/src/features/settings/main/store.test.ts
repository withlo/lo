import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { IpcError } from '../../../ipc/contract.ts';
import { defineSetting, type Setting, type SettingsState } from '../contract.ts';
import type * as file from './file.ts';
import { createSettings, type Settings } from './store.ts';

/** What a test does as each write of the file starts, as when a person saves it meanwhile. */
const writing = vi.hoisted(() => ({ starts: undefined as (() => void) | undefined }));

vi.mock('./file.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof file>();
  return {
    ...actual,
    writeSettings: (...args: Parameters<typeof actual.writeSettings>) => {
      writing.starts?.();
      return actual.writeSettings(...args);
    },
  };
});

const theme = defineSetting(
  'theme',
  z.enum(['dark', 'light', 'system']),
  'system',
  'dark, light or system',
);
const layout = defineSetting(
  'diff.layout',
  z.enum(['split', 'inline']),
  'split',
  'split or inline',
);
const cap = defineSetting(
  'cache.cap',
  z.number().int().min(1).max(100),
  10,
  'a whole number from 1 to 100',
);

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'st-store-'));
  path = join(folder, 'config', 'settings.json');
});

afterEach(() => {
  for (const stop of stops.splice(0)) void stop();
  writing.starts = undefined;
  rmSync(folder, { recursive: true, force: true });
});

const stops: (() => Promise<void>)[] = [];

/** Writes `text` as the settings file, folder and all. */
function write(text: string, at = path): void {
  mkdirSync(join(at, '..'), { recursive: true });
  writeFileSync(at, text);
}

const contents = () => readFileSync(path, 'utf8');

/** Settings whose polls the test makes, so it never waits on a clock. */
function open(options: { interval?: number } = { interval: 3_600_000 }) {
  const changes: SettingsState[] = [];
  const log = vi.fn<(message: string, error?: unknown) => void>();
  const settings = createSettings({
    path,
    shown: '~/.config/lo/settings.json',
    changed: (state) => changes.push(state),
    log,
    ...options,
  });
  stops.push(() => settings.stop());
  return { settings, changes, log };
}

/** A change to the file seen, held still for a poll, and read. */
async function settle(settings: Settings): Promise<void> {
  await settings.check();
  await settings.check();
}

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(IpcError);
  return error instanceof IpcError ? error : undefined;
};

describe('reading', () => {
  it('has each declared setting’s value from the file, and its default where the file has none', async () => {
    write('{ "theme": "light", "unrelated": 3 }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    expect(await settings.state()).toEqual({
      file: '~/.config/lo/settings.json',
      values: { theme: 'light', 'diff.layout': 'split' },
      problems: [],
    });
  });

  it('has defaults, and no problem, when there is no file', async () => {
    const { settings, changes } = open();
    settings.declare(theme);
    expect(await settings.state()).toEqual({
      file: '~/.config/lo/settings.json',
      values: { theme: 'system' },
      problems: [],
    });
    expect(changes.at(-1)).toEqual(await settings.state());
  });

  it('says nothing before the file has been read, and has the state after', async () => {
    write('{ "theme": "dark" }');
    const { settings, changes } = open();
    const told: string[] = [];
    settings.watch(theme, (value) => told.push(value));
    // Reading the file takes a turn, and nothing is applied or published at a default first.
    expect(told).toEqual([]);
    expect(changes).toEqual([]);
    await settings.state();
    expect(told).toEqual(['dark']);
    expect(changes).toHaveLength(1);
  });

  it('reports a value its schema refuses and uses the default, and nothing else changes', async () => {
    write('{ "theme": "purple", "diff.layout": "inline", "cache.cap": 2.5 }');
    const { settings } = open();
    for (const setting of [theme, layout]) settings.declare(setting);
    settings.declare(cap);
    expect(await settings.state()).toEqual({
      file: '~/.config/lo/settings.json',
      values: { theme: 'system', 'diff.layout': 'inline', 'cache.cap': 10 },
      problems: [
        {
          key: 'theme',
          message: 'theme is "purple", but it must be dark, light or system. Lo uses "system".',
        },
        {
          key: 'cache.cap',
          message: 'cache.cap is 2.5, but it must be a whole number from 1 to 100. Lo uses 10.',
        },
      ],
    });
  });

  it('shortens a long bad value in what it says, and says what kind of thing a non-scalar is', async () => {
    write(`{ "theme": "${'x'.repeat(500)}", "diff.layout": { "a": [1] } }`);
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    const { problems } = await settings.state();
    expect(problems).toHaveLength(2);
    expect(problems[0]?.message.length).toBeLessThan(150);
    expect(problems[0]?.message).toContain('…');
    expect(problems[1]?.message).toContain(
      'diff.layout is {"a":[1]}, but it must be split or inline.',
    );
  });

  it('keeps the settings it had when the file as a whole stops being usable, and says why', async () => {
    write('{ "theme": "light" }');
    const { settings, changes } = open();
    settings.declare(theme);
    await settings.state();
    write('{ "theme": ');
    await settle(settings);
    const state = await settings.state();
    expect(state.values).toEqual({ theme: 'light' });
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0]?.key).toBeUndefined();
    expect(state.problems[0]?.message).toContain("isn't valid JSON");
    expect(changes.at(-1)).toEqual(state);
    // Fixed, it applies, and the problem goes.
    write('{ "theme": "dark" }');
    await settle(settings);
    expect(await settings.state()).toEqual({
      file: '~/.config/lo/settings.json',
      values: { theme: 'dark' },
      problems: [],
    });
  });

  it('starts at the defaults with a file that is unusable from the first', async () => {
    write('[1, 2]');
    const { settings } = open();
    settings.declare(theme);
    const state = await settings.state();
    expect(state.values).toEqual({ theme: 'system' });
    expect(state.problems[0]?.message).toContain('one JSON object');
  });

  it('reads a setting declared after the file was read', async () => {
    write('{ "theme": "dark", "diff.layout": "bogus" }');
    const { settings, changes } = open();
    settings.declare(theme);
    await settings.state();
    settings.declare(layout);
    const state = await settings.state();
    expect(state.values).toEqual({ theme: 'dark', 'diff.layout': 'split' });
    expect(state.problems.map((item) => item.key)).toEqual(['diff.layout']);
    expect(changes.at(-1)).toEqual(state);
  });

  it('refuses two different settings under one key, and takes the same one again', () => {
    const { settings } = open();
    settings.declare(theme);
    settings.declare(theme);
    expect(() => settings.declare(defineSetting('theme', z.string(), 'x', 'text'))).toThrow(
      'The setting theme is declared twice.',
    );
  });

  it('refuses a value whose schema turns it into something JSON can’t hold', async () => {
    write('{ "when": "2026-11-11" }');
    const when: Setting<string | Date> = {
      key: 'when',
      schema: z.string().transform((text): string | Date => new Date(text)),
      fallback: '2000-01-01',
      accepts: 'a date',
    };
    const { settings } = open();
    settings.declare(when);
    const state = await settings.state();
    expect(state.values).toEqual({ when: '2000-01-01' });
    expect(state.problems).toHaveLength(1);
  });
});

describe('watching', () => {
  it('tells a listener the value once the file is read, and each time it changes', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    const told: string[] = [];
    settings.watch(theme, (value) => told.push(value));
    await settings.state();
    write('{ "theme": "light" }');
    await settle(settings);
    write('{ "theme": "light", "other": 1 }');
    await settle(settings);
    // A bad value is the default, which is a change too.
    write('{ "theme": 4 }');
    await settle(settings);
    write('{}');
    await settle(settings);
    expect(told).toEqual(['dark', 'light', 'system']);
  });

  it('tells a listener that comes after the file was read, at once', async () => {
    write('{ "theme": "light" }');
    const { settings } = open();
    await settings.state();
    const told: string[] = [];
    settings.watch(theme, (value) => told.push(value));
    expect(told).toEqual(['light']);
  });

  it('tells a listener only of its own setting, and stops when told to', async () => {
    write('{}');
    const { settings } = open();
    const told: string[] = [];
    const stop = settings.watch(layout, (value) => told.push(value));
    await settings.state();
    write('{ "theme": "dark", "diff.layout": "inline" }');
    await settle(settings);
    stop();
    write('{ "diff.layout": "split" }');
    await settle(settings);
    expect(told).toEqual(['split', 'inline']);
  });

  it('goes on to the next listener, and logs, when one throws', async () => {
    write('{ "theme": "dark" }');
    const { settings, log } = open();
    const told: string[] = [];
    settings.watch(theme, () => {
      throw new Error('broken');
    });
    settings.watch(theme, (value) => told.push(value));
    await settings.state();
    expect(told).toEqual(['dark']);
    expect(log).toHaveBeenCalledWith("A setting's listener failed (theme):", expect.any(Error));
  });

  it('publishes the state when the file changes, not for a save that says the same', async () => {
    write('{ "theme": "dark" }');
    const { settings, changes } = open();
    settings.declare(theme);
    await settings.state();
    expect(changes).toHaveLength(1);
    write('{"theme":"dark"}');
    await settle(settings);
    write('{ "theme": "dark", "something": "else" }');
    await settle(settings);
    expect(changes).toHaveLength(1);
    write('{ "theme": "light" }');
    await settle(settings);
    expect(changes.map((state) => state.values.theme)).toEqual(['dark', 'light']);
  });

  it('notices a file saved by renaming a new one over it, and one that is removed', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    settings.declare(theme);
    await settings.state();
    writeFileSync(`${path}~`, '{ "theme": "light" }');
    renameSync(`${path}~`, path);
    await settle(settings);
    expect((await settings.state()).values.theme).toBe('light');
    rmSync(path);
    await settle(settings);
    expect((await settings.state()).values.theme).toBe('system');
  });

  it('reads a change only once it has held still for a poll, so a save part-written is never read', async () => {
    write('{ "theme": "dark" }');
    const { settings, changes } = open();
    settings.declare(theme);
    await settings.state();
    write('{ "theme": "li');
    await settings.check();
    write('{ "theme": "light" }');
    await settings.check();
    expect(changes).toHaveLength(1);
    await settings.check();
    expect(changes.map((state) => state.values.theme)).toEqual(['dark', 'light']);
    expect(changes.every((state) => state.problems.length === 0)).toBe(true);
  });

  it('looks at the file by itself, and stops when told to', async () => {
    write('{ "theme": "dark" }');
    const { settings, changes } = open({ interval: 10 });
    settings.declare(theme);
    await settings.state();
    write('{ "theme": "light" }');
    await vi.waitFor(() => expect(changes.at(-1)?.values.theme).toBe('light'));
    await settings.stop();
    write('{ "theme": "dark" }');
    await new Promise((done) => setTimeout(done, 100));
    expect(changes.at(-1)?.values.theme).toBe('light');
  });
});

describe('changing a setting', () => {
  it('writes the file whole, keeps what Lo doesn’t know, and tells the listeners and the window', async () => {
    write('{ "theme": "dark", "from": { "a newer": ["Lo"] } }');
    const { settings, changes } = open();
    const told: string[] = [];
    settings.watch(theme, (value) => told.push(value));
    settings.declare(layout);
    await settings.state();
    await settings.set('diff.layout', 'inline');
    await settings.set('theme', 'light');
    expect(JSON.parse(contents())).toEqual({
      theme: 'light',
      from: { 'a newer': ['Lo'] },
      'diff.layout': 'inline',
    });
    expect(contents()).toBe(
      `${JSON.stringify(
        { theme: 'light', from: { 'a newer': ['Lo'] }, 'diff.layout': 'inline' },
        null,
        2,
      )}\n`,
    );
    expect(told).toEqual(['dark', 'light']);
    expect(changes.at(-1)?.values).toEqual({ theme: 'light', 'diff.layout': 'inline' });
    // And what it wrote is what it reads: the poll that follows changes nothing.
    const before = changes.length;
    await settle(settings);
    expect(changes).toHaveLength(before);
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
  });

  it('makes the file, and its folder, when there is none', async () => {
    const { settings } = open();
    settings.declare(theme);
    await settings.set('theme', 'dark');
    expect(JSON.parse(contents())).toEqual({ theme: 'dark' });
  });

  it('refuses a setting no feature declared, and a value its schema refuses, writing nothing', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(cap);
    const unknown = await refusal(settings.set('diff.layout', 'inline'));
    expect(unknown?.code).toBe('invalid');
    // Not even a key that is only in the file.
    expect((await refusal(settings.set('from', 'x')))?.code).toBe('invalid');
    for (const value of ['purple', 3, null, { theme: 'dark' }, ['dark']]) {
      const refused = await refusal(settings.set('theme', value));
      expect(refused?.code).toBe('invalid');
      expect(refused?.message).toBe('theme must be dark, light or system.');
    }
    expect((await refusal(settings.set('cache.cap', 0)))?.code).toBe('invalid');
    expect((await refusal(settings.set('cache.cap', 1.5)))?.code).toBe('invalid');
    expect((await refusal(settings.set('__proto__', 1)))?.code).toBe('invalid');
    expect(contents()).toBe('{ "theme": "dark" }');
  });

  it('writes a value the schema accepts, and what the schema made of it', async () => {
    const { settings } = open();
    const trimmed = defineSetting('name', z.string().trim().min(1), 'x', 'a name');
    settings.declare(trimmed);
    await settings.set('name', '  Lo  ');
    expect(JSON.parse(contents())).toEqual({ name: 'Lo' });
  });

  it('writes nothing over a file that can’t be read as a whole, so what was typed is not lost', async () => {
    write('{ "theme": "light", ');
    const { settings } = open();
    settings.declare(theme);
    const refused = await refusal(settings.set('theme', 'dark'));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toContain(
      "Lo didn't change theme, since the settings file has a problem.",
    );
    expect(refused?.message).toContain("isn't valid JSON");
    expect(contents()).toBe('{ "theme": "light", ');
    // Fixed by hand, a change goes through.
    write('{ "theme": "light" }');
    await settings.set('theme', 'dark');
    expect(JSON.parse(contents())).toEqual({ theme: 'dark' });
    expect((await settings.state()).problems).toEqual([]);
  });

  it('takes the file as it is on disk now, so a save the poll has not seen yet is not undone', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    await settings.state();
    // Saved by hand a moment ago; no poll has looked since.
    write('{ "theme": "light", "mine": true }');
    await settings.set('diff.layout', 'inline');
    expect(JSON.parse(contents())).toEqual({ theme: 'light', mine: true, 'diff.layout': 'inline' });
    expect((await settings.state()).values).toEqual({ theme: 'light', 'diff.layout': 'inline' });
  });

  it('keeps a save made while a change is being written, and makes the change on top of it', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    await settings.state();
    // Saved by hand after Lo read the file for the change, before it replaced the file.
    writing.starts = () => {
      writing.starts = undefined;
      write('{ "theme": "light", "mine": true }');
    };
    await settings.set('diff.layout', 'inline');
    expect(JSON.parse(contents())).toEqual({ theme: 'light', mine: true, 'diff.layout': 'inline' });
    expect((await settings.state()).values).toEqual({ theme: 'light', 'diff.layout': 'inline' });
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
  });

  it('says it could not save, and keeps every save, when the file keeps changing', async () => {
    write('{ "theme": "dark" }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    let saves = 0;
    writing.starts = () => {
      // Each a different length, as a clock may not tick between two saves.
      saves += 1;
      write(`{ "theme": "dark", "saves": "${'x'.repeat(saves)}" }`);
    };
    const refused = await refusal(settings.set('diff.layout', 'inline'));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toBe(
      "Lo didn't change diff.layout: the settings file kept changing while Lo saved it.",
    );
    expect(saves).toBe(3);
    expect(JSON.parse(contents())).toEqual({ theme: 'dark', saves: 'xxx' });
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
  });

  it('keeps a bad value the person typed, still reported, when it changes another setting', async () => {
    write('{ "theme": "purple" }');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    await settings.set('diff.layout', 'inline');
    expect(JSON.parse(contents())).toEqual({ theme: 'purple', 'diff.layout': 'inline' });
    const state = await settings.state();
    expect(state.problems.map((item) => item.key)).toEqual(['theme']);
    // Changing the bad one itself fixes it.
    await settings.set('theme', 'dark');
    expect(JSON.parse(contents())).toEqual({ theme: 'dark', 'diff.layout': 'inline' });
    expect((await settings.state()).problems).toEqual([]);
  });

  it('makes changes one after another, in the order they were asked for', async () => {
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    settings.declare(cap);
    await Promise.all([
      settings.set('theme', 'dark'),
      settings.set('diff.layout', 'inline'),
      settings.set('cache.cap', 20),
      settings.set('theme', 'light'),
    ]);
    expect(JSON.parse(contents())).toEqual({
      theme: 'light',
      'diff.layout': 'inline',
      'cache.cap': 20,
    });
  });

  it('says it could not save, and changes nothing, when the file can’t be written', async () => {
    write('{ "theme": "dark" }');
    const { settings, changes, log } = open();
    const told: string[] = [];
    settings.watch(theme, (value) => told.push(value));
    await settings.state();
    chmodSync(join(folder, 'config'), 0o555);
    try {
      if (process.getuid?.() === 0) return;
      const refused = await refusal(settings.set('theme', 'light'));
      expect(refused?.code).toBe('unwritable');
      expect(refused?.message).toBe("Lo couldn't save theme to the settings file (EACCES).");
      expect(log).toHaveBeenCalled();
    } finally {
      chmodSync(join(folder, 'config'), 0o755);
    }
    expect(contents()).toBe('{ "theme": "dark" }');
    expect(told).toEqual(['dark']);
    expect(changes.at(-1)?.values.theme).toBe('dark');
  });

  it('refuses to make a file over the limit', async () => {
    write(`{ "padding": "${'x'.repeat(1024 * 1024 - 100)}" }`);
    const { settings } = open();
    const note = defineSetting('note', z.string(), '', 'text');
    settings.declare(note);
    const refused = await refusal(settings.set('note', 'y'.repeat(200)));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toContain('too big');
  });

  it('finishes a change being written before it stops', async () => {
    const { settings } = open();
    settings.declare(theme);
    const changing = settings.set('theme', 'dark');
    await settings.stop();
    await changing;
    expect(JSON.parse(contents())).toEqual({ theme: 'dark' });
  });
});
