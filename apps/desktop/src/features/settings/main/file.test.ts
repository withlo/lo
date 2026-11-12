import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import type * as fsPromises from 'node:fs/promises';
import { open, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  parseSettings,
  readSettings,
  SETTINGS_SIZE_LIMIT,
  SettingsChanged,
  signature,
  writeSettings,
  written,
} from './file.ts';

// The file system as it is, with its opens and renames watched where a test asks.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof fsPromises>();
  return {
    ...fs,
    open: vi.fn<typeof fs.open>(fs.open),
    rename: vi.fn<typeof fs.rename>(fs.rename),
  };
});

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'st-settings-'));
  path = join(folder, 'config', 'settings.json');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** Writes `text` as the settings file, folder and all. */
function write(text: string | Uint8Array, at = path): void {
  mkdirSync(join(at, '..'), { recursive: true });
  writeFileSync(at, text);
}

/** White space that makes `{…}` the limit's length, or `extra` bytes more. */
const padding = (extra: number) => ' '.repeat(SETTINGS_SIZE_LIMIT - 2 + extra);

const problemOf = (read: Awaited<ReturnType<typeof readSettings>>) =>
  read.kind === 'problem' ? read.problem : undefined;

describe('parseSettings', () => {
  it('reads one JSON object, keeping every key in it, known or not', () => {
    expect(
      parseSettings('{ "theme": "dark", "diff.layout": "inline", "later": [1, { "a": null }] }'),
    ).toEqual({
      kind: 'ok',
      values: { theme: 'dark', 'diff.layout': 'inline', later: [1, { a: null }] },
    });
  });

  it('reads a file with nothing in it, or only white space, as no settings', () => {
    expect(parseSettings('')).toEqual({ kind: 'ok', values: {} });
    expect(parseSettings(' \n\t\n')).toEqual({ kind: 'ok', values: {} });
    expect(parseSettings('{}')).toEqual({ kind: 'ok', values: {} });
  });

  it('says what is wrong with text that is not JSON, and with JSON that is not an object', () => {
    const syntax = problemOf(parseSettings('{ "theme": }'));
    expect(syntax).toMatch(
      /^The settings file isn't valid JSON \(.+\)\. Fix it, and Lo applies it as soon as you save\.$/,
    );
    // JSON with comments, which editors tolerate in settings files, is not JSON.
    expect(problemOf(parseSettings('// my settings\n{}'))).toContain("isn't valid JSON");
    for (const text of ['null', '[]', '[{"theme":"dark"}]', '"dark"', '3', 'true']) {
      expect(problemOf(parseSettings(text))).toContain('should hold one JSON object');
    }
  });

  it('keeps a key called __proto__ as the plain key it is, and does not become its object’s prototype', () => {
    const read = parseSettings('{ "__proto__": { "theme": "light" } }');
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(Object.hasOwn(read.values, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(read.values)).toBe(Object.prototype);
    expect(Object.hasOwn(read.values, 'theme')).toBe(false);
  });
});

describe('readSettings', () => {
  it('reads the file’s object', async () => {
    write('{ "theme": "light" }\n');
    expect(await readSettings(path)).toEqual({ kind: 'ok', values: { theme: 'light' } });
  });

  it('reads no file, and no folder for it, as no settings', async () => {
    expect(await readSettings(path)).toEqual({ kind: 'missing' });
    // A file where the folder should be.
    write('x', join(folder, 'config'));
    expect(await readSettings(path)).toEqual({ kind: 'missing' });
  });

  it('follows a link, as a settings file kept with other dotfiles is one', async () => {
    write('{ "theme": "dark" }', join(folder, 'dotfiles', 'settings.json'));
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'dotfiles', 'settings.json'), path);
    expect(await readSettings(path)).toEqual({ kind: 'ok', values: { theme: 'dark' } });
  });

  it('drops a byte order mark, as editors on some systems add', async () => {
    write(Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('{ "theme": "dark" }')]));
    expect(await readSettings(path)).toEqual({ kind: 'ok', values: { theme: 'dark' } });
  });

  it('reads a file of exactly the limit, and leaves one a byte over unread', async () => {
    write(`{${padding(0)}}`);
    expect(await readSettings(path)).toEqual({ kind: 'ok', values: {} });
    write(`{${padding(1)}}`);
    expect(problemOf(await readSettings(path))).toBe(
      "The settings file is over 1 MiB, so Lo didn't read it.",
    );
  });

  it('leaves a huge file unread without holding it', async () => {
    write('');
    truncateSync(path, 64 * 1024 * 1024);
    const before = process.memoryUsage().arrayBuffers;
    expect(problemOf(await readSettings(path))).toContain('over 1 MiB');
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
  });

  it('reports a folder, a pipe and a file that isn’t text, without waiting on any', async () => {
    const notPlain = "The settings file isn't a plain file, so Lo didn't read it.";
    mkdirSync(path, { recursive: true });
    expect(problemOf(await readSettings(path))).toBe(notPlain);
    rmSync(path, { recursive: true });
    // Opening a pipe for reading would otherwise wait for a writer for ever.
    execFileSync('mkfifo', [path]);
    expect(problemOf(await readSettings(path))).toBe(notPlain);
    rmSync(path);
    write(Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]));
    expect(problemOf(await readSettings(path))).toBe(
      "The settings file isn't UTF-8 text, so Lo didn't read it.",
    );
  });

  // Root reads whatever it likes.
  it.skipIf(process.getuid?.() === 0)('reports a file it isn’t allowed to read', async () => {
    write('{}');
    chmodSync(path, 0o000);
    expect(problemOf(await readSettings(path))).toBe("Lo isn't allowed to read the settings file.");
  });

  it('reports a link to nothing, and a link that leads in a circle', async () => {
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'elsewhere'), path);
    expect(problemOf(await readSettings(path))).toBe(
      "The settings file is a link to a file that isn't there.",
    );
    rmSync(path);
    symlinkSync(path, path);
    expect(problemOf(await readSettings(path))).toBe(
      'The settings file is a link that leads back to itself.',
    );
  });
});

describe('writeSettings', () => {
  it('writes the file, and the folder for it, when there is none', async () => {
    await writeSettings(path, '{\n  "theme": "dark"\n}\n');
    expect(readFileSync(path, 'utf8')).toBe('{\n  "theme": "dark"\n}\n');
    expect(statSync(path).mode & 0o777).toBe(0o644);
  });

  it('replaces the file in one step, leaving nothing of its own beside it', async () => {
    write('{ "theme": "dark" }');
    await writeSettings(path, '{ "theme": "light" }');
    expect(readFileSync(path, 'utf8')).toBe('{ "theme": "light" }');
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
  });

  it('keeps the file’s permissions', async () => {
    write('{}');
    chmodSync(path, 0o600);
    await writeSettings(path, '{ "theme": "light" }');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('writes the file a link leads to, and leaves the link a link', async () => {
    const target = join(folder, 'dotfiles', 'settings.json');
    write('{ "theme": "dark" }', target);
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(target, path);
    await writeSettings(path, '{ "theme": "light" }');
    expect(readFileSync(target, 'utf8')).toBe('{ "theme": "light" }');
    expect(readFileSync(path, 'utf8')).toBe('{ "theme": "light" }');
    expect(statSync(path).isFile()).toBe(true);
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
    expect(readdirSync(join(folder, 'dotfiles'))).toEqual(['settings.json']);
    // The path is still the link.
    expect(execFileSync('readlink', [path], { encoding: 'utf8' }).trim()).toBe(target);
  });

  it('writes nothing through a link that leads nowhere, which a file would replace', async () => {
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'elsewhere'), path);
    await expect(writeSettings(path, '{}')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(execFileSync('readlink', [path], { encoding: 'utf8' }).trim()).toBe(
      join(folder, 'elsewhere'),
    );
  });

  it('writes nothing over a file changed since it was read, and leaves nothing beside it', async () => {
    write('{ "theme": "dark" }');
    const read = await signature(path);
    // Saved by hand while the change was being made.
    write('{ "theme": "dark", "mine": true }');
    await expect(writeSettings(path, '{ "theme": "light" }', read)).rejects.toBeInstanceOf(
      SettingsChanged,
    );
    expect(readFileSync(path, 'utf8')).toBe('{ "theme": "dark", "mine": true }');
    expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
    // Read again, it's written.
    await writeSettings(path, '{ "theme": "light" }', await signature(path));
    expect(readFileSync(path, 'utf8')).toBe('{ "theme": "light" }');
  });

  it('writes nothing over a file made since it was read as missing', async () => {
    const read = await signature(path);
    write('{ "mine": true }');
    await expect(writeSettings(path, '{}', read)).rejects.toBeInstanceOf(SettingsChanged);
    expect(readFileSync(path, 'utf8')).toBe('{ "mine": true }');
  });

  it('syncs the new file before it replaces the old one, and its folder after', async () => {
    write('{}');
    const fs = await vi.importActual<typeof fsPromises>('node:fs/promises');
    const done: string[] = [];
    vi.mocked(open).mockImplementation(async (file, flags, mode) => {
      const handle = await fs.open(file, flags, mode);
      const sync = handle.sync.bind(handle);
      handle.sync = async () => {
        done.push(`sync ${String(file)}`);
        await sync();
      };
      return handle;
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      done.push(`rename to ${String(to)}`);
      await fs.rename(from, to);
    });
    onTestFinished(() => {
      vi.mocked(open).mockImplementation(fs.open);
      vi.mocked(rename).mockImplementation(fs.rename);
    });
    await writeSettings(path, '{ "theme": "light" }');
    const real = realpathSync(join(folder, 'config'));
    expect(done).toEqual([
      expect.stringMatching(/^sync .*\/\.settings\.json\.[\w-]+\.tmp$/),
      `rename to ${join(real, 'settings.json')}`,
      `sync ${real}`,
    ]);
    expect(readFileSync(path, 'utf8')).toBe('{ "theme": "light" }');
  });

  // Root writes wherever it likes.
  it.skipIf(process.getuid?.() === 0)(
    'fails when the folder can’t be written, leaving the old file and no leftovers',
    async () => {
      write('{ "theme": "dark" }');
      chmodSync(join(folder, 'config'), 0o555);
      try {
        await expect(writeSettings(path, '{ "theme": "light" }')).rejects.toMatchObject({
          code: 'EACCES',
        });
      } finally {
        chmodSync(join(folder, 'config'), 0o755);
      }
      expect(readFileSync(path, 'utf8')).toBe('{ "theme": "dark" }');
      expect(readdirSync(join(folder, 'config'))).toEqual(['settings.json']);
    },
  );
});

describe('signature', () => {
  it('changes when the file is made, edited, replaced and removed', async () => {
    const none = await signature(path);
    expect(none).toBe('missing');
    write('{}');
    const made = await signature(path);
    write('{ "theme": "dark" }');
    const edited = await signature(path);
    writeFileSync(`${path}~`, '{ "theme": "dark" }');
    execFileSync('mv', [`${path}~`, path]);
    const replaced = await signature(path);
    rmSync(path);
    expect(new Set([none, made, edited, replaced]).size).toBe(4);
    expect(await signature(path)).toBe('missing');
  });
});

describe('written', () => {
  it('writes the home folder as ~, and nothing else', () => {
    expect(written('/Users/tess/.config/lo/settings.json', '/Users/tess')).toBe(
      '~/.config/lo/settings.json',
    );
    expect(written('/Users/tess/.config/lo/settings.json', '/Users/tess/')).toBe(
      '~/.config/lo/settings.json',
    );
    // Only a folder inside home is in home.
    expect(written('/Users/tessa/lo.json', '/Users/tess')).toBe('/Users/tessa/lo.json');
    expect(written('/tmp/lo/settings.json', '/Users/tess')).toBe('/tmp/lo/settings.json');
    expect(written('/tmp/lo/settings.json', '')).toBe('/tmp/lo/settings.json');
  });
});
