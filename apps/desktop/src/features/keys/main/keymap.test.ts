import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseKeymap } from '@lo/ui/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KEYMAP_SIZE_LIMIT, type KeymapFile } from '../contract.ts';
import { ensureKeymap, keymapHeader, readKeymap, watchKeymap } from './keymap.ts';

const NOT_PLAIN = "The keymap file isn't a plain file, so Lo doesn't read or open it.";

let folder: string;
let path: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'kk-keymap-'));
  path = join(folder, 'config', 'keymap');
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** Writes `text` as the keymap file, folder and all. */
function write(text: string | Uint8Array, at = path): void {
  mkdirSync(join(at, '..'), { recursive: true });
  writeFileSync(at, text);
}

describe('readKeymap', () => {
  it('reads the file’s text', async () => {
    write('bind x diff.markViewed\n# a comment\n');
    expect(await readKeymap(path)).toEqual({
      text: 'bind x diff.markViewed\n# a comment\n',
      canOpen: true,
    });
  });

  it('reads no file, and no folder for it, as the empty keymap', async () => {
    expect(await readKeymap(path)).toEqual({ text: '', canOpen: true });
    // A file where the folder should be.
    write('x', join(folder, 'config'));
    expect(await readKeymap(path)).toEqual({ text: '', canOpen: true });
  });

  it('reads an empty file as the empty keymap', async () => {
    write('');
    expect(await readKeymap(path)).toEqual({ text: '', canOpen: true });
  });

  it('follows a link, as a keymap kept with other dotfiles is one', async () => {
    write('bind x diff.markViewed', join(folder, 'dotfiles', 'keymap'));
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'dotfiles', 'keymap'), path);
    expect(await readKeymap(path)).toEqual({ text: 'bind x diff.markViewed', canOpen: true });
  });

  it('reads a file of exactly the limit, and leaves one a byte over unread', async () => {
    write('#'.repeat(KEYMAP_SIZE_LIMIT));
    expect((await readKeymap(path)).text).toHaveLength(KEYMAP_SIZE_LIMIT);
    write('#'.repeat(KEYMAP_SIZE_LIMIT + 1));
    expect(await readKeymap(path)).toEqual({
      text: '',
      problem: "The keymap file is over 1 MiB, so Lo didn't read it.",
      canOpen: false,
    });
  });

  it('leaves a huge file unread without holding it', async () => {
    write('');
    truncateSync(path, 64 * 1024 * 1024);
    const before = process.memoryUsage().arrayBuffers;
    const file = await readKeymap(path);
    expect(file.text).toBe('');
    expect(file.problem).toContain('over 1 MiB');
    // Nothing near the file's size was taken for it.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(16 * 1024 * 1024);
  });

  it('reports a folder, a pipe and a file that isn’t text, without waiting on any', async () => {
    mkdirSync(path, { recursive: true });
    expect(await readKeymap(path)).toEqual({ text: '', problem: NOT_PLAIN, canOpen: false });
    rmSync(path, { recursive: true });
    // Opening a pipe for reading would otherwise wait for a writer for ever.
    execFileSync('mkfifo', [path]);
    expect(await readKeymap(path)).toEqual({ text: '', problem: NOT_PLAIN, canOpen: false });
    rmSync(path);
    write(Uint8Array.from([0x62, 0x69, 0x6e, 0x64, 0x00, 0xff, 0x0a]));
    expect(await readKeymap(path)).toEqual({
      text: '',
      problem: "The keymap file isn't text.",
      canOpen: false,
    });
  });

  it('reads invalid UTF-8 as replacement characters, and drops a byte order mark', async () => {
    write(Uint8Array.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0xff, 0x0a]));
    expect(await readKeymap(path)).toEqual({ text: '# �\n', canOpen: true });
  });

  // Root reads whatever it likes.
  it.skipIf(process.getuid?.() === 0)('reports a file it isn’t allowed to read', async () => {
    write('bind x diff.markViewed');
    execFileSync('chmod', ['000', path]);
    expect(await readKeymap(path)).toEqual({
      text: '',
      problem: "Lo isn't allowed to read the keymap file.",
      canOpen: false,
    });
  });

  it('reads an executable file, which runs nothing, but won’t have it opened', async () => {
    write('bind x diff.markViewed\n');
    chmodSync(path, 0o755);
    expect(await readKeymap(path)).toEqual({
      text: 'bind x diff.markViewed\n',
      problem:
        "The keymap file is executable, so Lo won't open it, which could run it. Clear its execute permission to open it from here.",
      canOpen: false,
    });
    chmodSync(path, 0o644);
    expect(await readKeymap(path)).toEqual({ text: 'bind x diff.markViewed\n', canOpen: true });
  });

  it('reports a link to nothing, which is neither no file nor one to open', async () => {
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'elsewhere'), path);
    expect(await readKeymap(path)).toEqual({
      text: '',
      problem: "The keymap file is a link to a file that isn't there.",
      canOpen: false,
    });
  });

  it('reports a link that leads in a circle', async () => {
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(path, path);
    expect(await readKeymap(path)).toEqual({
      text: '',
      problem: "Lo couldn't read the keymap file (ELOOP).",
      canOpen: false,
    });
  });
});

describe('ensureKeymap', () => {
  it('writes the header, and the folder for it, when there is no file', async () => {
    await ensureKeymap(path);
    expect(readFileSync(path, 'utf8')).toBe(keymapHeader);
  });

  it('leaves a file that is there as it is, however odd', async () => {
    write('bind x diff.markViewed');
    await ensureKeymap(path);
    expect(readFileSync(path, 'utf8')).toBe('bind x diff.markViewed');
    write('');
    await ensureKeymap(path);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('writes nothing through a link that leads nowhere', async () => {
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(join(folder, 'elsewhere'), path);
    await expect(ensureKeymap(path)).resolves.toBeUndefined();
    expect(await readKeymap(join(folder, 'elsewhere'))).toEqual({ text: '', canOpen: true });
  });

  it('has a header that changes no key and has nothing wrong with it', () => {
    const keymap = parseKeymap(keymapHeader);
    expect(keymap.lines).toEqual([]);
    expect(keymap.errors).toEqual([]);
    // The commands it names as examples are Lo's.
    expect(keymapHeader).toContain('bind x diff.markViewed');
  });
});

/** Polls until a change has held still long enough to be read. */
async function settle(watcher: { check(): Promise<void> }): Promise<void> {
  await watcher.check();
  await watcher.check();
}

describe('watchKeymap', () => {
  const stops: (() => void)[] = [];

  /** A watch whose polls the test makes, so it never waits on a clock. */
  function watch(options: { interval?: number } = { interval: 3_600_000 }) {
    const changes: KeymapFile[] = [];
    const log = vi.fn<(message: string, error: unknown) => void>();
    const watcher = watchKeymap(path, (file) => changes.push(file), { ...options, log });
    stops.push(() => watcher.stop());
    return { watcher, changes, log };
  }

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it('starts with the file as it is, reporting no change for it', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    expect(await watcher.latest()).toEqual({ text: 'bind x diff.markViewed', canOpen: true });
    await settle(watcher);
    expect(changes).toEqual([]);
  });

  it('starts with no file, then reports it when it is made, folder and all', async () => {
    const { watcher, changes } = watch();
    expect(await watcher.latest()).toEqual({ text: '', canOpen: true });
    await settle(watcher);
    expect(changes).toEqual([]);
    write('bind x diff.markViewed');
    await settle(watcher);
    expect(changes).toEqual([{ text: 'bind x diff.markViewed', canOpen: true }]);
    expect(await watcher.latest()).toEqual({ text: 'bind x diff.markViewed', canOpen: true });
  });

  it('reports a change written in place, and then the file’s removal', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    write('bind y diff.markViewed');
    await settle(watcher);
    rmSync(path);
    await settle(watcher);
    expect(changes).toEqual([
      { text: 'bind y diff.markViewed', canOpen: true },
      { text: '', canOpen: true },
    ]);
  });

  it('reports a change saved by renaming a new file over the old, as editors do', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    for (const text of ['bind y diff.markViewed', 'bind z diff.markViewed']) {
      writeFileSync(`${path}~`, text);
      renameSync(`${path}~`, path);
      await settle(watcher);
    }
    expect(changes).toEqual([
      { text: 'bind y diff.markViewed', canOpen: true },
      { text: 'bind z diff.markViewed', canOpen: true },
    ]);
  });

  it('reports a change to the file a link leads to', async () => {
    const target = join(folder, 'dotfiles', 'keymap');
    write('bind x diff.markViewed', target);
    mkdirSync(join(folder, 'config'), { recursive: true });
    symlinkSync(target, path);
    const { watcher, changes } = watch();
    expect(await watcher.latest()).toEqual({ text: 'bind x diff.markViewed', canOpen: true });
    write('bind y diff.markViewed', target);
    await settle(watcher);
    expect(changes).toEqual([{ text: 'bind y diff.markViewed', canOpen: true }]);
  });

  it('reads a change only once it has held still for a poll, so a save part-written is never read', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    write('bind y diff.mark');
    await watcher.check();
    write('bind y diff.markViewed');
    await watcher.check();
    expect(changes).toEqual([]);
    await watcher.check();
    expect(changes).toEqual([{ text: 'bind y diff.markViewed', canOpen: true }]);
  });

  it('reports nothing for a save that leaves the file saying the same', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    write('bind x diff.markViewed');
    writeFileSync(path, 'bind y diff.markViewed');
    writeFileSync(path, 'bind x diff.markViewed');
    await settle(watcher);
    expect(changes).toEqual([]);
  });

  it('reports a file that grows past the limit as a problem, and the next good one as text', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    write('#'.repeat(KEYMAP_SIZE_LIMIT + 1));
    await settle(watcher);
    write('bind y diff.markViewed');
    await settle(watcher);
    expect(changes).toEqual([
      { text: '', problem: "The keymap file is over 1 MiB, so Lo didn't read it.", canOpen: false },
      { text: 'bind y diff.markViewed', canOpen: true },
    ]);
  });

  it('reports a change to the file’s permissions, which decide whether it can be opened', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch();
    await watcher.latest();
    chmodSync(path, 0o755);
    await settle(watcher);
    chmodSync(path, 0o644);
    await settle(watcher);
    expect(changes.map((change) => change.canOpen)).toEqual([false, true]);
    expect(changes[0]?.text).toBe('bind x diff.markViewed');
  });

  it('looks at the file by itself, and stops when told to', async () => {
    write('bind x diff.markViewed');
    const { watcher, changes } = watch({ interval: 10 });
    await watcher.latest();
    write('bind y diff.markViewed');
    await vi.waitFor(() =>
      expect(changes).toEqual([{ text: 'bind y diff.markViewed', canOpen: true }]),
    );
    watcher.stop();
    write('bind z diff.markViewed');
    await new Promise((done) => setTimeout(done, 100));
    expect(changes).toHaveLength(1);
  });
});
