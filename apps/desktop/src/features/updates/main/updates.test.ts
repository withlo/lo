import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { How, UpdateState } from '../contract.ts';
import {
  CHECK_LIMIT,
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
let move: ReturnType<typeof vi.fn<(window: number | undefined) => Promise<boolean>>>;
let logged: string[];

beforeEach(() => {
  vi.useFakeTimers();
  published = [];
  quit = vi.fn<() => void>();
  move = vi.fn<(window: number | undefined) => Promise<boolean>>(() => Promise.resolve(true));
  logged = [];
});

afterEach(() => {
  vi.useRealTimers();
});

/** Updates, for this Lo at 0.1.0, which takes an update as `how` says, each time it's asked. */
function start(
  updater: UpdatesOptions['updater'],
  how: How | (() => How) = 'install',
  current = '0.1.0',
): Updates {
  return new Updates({
    current,
    how: typeof how === 'function' ? how : () => how,
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
    const answer = await start(updater, 'install', '0.2.0-rc.1').check(true);
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

  it('never offers a prerelease to a release, whatever GitHub calls its latest', async () => {
    for (const version of ['0.2.0-rc.1', '1.0.0-rc.1']) {
      const { updater } = fakeUpdater({ version });
      const updates = start(updater);
      await expect(updates.check(true)).resolves.toEqual({ status: 'newest', version: '0.1.0' });
      expect(updates.state).toEqual({ status: 'idle' });
    }
    expect(published).toEqual([]);
  });

  it('offers a prerelease the release of its version, a later one, and later prereleases', async () => {
    for (const version of ['0.1.0', '0.2.0', '0.1.0-rc.2', '0.2.0-rc.1']) {
      const { updater } = fakeUpdater({ version });
      await expect(start(updater, 'install', '0.1.0-rc.1').check(true)).resolves.toMatchObject({
        status: 'available',
        version,
      });
    }
    for (const version of ['0.1.0-rc.1', '0.1.0-beta.2', '0.0.9']) {
      const { updater } = fakeUpdater({ version });
      await expect(start(updater, 'install', '0.1.0-rc.1').check(true)).resolves.toEqual({
        status: 'newest',
        version: '0.1.0-rc.1',
      });
    }
  });

  it('takes back an offer when the feed’s newest is a prerelease this Lo won’t take', async () => {
    const { updater } = fakeUpdater();
    const updates = start(updater);
    await updates.check(false);
    // electron-updater would now download the prerelease, so the offer can't stand.
    updater.check.mockResolvedValue({ version: '0.3.0-rc.1', notes: null });
    await updates.check(false);
    expect(published).toEqual([OFFER, { status: 'idle' }]);
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
      why: 'offline',
      details: 'ERR_INTERNET_DISCONNECTED',
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

  it('decides again how this copy of Lo takes the update, for each offer', async () => {
    const { updater } = fakeUpdater();
    let how: How = 'move';
    const updates = start(updater, () => how);
    await updates.check(true);
    how = 'page';
    await expect(updates.check(true)).resolves.toEqual({ ...OFFER, how: 'page' });
    expect(published).toEqual([
      { ...OFFER, how: 'move' },
      { ...OFFER, how: 'page' },
    ]);
  });

  it('says why this copy of Lo doesn’t check', async () => {
    for (const unchecked of ['unreleased', 'source'] as const) {
      const updates = start({ unchecked });
      await expect(updates.check(true)).resolves.toEqual({ status: 'failed', why: unchecked });
    }
  });
});

/** An updater whose first check the feed never answers, until the test says, and others do. */
function unanswered() {
  const { updater } = fakeUpdater();
  const signals: AbortSignal[] = [];
  let answer: ((release: Release) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  updater.check.mockImplementationOnce((signal) => {
    signals.push(signal);
    return new Promise<Release>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    });
  });
  return {
    updater,
    signals,
    answer: (release: Release) => answer?.(release),
    fail: (error: Error) => fail?.(error),
  };
}

describe('a check the feed doesn’t answer', () => {
  it('is given up on after a while, and the next check asks the feed again', async () => {
    const { updater, signals } = unanswered();
    const updates = start(updater);
    // A check Lo makes by itself, then one the reader asks for meanwhile, which shares it.
    const timed = updates.check(false);
    const asked = updates.check(true);
    await vi.advanceTimersByTimeAsync(CHECK_LIMIT - 1);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const failed = { status: 'failed', why: 'timeout' };
    await expect(timed).resolves.toEqual(failed);
    await expect(asked).resolves.toEqual(failed);
    // The updater is told to drop it.
    expect(signals[0]?.aborted).toBe(true);
    expect(logged).toContain("couldn't check for updates: timeout");
    // A day later, as at any time after, a check asks the feed again, and gets its answer.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    await expect(updates.check(true)).resolves.toEqual(OFFER);
    expect(updater.check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('changes nothing when its answer comes after all', async () => {
    const late = unanswered();
    const updates = start(late.updater);
    const given = updates.check(true);
    await vi.advanceTimersByTimeAsync(CHECK_LIMIT);
    await given;
    await updates.check(true);
    late.answer({ version: '0.3.0', notes: '<p>Too late.</p>' });
    await vi.runAllTimersAsync();
    expect(updates.state).toEqual(OFFER);
    expect(published).toEqual([OFFER]);

    // Nor when it fails after all, while the next check goes: that one is still shared.
    const failing = unanswered();
    const other = start(failing.updater);
    const abandoned = other.check(true);
    await vi.advanceTimersByTimeAsync(CHECK_LIMIT);
    await abandoned;
    const answering = Promise.withResolvers<Release>();
    failing.updater.check.mockImplementationOnce(() => answering.promise);
    const next = other.check(true);
    failing.fail(new Error('net::ERR_CONNECTION_RESET'));
    await vi.advanceTimersByTimeAsync(0);
    const shared = other.check(false);
    answering.resolve({ version: '0.2.0', notes: '<h2>Faster diffs</h2>' });
    await expect(next).resolves.toEqual(OFFER);
    await expect(shared).resolves.toEqual(OFFER);
    expect(failing.updater.check).toHaveBeenCalledTimes(2);
  });

  it('is dropped as Lo stops', async () => {
    const { updater, signals } = unanswered();
    const updates = start(updater);
    const checking = updates.check(true);
    updates.stop();
    await expect(checking).resolves.toEqual({ status: 'failed', why: 'quitting' });
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
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
    expect(() => start(updater).install()).toThrow('No update available');
    expect(updater.download).not.toHaveBeenCalled();
  });

  it('decides again how this copy of Lo takes the update, as Lo may have been moved', async () => {
    const { updater } = fakeUpdater();
    let how: How = 'install';
    const updates = start(updater, () => how);
    await updates.check(true);
    how = 'page';
    expect(() => updates.install()).toThrow('This copy of Lo can’t update itself');
    expect(updater.download).not.toHaveBeenCalled();
    expect(updates.state).toEqual({ ...OFFER, how: 'page' });
    expect(published).toEqual([OFFER, { ...OFFER, how: 'page' }]);
    // And the other way.
    how = 'install';
    updates.install();
    expect(updater.download).toHaveBeenCalledTimes(1);
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
    expect(updates.state).toEqual({ ...OFFER, failed: { why: 'github', details: '503' } });
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
    expect(() => updates.restart()).toThrow('No update is ready');
    await updates.check(true);
    expect(() => updates.restart()).toThrow('No update is ready');
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
    expect(() => start(updater).later()).toThrow('No update available');
  });
});

describe('moving to Applications', () => {
  it('happens only where that’s how Lo takes an update, asking in the window that asked', async () => {
    const { updater } = fakeUpdater();
    await start(updater, 'move').move(7);
    expect(move).toHaveBeenCalledExactlyOnceWith(7);
    for (const how of ['install', 'brew', 'page'] as const) {
      await expect(start(updater, how).move(7)).rejects.toThrow(IpcError);
    }
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('decides again whether it can, as Lo may have been moved', async () => {
    const { updater } = fakeUpdater();
    let how: How = 'move';
    const updates = start(updater, () => how);
    await updates.check(true);
    how = 'page';
    await expect(updates.move()).rejects.toThrow('This copy of Lo can’t be moved');
    expect(move).not.toHaveBeenCalled();
    expect(updates.state).toEqual({ ...OFFER, how: 'page' });
    how = 'install';
    await expect(updates.move()).rejects.toThrow('Already in Applications');
    expect(updates.state).toEqual(OFFER);
    how = 'move';
    await updates.move();
    expect(move).toHaveBeenCalledTimes(1);
  });

  it('says how it takes an update with none on offer, decided each time it’s asked', () => {
    const { updater } = fakeUpdater();
    let how: How = 'move';
    const updates = start(updater, () => how);
    expect(updates.howNow()).toBe('move');
    how = 'brew';
    expect(updates.howNow()).toBe('brew');
    how = 'page';
    expect(updates.howNow()).toBe('page');
    expect(updates.state).toEqual({ status: 'idle' });
  });

  it('says an offer’s new way when it’s asked how, as it does when it moves', async () => {
    const { updater } = fakeUpdater();
    let how: How = 'install';
    const updates = start(updater, () => how);
    await updates.check(true);
    how = 'move';
    expect(updates.howNow()).toBe('move');
    expect(updates.state).toEqual({ ...OFFER, how: 'move' });
  });

  it('says why when the move fails', async () => {
    const { updater } = fakeUpdater();
    move.mockRejectedValue(new Error('Failed to copy Lo.app'));
    // Main's own words, as the window shows them behind Details.
    await expect(start(updater, 'move').move()).rejects.toThrow(
      expect.objectContaining({ code: 'failed', message: 'Failed to copy Lo.app' }),
    );
  });
});
