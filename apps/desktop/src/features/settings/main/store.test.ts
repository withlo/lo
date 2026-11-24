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
import { Unwritten } from '../service.ts';
import type * as file from './file.ts';
import { createSettings, forWindow, type Settings } from './store.ts';

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

/** What Settings shows of a setting, which main doesn't read. */
const row = { group: 'file', label: 'A setting', description: 'A setting for a test.' } as const;

const theme = defineSetting(
  'theme',
  z.enum(['dark', 'light', 'system']),
  'system',
  'dark, light or system',
  row,
);
const layout = defineSetting(
  'diff.layout',
  z.enum(['split', 'inline']),
  'split',
  'split or inline',
  row,
);
const cap = defineSetting(
  'cache.cap',
  z.number().int().min(1).max(100),
  10,
  'a whole number from 1 to 100',
  row,
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

/** An error's code and message, as the window hears them, when it's an `IpcError`. */
const codeAndMessage = (error: unknown) => error instanceof IpcError && [error.code, error.message];

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
          message: '`theme` is `"purple"`. It must be dark, light or system.',
        },
        {
          key: 'cache.cap',
          message: '`cache.cap` is `2.5`. It must be a whole number from 1 to 100.',
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
      '`diff.layout` is `{"a":[1]}`. It must be split or inline.',
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
    expect(state.problems[0]?.message).toContain('isn’t valid JSON');
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
    expect(state.problems[0]?.message).toContain('isn’t a JSON object');
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
    expect(() => settings.declare(defineSetting('theme', z.string(), 'x', 'text', row))).toThrow(
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
      ...row,
      window: 'write',
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
  it('writes the file, keeps what Lo doesn’t know, and tells the listeners and the window', async () => {
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
    // Changed in place: an object on one line stays on one.
    expect(contents()).toBe(
      '{ "theme": "light", "from": { "a newer": ["Lo"] }, "diff.layout": "inline" }',
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
    expect(contents()).toBe('{\n  "theme": "dark"\n}\n');
  });

  it('changes only the setting’s value, keeping the file’s comments, order and spacing', async () => {
    const text = `// My settings.
// Kept in my dotfiles.
// Lo reads them.
{
  /* At night. */
  "theme":  "dark", // or light
  "mine": [1, 2],
  "diff.layout": "split"
}
`;
    write(text);
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    expect((await settings.state()).problems).toEqual([]);
    await settings.set('theme', 'light');
    await settings.set('diff.layout', 'inline');
    expect(contents()).toBe(text.replace('"dark"', '"light"').replace('"split"', '"inline"'));
    expect((await settings.state()).values).toEqual({ theme: 'light', 'diff.layout': 'inline' });
  });

  it('adds a setting the file doesn’t have after its last, in its indent, keeping its comments', async () => {
    write('// Mine.\n{\n    "theme": "dark" // at night\n    // More to come.\n}\n');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(cap);
    await settings.set('cache.cap', 20);
    expect(contents()).toBe(
      '// Mine.\n{\n    "theme": "dark", // at night\n    // More to come.\n    "cache.cap": 20\n}\n',
    );
    expect((await settings.state()).values).toEqual({ theme: 'dark', 'cache.cap': 20 });
  });

  it('takes out the header an older Lo wrote when it changes a setting, and not before', async () => {
    const header = `// Lo's settings. Lo applies only these from this file and ignores the rest: "theme",
// "ui_font_family", "ui_font_size", "buffer_font_family" and "buffer_font_size".
// A theme's file goes in ~/.config/lo/themes, and "theme" names it. Lo's README says more.
`;
    const body = '{\n  "theme": "dark"\n}\n';
    write(`${header}${body}`);
    const { settings } = open();
    settings.declare(theme);
    settings.declare(cap);
    // Reading the file leaves it as it is.
    expect((await settings.state()).values).toEqual({ theme: 'dark', 'cache.cap': 10 });
    expect(contents()).toBe(`${header}${body}`);
    await settings.set('cache.cap', 20);
    expect(contents()).toBe('{\n  "theme": "dark",\n  "cache.cap": 20\n}\n');
    expect((await settings.state()).values).toEqual({ theme: 'dark', 'cache.cap': 20 });
    // A header the person wrote stays.
    write(`// My settings.\n${body}`);
    await settings.check();
    await settings.check();
    await settings.set('cache.cap', 30);
    expect(contents()).toBe('// My settings.\n{\n  "theme": "dark",\n  "cache.cap": 30\n}\n');
  });

  it('keeps a byte order mark through a change', async () => {
    write('\uFEFF{\n  "theme": "dark"\n}\n');
    const { settings } = open();
    settings.declare(theme);
    await settings.set('theme', 'light');
    expect(readFileSync(path)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{\n  "theme": "light"\n}\n')]),
    );
  });

  it('says why, and writes nothing, when the change can’t be made as Settings would show it', async () => {
    const text = '{ "theme": "dark" }\n';
    write(text);
    const { settings, log } = open();
    const anything = defineSetting('anything', z.json(), null, 'any JSON', row);
    settings.declare(anything);
    // Written, this would nest the file deeper than Lo reads.
    let deep: z.output<ReturnType<typeof z.json>> = 0;
    for (let level = 0; level < 100; level++) deep = [deep];
    const refused = await refusal(settings.set('anything', deep));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toBe(
      'Lo didn’t change anything: the new value, written into the settings file, wouldn’t read back as Settings shows it, so Lo left the file as it was.',
    );
    expect(contents()).toBe(text);
    expect(log).not.toHaveBeenCalled();
  });

  it('reports a file nested deeper than Lo reads, and writes nothing over it', async () => {
    const text = `{ "theme": "dark", "mine": ${'['.repeat(5000)}${']'.repeat(5000)} }`;
    write(text);
    const { settings } = open();
    settings.declare(theme);
    const state = await settings.state();
    expect(state.values).toEqual({ theme: 'system' });
    expect(state.problems).toEqual([
      {
        message: '`settings.json` nests over 100 levels deep.',
      },
    ]);
    const refused = await refusal(settings.set('theme', 'light'));
    expect(refused?.code).toBe('unwritable');
    expect(contents()).toBe(text);
  });

  it('reads a comma after the last entry, and keeps it through a change', async () => {
    write('{\n  "theme": "dark",\n  "mine": [1, 2,],\n}\n');
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    expect(await settings.state()).toMatchObject({ values: { theme: 'dark' }, problems: [] });
    await settings.set('theme', 'light');
    await settings.set('diff.layout', 'inline');
    expect(contents()).toBe(
      '{\n  "theme": "light",\n  "mine": [1, 2,],\n  "diff.layout": "inline",\n}\n',
    );
  });

  it('reports a setting given twice, uses the last, and changes it only once there’s one', async () => {
    const text = '{\n  "theme": "dark",\n  "theme": "light"\n}\n';
    write(text);
    const { settings } = open();
    settings.declare(theme);
    settings.declare(layout);
    expect(await settings.state()).toMatchObject({
      values: { theme: 'light' },
      problems: [
        {
          key: 'theme',
          message: '`theme` is in `settings.json` more than once.',
        },
      ],
    });
    const refused = await refusal(settings.set('theme', 'system'));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toBe(
      'Lo didn’t change theme, since the settings file has it more than once. Take out all but one, and Lo can change it.',
    );
    // The file is the cause, which editing it fixes.
    expect(refused).toMatchObject({
      inFile: true,
      why: 'The settings file has theme more than once, and Lo changes it only once it has one.',
    });
    expect(contents()).toBe(text);
    // Another setting changes, and the one given twice still says what Settings shows.
    await settings.set('diff.layout', 'inline');
    expect(contents()).toBe(
      '{\n  "theme": "dark",\n  "theme": "light",\n  "diff.layout": "inline"\n}\n',
    );
    expect((await settings.state()).values).toEqual({ theme: 'light', 'diff.layout': 'inline' });
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
    const trimmed = defineSetting('name', z.string().trim().min(1), 'x', 'a name', row);
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
      'Lo didn’t change theme, since the settings file has a problem.',
    );
    expect(refused?.message).toContain('isn’t valid JSON');
    // What's in the file is the cause, which editing it fixes, and why alone, for a caller to say.
    expect(refused).toBeInstanceOf(Unwritten);
    expect(refused).toMatchObject({ inFile: true });
    // What's wrong alone: saving the file isn't what applies a change Lo couldn't make.
    expect(refused instanceof Unwritten && refused.why).toMatch(
      /^The settings file isn’t valid JSON \(.+\)\.$/,
    );
    expect(contents()).toBe('{ "theme": "light", ');
    // Fixed by hand, a change goes through.
    write('{ "theme": "light" }');
    await settings.set('theme', 'dark');
    expect(JSON.parse(contents())).toEqual({ theme: 'dark' });
    expect((await settings.state()).problems).toEqual([]);
  });

  it('tells the window whether what the file holds kept a change from being made, or saving it did', async () => {
    write('{ "theme": "light", ');
    const { settings } = open();
    settings.declare(theme);
    const inFile = forWindow(await refusal(settings.set('theme', 'dark')));
    expect(inFile).toBeInstanceOf(IpcError);
    // The reason, then on the next line the parser's own words.
    expect(codeAndMessage(inFile)).toEqual([
      'settingsFile',
      '`settings.json` isn’t valid JSON.\nPropertyNameExpected at line 1, column 21',
    ]);
    // With no reason of its own, a refusal's details are main's words for it.
    const unsaved = forWindow(new Unwritten('Not saved.', 'Not saved here.', false));
    expect(codeAndMessage(unsaved)).toEqual(['unsaved', '\nNot saved here.']);
    const coded = forWindow(new Unwritten('Not saved.', 'Not saved.', false, { details: 'EIO' }));
    expect(codeAndMessage(coded)).toEqual(['unsaved', '\nEIO']);
    // Anything else is as it was.
    const other = new IpcError('invalid', 'theme must be dark, light or system.');
    expect(forWindow(other)).toBe(other);
  });

  it('writes nothing over a file with comments and a real syntax error, and says where it is', async () => {
    const text = '// Mine.\n{\n  "theme": "light"\n  "diff.layout": "inline"\n}\n';
    write(text);
    const { settings } = open();
    settings.declare(theme);
    const refused = await refusal(settings.set('theme', 'dark'));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toBe(
      'Lo didn’t change theme, since the settings file has a problem. The settings file isn’t valid JSON (Lo expected a comma at line 4, column 3).',
    );
    expect(refused instanceof Unwritten && refused.said).toEqual({
      reason: '`settings.json` isn’t valid JSON.',
      details: 'CommaExpected at line 4, column 3',
    });
    expect(contents()).toBe(text);
    expect((await settings.state()).values).toEqual({ theme: 'system' });
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
      'Lo didn’t change diff.layout: the settings file kept changing while Lo saved it.',
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
      expect(refused?.message).toBe('Lo couldn’t save theme to the settings file (EACCES).');
      // The disk is the cause, not what the file holds.
      expect(refused).toMatchObject({
        why: 'Lo couldn’t write the settings file (EACCES).',
        inFile: false,
      });
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
    const note = defineSetting('note', z.string(), '', 'text', row);
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

describe('a setting only main changes', () => {
  /** A list of names, which the window shows and only main writes, ignoring names of one letter. */
  const names = defineSetting('code.names', z.array(z.string().min(1)), [], 'a list of names', {
    ...row,
    window: 'read',
    problems: (value) =>
      value
        .filter((name) => name.length < 2)
        .map((name) => `"${name}" is too short, so Lo ignores it.`),
  });

  it('is shown to the window, but never changed by it', async () => {
    write('{ "code.names": ["lo"] }');
    const { settings } = open();
    settings.declare(names);
    expect((await settings.state()).values['code.names']).toEqual(['lo']);
    const refused = await refusal(settings.set('code.names', ['lo', 'more']));
    expect(refused?.code).toBe('unwritable');
    expect(refused?.message).toBe('Settings can’t change code.names: only Lo itself does.');
    expect(contents()).toBe('{ "code.names": ["lo"] }');
  });

  it('is changed by main from the file as it is now, keeping what Lo doesn’t know', async () => {
    write('{ "theme": "dark", "code.names": ["lo"] }');
    const { settings, changes } = open();
    settings.declare(theme);
    await settings.state();
    // Saved by a person after Lo last read it.
    write('{ "theme": "light", "code.names": ["lo", "git"], "from": 1 }');
    await settings.update(names, (now) => [...now, 'sh']);
    expect(JSON.parse(contents())).toEqual({
      theme: 'light',
      'code.names': ['lo', 'git', 'sh'],
      from: 1,
    });
    expect(changes.at(-1)?.values['code.names']).toEqual(['lo', 'git', 'sh']);
  });

  it('keeps the file’s comments when main changes it', async () => {
    const text =
      '// Trusted by hand.\n{\n  "theme": "dark", // at night\n  "code.names": ["lo"]\n}\n';
    write(text);
    const { settings } = open();
    await settings.update(names, (now) => [...now, 'sh']);
    expect(contents()).toBe(text.replace('["lo"]', '[\n    "lo",\n    "sh"\n  ]'));
  });

  it('refuses to change a value in the file the schema refuses, so it’s never lost', async () => {
    for (const text of ['{ "code.names": "lo" }', '{ "code.names": ["lo", 7] }']) {
      write(text);
      const { settings } = open();
      const refused = await refusal(settings.update(names, (now) => [...now, 'sh']));
      expect(refused?.code).toBe('unwritable');
      expect(refused?.message).toBe(
        'Lo didn’t change code.names: the settings file holds one that isn’t a list of names, which Lo won’t replace. Fix it there, or take it out.',
      );
      expect(refused).toMatchObject({
        why: 'The settings file’s code.names isn’t a list of names, and Lo won’t replace it.',
        inFile: true,
      });
      expect(contents()).toBe(text);
    }
  });

  it('starts from the default when the file holds no value', async () => {
    write('{}');
    const { settings } = open();
    await settings.update(names, (now) => [...now, 'sh']);
    expect(JSON.parse(contents())).toEqual({ 'code.names': ['sh'] });
  });

  it('refuses a change the schema refuses, writing nothing', async () => {
    write('{ "code.names": ["lo"] }');
    const { settings } = open();
    const refused = await refusal(settings.update(names, () => ['']));
    expect(refused?.code).toBe('invalid');
    expect(contents()).toBe('{ "code.names": ["lo"] }');
  });

  it('reports what the setting ignores in a value it keeps', async () => {
    write('{ "code.names": ["lo", "x", "y"] }');
    const { settings } = open();
    settings.declare(names);
    const state = await settings.state();
    expect(state.values['code.names']).toEqual(['lo', 'x', 'y']);
    expect(state.problems).toEqual([
      { key: 'code.names', message: '"x" is too short, so Lo ignores it.' },
      { key: 'code.names', message: '"y" is too short, so Lo ignores it.' },
    ]);
  });
});
