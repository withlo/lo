// electron-updater's own code, its GitHub provider included, run against a feed on this machine:
// only how it sends requests is the tests', since Electron's is out of reach under Node.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { feedFor, GITHUB_FEED, type Feed } from './feed.ts';
import { adapt, CheckingUpdater, configure, NO_ID } from './updater.ts';

/** What the feed was asked for: each request's path and headers. */
let asked: { path: string; headers: IncomingHttpHeaders }[];
/** The version the feed's newest release has. */
let offered: string;
let server: Server;
let feed: Feed;
let folder: string;

/** GitHub's releases feed, with one release: `offered`'s. */
function atom(port: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/v${offered}</id>
    <updated>2026-11-19T00:00:00Z</updated>
    <link rel="alternate" type="text/html" href="http://127.0.0.1:${port}/withlo/lo/releases/tag/v${offered}"/>
    <title>v${offered}</title>
    <content type="html">&lt;h2&gt;Faster diffs&lt;/h2&gt;</content>
  </entry>
</feed>`;
}

/** The release's `latest-*.yml`, as electron-builder writes it. */
function latest(): string {
  return [
    `version: ${offered}`,
    'files:',
    `  - url: Lo-${offered}-arm64-mac.zip`,
    '    sha512: aGVsbG8=',
    '    size: 5',
    `path: Lo-${offered}-arm64-mac.zip`,
    'sha512: aGVsbG8=',
    "releaseDate: '2026-11-19T00:00:00.000Z'",
    '',
  ].join('\n');
}

beforeEach(async () => {
  asked = [];
  offered = '0.2.0';
  folder = mkdtempSync(join(tmpdir(), 'lo-updater-'));
  server = createServer((incoming, response) => {
    const path = incoming.url ?? '';
    asked.push({ path, headers: incoming.headers });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    if (path === '/withlo/lo/releases.atom') {
      response.end(atom(port));
    } else if (path === '/api/v3/repos/withlo/lo/releases/latest') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ tag_name: `v${offered}` }));
    } else if (/^\/withlo\/lo\/releases\/download\/v[^/]+\/latest[^/]*\.yml$/.test(path)) {
      response.end(latest());
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('The feed has no port.');
  const found = feedFor({
    packaged: false,
    configured: false,
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
  await new Promise((resolve) => server.close(resolve));
  rmSync(folder, { recursive: true, force: true });
});

/** The parts of electron-updater's request options a request takes over Node. */
interface Sent {
  hostname?: string;
  port?: string | number;
  path?: string;
  headers?: Record<string, string | string[] | number>;
}

/** electron-updater's requests, over Node's HTTP in place of Electron's. */
const nodeRequests = {
  request(options: Sent): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const sent = request(
        {
          hostname: options.hostname,
          port: options.port,
          path: options.path,
          headers: options.headers,
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () => {
            const status = response.statusCode ?? 0;
            if (status >= 400) {
              reject(Object.assign(new Error(`HttpError: ${status}`), { statusCode: status }));
            } else {
              resolve(body === '' ? null : body);
            }
          });
        },
      );
      sent.on('error', reject);
      sent.end();
    });
  },
};

/** The updater a copy of Lo that doesn't install updates itself uses, at `version`. */
function checkingUpdater(version = '0.1.0'): CheckingUpdater {
  const updater = new CheckingUpdater({
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
  });
  // Given an app of its own, electron-updater has no way to send requests until it's given one.
  Object.assign(updater, { httpExecutor: nodeRequests });
  return updater;
}

/** `updater` set up as Lo sets it up, to check the feed on this machine. */
function configured<U extends CheckingUpdater>(updater: U, installs = false): U {
  configure(updater, { feed, installs, log: () => {} });
  return updater;
}

describe('checking', () => {
  it('reads the releases of withlo/lo, and offers the newest', async () => {
    const release = await adapt(configured(checkingUpdater())).check();
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
      .check()
      .catch(() => undefined);
    expect(asked.length).toBeGreaterThan(0);
    for (const { headers } of asked) {
      expect(headers.authorization).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('fromtheenvironment');
    }
  });

  it('sends the same id as every copy of Lo, and keeps none of its own', async () => {
    await adapt(configured(checkingUpdater())).check();
    expect(new Set(asked.map(({ headers }) => headers['x-user-staging-id']))).toEqual(
      new Set([NO_ID]),
    );
    expect(readdirSync(folder)).toEqual([]);
  });

  it('downloads nothing, however new the release', async () => {
    const updater = configured(checkingUpdater());
    const downloading = vi.spyOn(updater, 'downloadUpdate');
    const result = await updater.checkForUpdates();
    expect(result?.isUpdateAvailable).toBe(true);
    expect(result?.downloadPromise).toBeNull();
    expect(downloading).not.toHaveBeenCalled();
  });

  it('never takes an older version for an update', async () => {
    offered = '0.1.0';
    const updater = checkingUpdater('0.2.0');
    // As electron-updater sets it for itself when a channel is set.
    updater.allowDowngrade = true;
    const result = await configured(updater).checkForUpdates();
    expect(result?.isUpdateAvailable).toBe(false);
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
