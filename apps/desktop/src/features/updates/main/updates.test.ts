import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { How, UpdateState } from '../contract.ts';
import {
  INSTALL_LIMIT,
  Updates,
  type QuitEvent,
  type Release,
  type Updater,
  type UpdatesOptions,
} from './updates.ts';

/** A download a test settles: how far it got, and whether it ended well. */
interface Download {
  progress(received: number, total: number): void;
  done(): void;
  fail(error: Error): void;
}

/** electron-updater, as the tests stand in for it: the feed offers `offered`. */
function fakeUpdater(offered: Partial<Release> = {}) {
  const downloads: Download[] = [];
  const updater = {
    check: vi.fn<Updater['check']>(async () => ({
      version: '0.2.0',
      notes: '<h2>Faster diffs</h2><p>And more.</p>',
      ...offered,
    })),
    download: vi.fn<Updater['download']>(
      (progress) =>
        new Promise<void>((resolve, reject) => {
          downloads.push({ progress, done: resolve, fail: reject });
        }),
    ),
    cancel: vi.fn<Updater['cancel']>(),
    // On success, the installer quits Lo before this would resolve.
    install: vi.fn<Updater['install']>(() => new Promise<void>(() => {})),
  };
  return { updater, downloads };
}

let published: UpdateState[];
let quit: ReturnType<typeof vi.fn<() => void>>;
let move: ReturnType<typeof vi.fn<() => boolean>>;
let logged: string[];

beforeEach(() => {
  vi.useFakeTimers();
  published = [];
  quit = vi.fn<() => void>();
  move = vi.fn<() => boolean>(() => true);
  logged = [];
});

afterEach(() => {
  vi.useRealTimers();
});

/** Updates, for this Lo at 0.1.0, which takes an update `how` says. */
function start(
  updater: UpdatesOptions['updater'],
  how: How = 'install',
  current = '0.1.0',
): Updates {
  return new Updates({
    current,
    how,
    updater,
    publish: (state) => published.push(state),
    log: (line) => logged.push(line),
    quit,
    move,
  });
}

/** `will-quit`, held off already by Lo's own listener (`held`), or let through. */
function willQuit(
  held: boolean,
): QuitEvent & { preventDefault: ReturnType<typeof vi.fn<() => void>> } {
  const event = {
    defaultPrevented: held,
    preventDefault: vi.fn<() => void>(() => {
      event.defaultPrevented = true;
    }),
  };
  return event;
}

const OFFER = {
  status: 'available',
  version: '0.2.0',
  line: 'Faster diffs',
  how: 'install',
  page: 'https://github.com/withlo/lo/releases/tag/v0.2.0',
} as const;

describe('a check', () => {
  it('offers a newer version, with its notes’ first line, how Lo takes it and its page', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await expect(updates.check(true)).resolves.toEqual(OFFER);
    expect(published).toEqual([OFFER]);
    expect(updates.state).toEqual(OFFER);
  });

  it('offers it as this copy of Lo takes one', async () => {
    for (const how of ['move', 'brew', 'page'] as const) {
      const { updater } = fakeUpdater();
      await expect(start(updater, how).check(true)).resolves.toEqual({ ...OFFER, how });
    }
  });

  it('builds the page from the version, never from the feed', async () => {
    const { updater } = fakeUpdater({
      version: '0.3.0-rc.1',
      notes: '<p><a href="https://example.com/lo.zip">Get it here</a></p>',
    });
    const answer = await start(updater).check(true);
    expect(answer).toMatchObject({
      version: '0.3.0-rc.1',
      line: 'Get it here',
      page: 'https://github.com/withlo/lo/releases/tag/v0.3.0-rc.1',
    });
  });

  it('never offers an older version, nor this one, whatever electron-updater decided', async () => {
    for (const version of ['0.1.0', '0.0.9', '0.1.0-rc.3']) {
      const { updater } = fakeUpdater({ version });
      const updates = start(updater);
      await expect(updates.check(true)).resolves.toEqual({
        status: 'newest',
        version: '0.1.0',
      });
      expect(updates.state).toEqual({ status: 'idle' });
    }
    expect(published).toEqual([]);
  });

  it('never offers a version Lo isn’t released as', async () => {
    for (const version of ['v0.2.0', '0.2.0+build', '0.2.0/../../x', '9']) {
      const { updater } = fakeUpdater({ version });
      await expect(start(updater).check(true)).resolves.toMatchObject({
        status: 'newest',
      });
    }
    expect(published).toEqual([]);
  });

  it('takes back an offer the feed no longer makes', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    updater.check.mockResolvedValue({ version: '0.1.0', notes: null });
    await updates.check(false);
    expect(published).toEqual([OFFER, { status: 'idle' }]);
  });

  it('says why it failed when asked for, and only logs it otherwise', async () => {
    const { updater } = fakeUpdater();
    updater.check.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'));
    const updates = start(updater);
    await expect(updates.check(true)).resolves.toEqual({
      status: 'failed',
      reason:
        'Lo couldn’t reach GitHub (ERR_INTERNET_DISCONNECTED). Check your connection, then try again.',
    });
    await updates.check(false);
    expect(logged).toHaveLength(2);
    expect(published).toEqual([]);
  });

  it('is shared by every check asked for while it goes', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    const [first, second] = await Promise.all([updates.check(false), updates.check(true)]);
    expect(updater.check).toHaveBeenCalledTimes(1);
    expect(first).toEqual(OFFER);
    expect(second).toEqual(OFFER);
  });

  it('says why this copy of Lo doesn’t check', async () => {
    const updates = start({ unchecked: 'This copy of Lo isn’t a release.' });
    await expect(updates.check(true)).resolves.toEqual({
      status: 'failed',
      reason: 'This copy of Lo isn’t a release.',
    });
  });
});

describe('installing', () => {
  it('downloads nothing until asked to', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    await updates.check(true);
    await vi.runAllTimersAsync();
    expect(updater.download).not.toHaveBeenCalled();
    updates.install();
    expect(updater.download).toHaveBeenCalledTimes(1);
  });

  it('is refused where Lo doesn’t install updates itself, and downloads nothing', async () => {
    for (const how of ['move', 'brew', 'page'] as const) {
      const { updater } = fakeUpdater();
      const updates = start(updater, how);
      await updates.check(true);
      expect(() => updates.install()).toThrow(IpcError);
      expect(updater.download).not.toHaveBeenCalled();
    }
  });

  it('is refused with nothing on offer', () => {
    const { updater } = fakeUpdater();
    expect(() => start(updater).install()).toThrow('There’s no update to install.');
    expect(updater.download).not.toHaveBeenCalled();
  });

  it('says how the download goes, then that it’s ready, and never restarts by itself', async () => {
    const { updater, downloads } = fakeUpdater();
    const updates = start(updater);
    await updates.check(true);
    updates.install();
    downloads[0]?.progress(38, 112);
    downloads[0]?.done();
    await vi.runAllTimersAsync();
    expect(published).toEqual([
      OFFER,
      { status: 'downloading', version: '0.2.0', received: 0, total: 0 },
      { status: 'downloading', version: '0.2.0', received: 38, total: 112 },
      { status: 'ready', version: '0.2.0' },
    ]);
    expect(updater.install).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('goes back to the offer, with why, when the download fails, and tries again when asked', async () => {
    const { updater, downloads } = fakeUpdater();
    const updates = start(updater);
    await updates.check(true);
    updates.install();
    downloads[0]?.fail(Object.assign(new Error('HttpError: 503'), { statusCode: 503 }));
    await vi.runAllTimersAsync();
    expect(updates.state).toEqual({ ...OFFER, failed: 'GitHub answered 503. Try again later.' });
    updates.install();
    downloads[1]?.done();
    await vi.runAllTimersAsync();
    expect(updates.state).toEqual({ status: 'ready', version: '0.2.0' });
    expect(updater.install).not.toHaveBeenCalled();
  });

  it('makes no check while the update downloads or waits to install', async () => {
    const { updater, downloads } = fakeUpdater();
    const updates = start(updater);
    await updates.check(true);
    updates.install();
    await expect(updates.check(true)).resolves.toMatchObject({ status: 'downloading' });
    downloads[0]?.done();
    await vi.runAllTimersAsync();
    await expect(updates.check(true)).resolves.toEqual({ status: 'ready', version: '0.2.0' });
    expect(updater.check).toHaveBeenCalledTimes(1);
  });

  it('drops a download going as Lo stops, and says nothing after', async () => {
    const { updater, downloads } = fakeUpdater();
    const updates = start(updater);
    await updates.check(true);
    updates.install();
    updates.stop();
    expect(updater.cancel).toHaveBeenCalledTimes(1);
    downloads[0]?.fail(new Error('cancelled'));
    await vi.runAllTimersAsync();
    expect(published.at(-1)).toMatchObject({ status: 'downloading', received: 0 });
  });
});

/** Updates with 0.2.0 downloaded and ready. */
async function ready() {
  const { updater, downloads } = fakeUpdater();
  const updates = start(updater);
  await updates.check(true);
  updates.install();
  downloads[0]?.done();
  await vi.runAllTimersAsync();
  return { updater, updates };
}

describe('restarting', () => {
  it('happens only when asked, through Lo’s own quit', async () => {
    const { updater, updates } = await ready();
    // Lo quitting by itself installs the update then, and starts nothing.
    updates.willQuit(willQuit(true));
    updates.willQuit(willQuit(false));
    await vi.runAllTimersAsync();
    expect(updater.install).not.toHaveBeenCalled();
    updates.restart();
    expect(quit).toHaveBeenCalledTimes(1);
    expect(updater.install).not.toHaveBeenCalled();
  });

  it('hands over to the installer only after Lo’s stop, with no arguments', async () => {
    const { updater, updates } = await ready();
    updates.restart();
    // Lo's own listener holds off the first while every feature stops.
    const first = willQuit(true);
    updates.willQuit(first);
    await vi.runAllTimersAsync();
    expect(updater.install).not.toHaveBeenCalled();
    // The one it lets through is the last.
    const last = willQuit(false);
    updates.willQuit(last);
    expect(last.preventDefault).toHaveBeenCalledTimes(1);
    expect(updater.install).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.install).toHaveBeenCalledTimes(1);
    expect(updater.install).toHaveBeenCalledWith();
    // The installer quits Lo: the `will-quit` that brings goes through.
    const installer = willQuit(false);
    updates.willQuit(installer);
    expect(installer.preventDefault).not.toHaveBeenCalled();
  });

  it('quits all the same when the installer can’t, or doesn’t in time', async () => {
    const failing = await ready();
    failing.updater.install.mockRejectedValue(new Error('No update available'));
    failing.updates.restart();
    failing.updates.willQuit(willQuit(false));
    await vi.advanceTimersByTimeAsync(0);
    expect(quit).toHaveBeenCalledTimes(2);

    quit.mockClear();
    const slow = await ready();
    slow.updates.restart();
    slow.updates.willQuit(willQuit(false));
    await vi.advanceTimersByTimeAsync(INSTALL_LIMIT - 1);
    expect(quit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(quit).toHaveBeenCalledTimes(2);
  });

  it('is refused with nothing ready', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    expect(() => updates.restart()).toThrow('No update is ready to install.');
    await updates.check(true);
    expect(() => updates.restart()).toThrow('No update is ready to install.');
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('Later', () => {
  it('hides the update until Lo starts again, from the checks Lo makes by itself', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    updates.later();
    expect(updates.state).toEqual({ status: 'idle' });
    await updates.check(false);
    expect(updates.state).toEqual({ status: 'idle' });
    expect(published).toEqual([OFFER, { status: 'idle' }]);
  });

  it('hides nothing newer', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    updates.later();
    updater.check.mockResolvedValue({ version: '0.3.0', notes: '' });
    await updates.check(false);
    expect(updates.state).toMatchObject({ status: 'available', version: '0.3.0' });
  });

  it('gives way to a check asked for', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    updates.later();
    await expect(updates.check(true)).resolves.toEqual(OFFER);
    expect(updates.state).toEqual(OFFER);
  });

  it('is refused with nothing on offer', () => {
    const { updater } = fakeUpdater();
    expect(() => start(updater).later()).toThrow('There’s no update to hide.');
  });
});

describe('moving to Applications', () => {
  it('happens only where that’s how Lo takes an update', () => {
    const { updater } = fakeUpdater();
    start(updater, 'move').move();
    expect(move).toHaveBeenCalledTimes(1);
    for (const how of ['install', 'brew', 'page'] as const) {
      expect(() => start(updater, how).move()).toThrow(IpcError);
    }
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('says why when the move fails', () => {
    const { updater } = fakeUpdater();
    move.mockImplementation(() => {
      throw new Error('Failed to copy Lo.app');
    });
    expect(() => start(updater, 'move').move()).toThrow(
      'Lo couldn’t move itself to Applications: Failed to copy Lo.app',
    );
  });
});
