// electron-updater's own code, its GitHub provider and its requests included, run against a feed on
// this machine: only what sends each request is the tests', Node's HTTP in place of Electron's
// `net`, which is out of reach under Node, and so is Electron's own updater, which
// electron-updater's updater for a Mac is made with.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createRequire, Module } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { UpdateInfo } from 'electron-updater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { feedFor, GITHUB_FEED, type Feed } from './feed.ts';
import {
  adapt,
  CheckingUpdater,
  configure,
  InstallingUpdater,
  NO_ID,
  SYSTEM_PATH,
  type LoUpdater,
} from './updater.ts';
import { CHECK_LIMIT, Updates } from './updates.ts';

/** What the feed was asked for: each request's path and headers. */
let asked: { path: string; headers: IncomingHttpHeaders }[];
/** The releases the feed has, newest first, by version. */
let releases: string[];
/** The release GitHub calls the latest, which is never a prerelease: none before the first. */
let latestRelease: string | undefined;
/** The Macs each release has a zip for, by architecture. */
let zips: string[];
/** A request the feed holds, which the test answers when it says. */
interface Holding {
  arrived(): void;
  dropped(): void;
  answer?: () => void;
}
/** The next request for each path the feed holds, by path. */
let held: Map<string, Holding>;
let server: Server;
let feed: Feed;
let folder: string;

/** GitHub's releases feed, with `releases`, newest first. */
function atom(port: number): string {
  const entries = releases.map(
    (version) => `  <entry>
    <id>tag:github.com,2008:Repository/1/v${version}</id>
    <updated>2026-11-19T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="http://127.0.0.1:${port}/withlo/lo/releases/tag/v${version}"/>
    <title>v${version}</title>
    <content type="html">&lt;h2&gt;Faster diffs&lt;/h2&gt;</content>
  </entry>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${entries.join('\n')}
</feed>`;
}

/** What each release's zip should hold, as its `latest-*.yml` says by size and SHA-512. */
const ZIP = 'hello';
/** What the feed serves as each release's zip: as long as {@link ZIP}, but not it. */
const SERVED_ZIP = 'hullo';

/** The `latest-*.yml` of the release of `version`, as electron-builder writes it. */
function latest(version: string): string {
  const sha512 = createHash('sha512').update(ZIP).digest('base64');
  return [
    `version: ${version}`,
    'files:',
    ...zips.flatMap((arch) => [
      `  - url: Lo-${version}-${arch}-mac.zip`,
      `    sha512: ${sha512}`,
      `    size: ${ZIP.length}`,
    ]),
    `path: Lo-${version}-${zips[0] ?? 'arm64'}-mac.zip`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-11-19T00:00:00.000Z'",
    '',
  ].join('\n');
}

/** The releases feed's path. */
const FEED = '/withlo/lo/releases.atom';
/** The path of GitHub's latest release, which only a reading of the feed for a release asks for. */
const LATEST = '/api/v3/repos/withlo/lo/releases/latest';

/**
 * Holds the next request for `path` unanswered: `arrived` once it has, `answer` answers it with
 * the releases as they are then, and `dropped` once it's closed unanswered.
 */
function hold(path: string): { arrived: Promise<void>; dropped: Promise<void>; answer(): void } {
  const arrived = Promise.withResolvers<void>();
  const dropped = Promise.withResolvers<void>();
  const holding: Holding = { arrived: arrived.resolve, dropped: dropped.resolve };
  held.set(path, holding);
  return {
    arrived: arrived.promise,
    dropped: dropped.promise,
    answer: () => holding.answer?.(),
  };
}

/** Answers the request for `path`, as GitHub would with the feed as it is now. */
function answer(path: string, response: ServerResponse): void {
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const yml = /^\/withlo\/lo\/releases\/download\/v([^/]+)\/latest[^/]*\.yml$/.exec(path);
  const zip = /^\/withlo\/lo\/releases\/download\/v([^/]+)\/Lo-\1-([a-z0-9]+)-mac\.zip$/.exec(path);
  if (path === FEED) {
    response.end(atom(port));
  } else if (path === LATEST && latestRelease) {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ tag_name: `v${latestRelease}` }));
  } else if (yml?.[1] !== undefined && releases.includes(yml[1])) {
    response.end(latest(yml[1]));
  } else if (zip?.[1] !== undefined && releases.includes(zip[1]) && zips.includes(zip[2] ?? '')) {
    response.end(SERVED_ZIP);
  } else {
    response.statusCode = 404;
    response.end();
  }
}

/**
 * Where electron-updater finds Electron, which its updater for a Mac requires as it's made, for
 * Squirrel.Mac's updater, and its requests require as they're sent, for Electron's `net`: here, a
 * stand-in, put in Node's module cache where it looks, which sends each request over Node's HTTP.
 */
const fromUpdater = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const electron = fromUpdater.resolve('electron');

beforeAll(() => {
  const standIn = new Module(electron);
  standIn.filename = electron;
  standIn.loaded = true;
  standIn.exports = {
    autoUpdater: new EventEmitter(),
    net: { request: (options: RequestOptions) => request(options) },
    session: { fromPartition: () => ({}) },
  };
  fromUpdater.cache[electron] = standIn;
});

afterAll(() => {
  delete fromUpdater.cache[electron];
});

beforeEach(async () => {
  asked = [];
  releases = ['0.2.0'];
  latestRelease = '0.2.0';
  zips = ['arm64'];
  held = new Map();
  folder = mkdtempSync(join(tmpdir(), 'lo-updater-'));
  server = createServer((incoming, response) => {
    const path = incoming.url ?? '';
    asked.push({ path, headers: incoming.headers });
    const holding = held.get(path);
    if (!holding) {
      answer(path, response);
      return;
    }
    held.delete(path);
    holding.answer = () => answer(path, response);
    response.once('close', () => {
      if (!response.writableEnded) holding.dropped();
    });
    holding.arrived();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('The feed has no port.');
  const found = feedFor({
    packaged: false,
    resources: folder,
    exists: () => false,
    env: { LO_UPDATES_FEED: `http://127.0.0.1:${address.port}/` },
  });
  if (!('feed' in found)) throw new Error('The feed on this machine was refused.');
  feed = found.feed;
  // Whoever runs Lo may have these set, for gh or the GitHub CLI tools.
  vi.stubEnv('GH_TOKEN', 'ghp_fromtheenvironment');
  vi.stubEnv('GITHUB_TOKEN', 'ghs_fromtheenvironment');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(folder, { recursive: true, force: true });
});

/** The requests electron-updater has sent that haven't settled. */
const pending = new Set<Promise<unknown>>();

/** Waits until electron-updater has no request going, and has done what their answers lead to. */
async function quiet(): Promise<void> {
  for (;;) {
    // A turn of the event loop, by which each answer's work is done, and any request it sends sent.
    await new Promise((resolve) => setImmediate(resolve));
    if (pending.size === 0) return;
    await Promise.allSettled(pending);
  }
}

/** The app electron-updater's updaters are given, at `version`. */
function appAt(version: string) {
  return {
    version,
    name: 'Lo',
    isPackaged: true,
    appUpdateConfigPath: join(folder, 'app-update.yml'),
    userDataPath: folder,
    baseCachePath: folder,
    whenReady: () => Promise.resolve(),
    relaunch: () => {},
    quit: () => {},
    onQuit: () => {},
  };
}

/**
 * `updater`, with what electron-updater makes to send its requests under Electron, which its types
 * leave out: given an app of its own, as here, electron-updater makes none.
 */
function asUnderElectron<U extends LoUpdater>(updater: U): U {
  Object.assign(updater, { httpExecutor: new ElectronHttpExecutor() });
  return updater;
}

/** The updater a copy of Lo that doesn't install updates itself uses, at `version`. */
function checkingUpdater(version = '0.1.0'): CheckingUpdater {
  return asUnderElectron(new CheckingUpdater(appAt(version)));
}

/** The updater a copy of Lo that installs updates itself uses, at `version`. */
function installingUpdater(version = '0.1.0'): InstallingUpdater {
  return asUnderElectron(new InstallingUpdater(appAt(version)));
}

/** Each of Lo's updaters, by name, at `version`. */
const updaters = [
  ['checking', checkingUpdater],
  ['installing', installingUpdater],
] as const;

/** `updater` set up as Lo sets it up, to check the feed on this machine, logging to `log`. */
function configured<U extends LoUpdater>(
  updater: U,
  installs = false,
  log: (line: string) => void = () => {},
): U {
  configure(updater, { feed, installs, log });
  // Each request it sends, as the provider sends it, followed until it settles.
  const executor: unknown = Reflect.get(updater, 'httpExecutor');
  if (!(executor instanceof ElectronHttpExecutor))
    throw new Error('electron-updater sends nothing.');
  const send = executor.request.bind(executor);
  Object.assign(executor, {
    request(...sent: Parameters<typeof send>): Promise<string | null> {
      const sending = send(...sent);
      pending.add(sending);
      const done = () => pending.delete(sending);
      sending.then(done, done);
      return sending;
    },
  });
  return updater;
}

/** What a prerelease of Lo at `current` finds, as each of Lo's updaters. */
async function findAs(current: string): Promise<string[]> {
  const versions: string[] = [];
  for (const [, made] of updaters) {
    versions.push((await adapt(configured(made(current))).check(never)).version);
  }
  return versions;
}

/** A signal that never gives up. */
const never = new AbortController().signal;

describe('checking', () => {
  it('reads the releases of withlo/lo, and offers the newest', async () => {
    const release = await adapt(configured(checkingUpdater())).check(never);
    expect(release).toEqual({ version: '0.2.0', notes: '<h2>Faster diffs</h2>' });
    expect(asked.map(({ path }) => path)).toEqual([
      '/withlo/lo/releases.atom',
      '/api/v3/repos/withlo/lo/releases/latest',
      expect.stringMatching(
        /^\/withlo\/lo\/releases\/download\/v0\.2\.0\/latest(?:-[a-z0-9-]+)?\.yml$/,
      ),
    ]);
  });

  it('sends no token, nor any Authorization, whatever GH_TOKEN and GITHUB_TOKEN hold', async () => {
    // Whether or not the check goes through, no request it made may carry one.
    await adapt(configured(checkingUpdater()))
      .check(never)
      .catch(() => undefined);
    expect(asked.length).toBeGreaterThan(0);
    for (const { headers } of asked) {
      expect(headers.authorization).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('fromtheenvironment');
    }
  });

  it.each(updaters)(
    'sends the same id as every copy of Lo, and keeps none of its own (%s)',
    async (_name, made) => {
      await adapt(configured(made())).check(never);
      expect(new Set(asked.map(({ headers }) => headers['x-user-staging-id']))).toEqual(
        new Set([NO_ID]),
      );
      expect(readdirSync(folder)).toEqual([]);
    },
  );

  it('downloads nothing, however new the release', async () => {
    const updater = configured(checkingUpdater());
    const downloading = vi.spyOn(updater, 'downloadUpdate');
    const result = await updater.checkForUpdates();
    expect(result?.isUpdateAvailable).toBe(true);
    expect(result?.downloadPromise).toBeNull();
    expect(downloading).not.toHaveBeenCalled();
  });

  it('never takes an older version for an update', async () => {
    releases = ['0.1.0'];
    latestRelease = '0.1.0';
    const updater = checkingUpdater('0.2.0');
    // As electron-updater sets it for itself when a channel is set.
    updater.allowDowngrade = true;
    const result = await configured(updater).checkForUpdates();
    expect(result?.isUpdateAvailable).toBe(false);
  });
});

describe('for a prerelease of Lo', () => {
  it('offers the release of its version once it’s out', async () => {
    releases = ['0.1.0', '0.1.0-rc.1'];
    latestRelease = '0.1.0';
    expect(await findAs('0.1.0-rc.1')).toEqual(['0.1.0', '0.1.0']);
  });

  it('offers a later release, and a later prerelease when that’s newer', async () => {
    releases = ['0.2.0', '0.1.0-rc.2', '0.1.0-rc.1'];
    latestRelease = '0.2.0';
    expect(await findAs('0.1.0-rc.1')).toEqual(['0.2.0', '0.2.0']);
    releases = ['0.2.0-rc.1', '0.1.0', '0.1.0-rc.1'];
    latestRelease = '0.1.0';
    expect(await findAs('0.1.0-rc.1')).toEqual(['0.2.0-rc.1', '0.2.0-rc.1']);
  });

  it('offers the next prerelease before any release is out', async () => {
    releases = ['0.1.0-rc.2', '0.1.0-rc.1'];
    latestRelease = undefined;
    expect(await findAs('0.1.0-rc.1')).toEqual(['0.1.0-rc.2', '0.1.0-rc.2']);
  });

  it('downloads what it offers', async () => {
    releases = ['0.1.0', '0.1.0-rc.1'];
    latestRelease = '0.1.0';
    const lines: string[] = [];
    const updater = configured(checkingUpdater('0.1.0-rc.1'), false, (line) => lines.push(line));
    const result = await updater.checkUntil(never);
    expect(result?.isUpdateAvailable).toBe(true);
    expect(result?.updateInfo.version).toBe('0.1.0');
    await updater.downloadUpdate().catch(() => undefined);
    expect(lines).toContain('Downloading update from Lo-0.1.0-arm64-mac.zip');
    // As electron-updater decides it, for checks that read the feed once.
    expect(updater.allowPrerelease).toBe(true);
  });
});

/** Each value `updater.allowPrerelease` is set to from now on, in order. */
function switches(updater: LoUpdater): boolean[] {
  const values: boolean[] = [];
  let allowed = updater.allowPrerelease;
  Object.defineProperty(updater, 'allowPrerelease', {
    get: () => allowed,
    set: (value: boolean) => {
      values.push(value);
      allowed = value;
    },
  });
  return values;
}

describe('a check Lo gives up on', () => {
  it('fails at once, and the next asks the feed again', async () => {
    const adapted = adapt(configured(checkingUpdater()));
    const feedHeld = hold(FEED);
    const giveUp = new AbortController();
    const first = adapted.check(giveUp.signal);
    await feedHeld.arrived;
    giveUp.abort(new Error('Lo gave up.'));
    await expect(first).rejects.toThrow('Lo gave up.');
    await expect(adapted.check(never)).resolves.toMatchObject({ version: '0.2.0' });
    expect(asked.filter(({ path }) => path === FEED)).toHaveLength(2);
  });

  it('leaves no request open once the feed has taken too long to answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const updates = new Updates({
        current: '0.1.0',
        how: () => 'page',
        updater: adapt(configured(checkingUpdater())),
        publish: () => {},
        log: () => {},
        quit: () => {},
        move: () => Promise.resolve(false),
      });
      const feedHeld = hold(FEED);
      const checking = updates.check(true);
      await feedHeld.arrived;
      expect(pending.size).toBe(1);
      vi.advanceTimersByTime(CHECK_LIMIT);
      await expect(checking).resolves.toEqual({ status: 'failed', why: 'timeout' });
      // Cancelled as Lo gave up on it: it failed, and the feed saw it closed, unanswered.
      await new Promise((resolve) => setImmediate(resolve));
      expect(pending.size).toBe(0);
      await feedHeld.dropped;
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails at once all the same where Lo leaves electron-updater’s requests be', async () => {
    // What a later electron-updater might send its requests with: not the executor Lo knows.
    const theirs = new (class extends ElectronHttpExecutor {})();
    const lines: string[] = [];
    const updater = configured(
      Object.assign(checkingUpdater(), { httpExecutor: theirs }),
      false,
      (line) => lines.push(line),
    );
    expect(Reflect.get(updater, 'httpExecutor')).toBe(theirs);
    expect(lines).toContainEqual(expect.stringContaining('so Lo leaves them be'));
    const feedHeld = hold(FEED);
    const giveUp = new AbortController();
    const first = updater.checkUntil(giveUp.signal);
    await feedHeld.arrived;
    giveUp.abort(new Error('Lo gave up.'));
    await expect(first).rejects.toThrow('Lo gave up.');
    // Its request isn't cancelled, so the feed's answer ends it.
    feedHeld.answer();
    await quiet();
  });

  it('asks the feed nothing once given up on, though electron-updater goes on to read it', async () => {
    const giveUp = new AbortController();
    giveUp.abort(new Error('Lo gave up.'));
    const updater = configured(checkingUpdater());
    await expect(updater.checkUntil(giveUp.signal)).rejects.toThrow('Lo gave up.');
    await quiet();
    expect(asked).toEqual([]);
  });

  it.each([
    ['its channel’s newest prerelease', FEED],
    ['the newest release', LATEST],
  ])(
    'switches allowPrerelease no more, given up on as it reads the feed for %s',
    async (_reading, path) => {
      releases = ['0.1.0', '0.1.0-rc.1'];
      latestRelease = '0.1.0';
      const updater = configured(checkingUpdater('0.1.0-rc.1'));
      const requestHeld = hold(path);
      const giveUp = new AbortController();
      const first = updater.checkUntil(giveUp.signal);
      await requestHeld.arrived;
      const switched = switches(updater);
      giveUp.abort(new Error('Lo gave up.'));
      await expect(first).rejects.toThrow('Lo gave up.');
      // Answered, should the request still be open, so the reading goes on either way.
      requestHeld.answer();
      await quiet();
      expect(switched).toEqual([]);
    },
  );

  it('changes nothing when the feed answers it after all', async () => {
    const lines: string[] = [];
    const updater = configured(checkingUpdater(), false, (line) => lines.push(line));
    const offered: string[] = [];
    updater.on('update-available', (info: UpdateInfo) => offered.push(info.version));
    const feedHeld = hold(FEED);
    const giveUp = new AbortController();
    const first = updater.checkUntil(giveUp.signal);
    await feedHeld.arrived;
    giveUp.abort(new Error('Lo gave up.'));
    await expect(first).rejects.toThrow('Lo gave up.');
    await updater.checkUntil(never);
    // The feed has a newer release by the time it answers the check Lo gave up on, whose request
    // was cancelled, so the answer reaches nothing.
    releases = ['0.3.0', '0.2.0'];
    latestRelease = '0.3.0';
    feedHeld.answer();
    await quiet();
    expect(asked.map(({ path }) => path)).not.toContainEqual(
      expect.stringMatching(/\/download\/v0\.3\.0\/latest[^/]*\.yml$/),
    );
    expect(offered).toEqual(['0.2.0']);
    await updater.downloadUpdate().catch(() => undefined);
    expect(lines).toContain('Downloading update from Lo-0.2.0-arm64-mac.zip');
  });
});

describe('downloading where Lo installs updates itself', () => {
  it('refuses a zip whose SHA-512 isn’t the one its release gives', async () => {
    // A zip for each Mac, so this one finds its own.
    zips = ['arm64', 'x64'];
    // As a release of Lo carries it, naming the folder its downloads go in.
    writeFileSync(join(folder, 'app-update.yml'), 'updaterCacheDirName: lo-updater\n');
    const updater = configured(installingUpdater(), true);
    await updater.checkUntil(never);
    await expect(updater.downloadUpdate()).rejects.toMatchObject({
      code: 'ERR_CHECKSUM_MISMATCH',
    });
    expect(asked.map(({ path }) => path)).toContainEqual(
      expect.stringMatching(/\/download\/v0\.2\.0\/Lo-0\.2\.0-(?:arm64|x64)-mac\.zip$/),
    );
  });

  it('runs the system’s own sysctl and uname to choose the zip, whatever PATH holds', async () => {
    // A `sysctl` and an `uname` that say "ARM", as ones planted to pick the other zip would.
    const planted = mkdtempSync(join(tmpdir(), 'lo-path-'));
    try {
      for (const name of ['sysctl', 'uname']) {
        writeFileSync(join(planted, name), '#!/bin/sh\ntouch "$0.ran"\necho ARM\n');
        chmodSync(join(planted, name), 0o755);
      }
      const path = `${planted}${delimiter}${process.env.PATH ?? ''}`;
      vi.stubEnv('PATH', path);
      // electron-updater logs what each program said as it runs them.
      const during = new Set<string | undefined>();
      const updater = configured(installingUpdater(), true, (line) => {
        if (/sysctl|uname/.test(line)) during.add(process.env.PATH);
      });
      await updater.checkUntil(never);
      const download = updater.downloadUpdate();
      expect(during).toEqual(new Set([SYSTEM_PATH]));
      // Set back before the download first waits.
      expect(process.env.PATH).toBe(path);
      // There's no zip to be had here.
      await download.catch(() => undefined);
      expect(readdirSync(planted).filter((name) => name.endsWith('.ran'))).toEqual([]);
    } finally {
      rmSync(planted, { recursive: true, force: true });
    }
  });
});

describe('setting electron-updater up', () => {
  it('downloads only when asked, offers no downgrade, reads only the newest notes', () => {
    const updater = checkingUpdater('0.1.0-rc.1');
    updater.allowDowngrade = true;
    updater.fullChangelog = true;
    configure(updater, { feed: GITHUB_FEED, installs: false, log: () => {} });
    expect(updater.autoDownload).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.fullChangelog).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    // Prereleases are offered to a prerelease only, as electron-updater decides.
    expect(updater.allowPrerelease).toBe(true);
    expect(checkingUpdater('0.1.0').allowPrerelease).toBe(false);
  });

  it('installs a downloaded update as Lo quits, where Lo installs updates itself', () => {
    const updater = checkingUpdater();
    configure(updater, { feed: GITHUB_FEED, installs: true, log: () => {} });
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('checks github.com from a packaged Lo, and the feed on this machine from source', () => {
    const packaged = checkingUpdater();
    configure(packaged, { feed: GITHUB_FEED, installs: false, log: () => {} });
    expect(packaged.forceDevUpdateConfig).toBe(false);
    expect(configured(checkingUpdater()).forceDevUpdateConfig).toBe(true);
  });

  it('logs to Lo’s log', async () => {
    const lines: string[] = [];
    const updater = checkingUpdater();
    configure(updater, { feed, installs: false, log: (line) => lines.push(line) });
    await updater.checkForUpdates();
    expect(lines).toContain('Checking for update');
  });
});

describe('as the updates feature uses it', () => {
  it('downloads with a token it can cancel, says how far it got, and waits for Squirrel', async () => {
    const updater = configured(checkingUpdater());
    let finish: (() => void) | undefined;
    const downloading = vi.spyOn(updater, 'downloadUpdate').mockImplementation(async (token) => {
      updater.emit('download-progress', {
        total: 112,
        delta: 38,
        transferred: 38,
        percent: 34,
        bytesPerSecond: 1,
      });
      await new Promise<void>((resolve) => {
        finish = resolve;
        token?.once('cancel', () => resolve());
      });
      return [];
    });
    let ready: (() => void) | undefined;
    const stopped = vi.fn<() => void>();
    const squirrel = {
      listen: vi.fn<(onReady: () => void) => () => void>((onReady) => {
        ready = onReady;
        return stopped;
      }),
    };
    const progress = vi.fn<(received: number, total: number) => void>();
    const adapted = adapt(updater, squirrel);
    let done = false;
    const download = adapted.download(progress).then(() => (done = true));
    expect(squirrel.listen).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(38, 112);
    finish?.();
    await vi.waitFor(() => expect(downloading).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(done).toBe(false);
    ready?.();
    await download;
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(updater.listenerCount('download-progress')).toBe(0);
  });

  it('fails a download Squirrel won’t take', async () => {
    const updater = configured(checkingUpdater());
    vi.spyOn(updater, 'downloadUpdate').mockResolvedValue([]);
    const squirrel = {
      listen: (_ready: () => void, failed: (error: Error) => void) => {
        queueMicrotask(() => failed(new Error('did not pass validation: code requirement')));
        return () => {};
      },
    };
    await expect(adapt(updater, squirrel).download(() => {})).rejects.toThrow('code requirement');
  });

  it('cancels the download going', async () => {
    const updater = configured(checkingUpdater());
    let cancelled = false;
    vi.spyOn(updater, 'downloadUpdate').mockImplementation(
      (token) =>
        new Promise((_resolve, reject) => {
          token?.once('cancel', () => {
            cancelled = true;
            reject(new Error('cancelled'));
          });
        }),
    );
    const adapted = adapt(updater);
    const download = adapted.download(() => {});
    adapted.cancel();
    await expect(download).rejects.toThrow('cancelled');
    expect(cancelled).toBe(true);
  });

  it('installs with electron-updater’s quitAndInstall, with no arguments, and says when it fails', async () => {
    const updater = configured(checkingUpdater());
    const installing = vi.spyOn(updater, 'quitAndInstall').mockImplementation(() => {
      queueMicrotask(() => updater.emit('error', new Error('No update available')));
    });
    await expect(adapt(updater).install()).rejects.toThrow('No update available');
    expect(installing).toHaveBeenCalledWith();
  });
});
