/**
 * Building a Go program from its modules, as Lo builds gopls: once, offline, with Lo's own Go, from
 * the module files Lo downloaded and checked against the manifest's hashes, laid out as a module
 * proxy in the build's own folder. Lo fetches them itself, through its downloader and the
 * manifest's hosts, rather than letting `go` fetch them: `go` would go around the system's proxy,
 * as Lo's downloads go through Chromium's network stack, and around the hosts Lo allows.
 *
 * - Go reaches no network: its module proxy is that folder (`GOPROXY=file://…`), with nothing to
 *   fetch directly and its checksum database off, and its other proxies lead nowhere. It checks
 *   each module against the `go.sum` Lo writes beside the `go.mod`, and with `-mod=readonly`,
 *   refuses one the `go.sum` doesn't list.
 * - Its environment is built from nothing, as a server's is: a home, a temporary folder and caches
 *   of its own, inside the build's folder; Lo's Go first on `PATH`; no `go.work` (`GOWORK=off`,
 *   which a `go.work` in a folder above would otherwise steer), no cgo, no flags and no settings
 *   file; and nothing of Lo's.
 * - It builds as pinning did, `-trimpath`, `CGO_ENABLED=0` and no version control stamp, so the
 *   program is the same file, byte for byte, wherever it's built: Go's builds are reproducible,
 *   and none of the build's paths are recorded in it. The installer refuses one whose hash isn't
 *   the one pinned.
 *
 * Nothing in the modules runs as they're built: Go compiles them, and no module can run a step of
 * its own (`go generate` is a command of its own, and cgo, which would run a C compiler, is off).
 */

import { spawn } from 'node:child_process';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { NO_NETWORK, SYSTEM_PATH } from './environment.ts';
import { DownloadError } from './errors.ts';
import type { Download, Platform } from './manifest.ts';

/** A Go program the manifest pins: the modules it's built from, and what it builds to. */
export type GoDownload = Extract<Download, { kind: 'go' }>;

/** Go's names for each platform's system and processor. */
export const GO_TARGETS: Readonly<
  Record<Platform, { readonly os: string; readonly arch: string }>
> = {
  'darwin-arm64': { os: 'darwin', arch: 'arm64' },
  'darwin-x64': { os: 'darwin', arch: 'amd64' },
  'linux-x64': { os: 'linux', arch: 'amd64' },
  'linux-arm64': { os: 'linux', arch: 'arm64' },
};

/** The longest a build may take, in milliseconds. Building gopls takes about a minute. */
export const BUILD_TIME = 20 * 60_000;

/** How much of what the build writes to stderr is kept, to say why it failed. */
const STDERR_KEPT = 16 * 1024;

export interface GoBuild {
  /** Lo's Go: the `go` program, by its absolute path, in its root's `bin`. */
  readonly go: string;
  readonly download: GoDownload;
  /**
   * The module files, checked, in the order `download.modules` lists them. They're moved into
   * the build's proxy.
   */
  readonly files: readonly string[];
  /**
   * An empty folder for the build, which the caller removes once it's done, and the installer
   * before it puts the version in place.
   */
  readonly folder: string;
  /** What it's built for. */
  readonly platform: Platform;
  readonly signal?: AbortSignal | undefined;
  /** How long it may take; {@link BUILD_TIME} unless given. */
  readonly time?: number | undefined;
}

/** Builds `options.download`'s program, as Lo does, and says where it is: inside the folder. */
export async function buildGo(options: GoBuild): Promise<string> {
  const { go, download, files, folder, platform, signal } = options;
  const proxy = join(folder, 'proxy');
  const module = join(folder, 'module');
  const home = join(folder, 'home');
  const out = join(folder, 'out', download.entry);
  for (const [index, part] of download.modules.entries()) {
    const file = files[index];
    if (file === undefined) throw new Error(`no file for ${part.path}`);
    const to = join(proxy, ...part.path.split('/'));
    await mkdir(dirname(to), { recursive: true });
    await rename(file, to);
  }
  for (const made of [module, join(home, 'tmp'), dirname(out)]) {
    await mkdir(made, { recursive: true });
  }
  await writeFile(join(module, 'go.mod'), `${download.mod.join('\n')}\n`);
  await writeFile(join(module, 'go.sum'), `${download.sum.join('\n')}\n`);
  const bin = dirname(go);
  const target = GO_TARGETS[platform];
  const env: Record<string, string> = {
    HOME: home,
    TMPDIR: join(home, 'tmp'),
    PATH: [bin, ...SYSTEM_PATH].join(':'),
    LANG: 'C.UTF-8',
    GOROOT: dirname(bin),
    GOTOOLCHAIN: 'local',
    GOENV: 'off',
    GOFLAGS: '',
    GOWORK: 'off',
    GO111MODULE: 'on',
    GOPROXY: `file://${proxy}`,
    GONOPROXY: '',
    GOPRIVATE: '',
    GOINSECURE: '',
    GOVCS: '*:off',
    GOSUMDB: 'off',
    GONOSUMDB: '',
    GOPATH: join(home, 'go'),
    GOMODCACHE: join(folder, 'modules'),
    GOCACHE: join(folder, 'cache'),
    CGO_ENABLED: '0',
    GOOS: target.os,
    GOARCH: target.arch,
    HTTPS_PROXY: NO_NETWORK,
    HTTP_PROXY: NO_NETWORK,
  };
  const args = [
    'build',
    '-trimpath',
    '-buildvcs=false',
    '-mod=readonly',
    // The build's module cache is deleted with its folder, which Go's read-only files would stop.
    '-modcacherw',
    '-o',
    out,
    download.package,
  ];
  await run(go, args, { cwd: module, env, signal, time: options.time ?? BUILD_TIME });
  return out;
}

/** Runs `program` in a process group of its own until it exits, and throws unless it succeeds. */
function run(
  program: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly signal: AbortSignal | undefined;
    readonly time: number;
  },
): Promise<void> {
  const { cwd, env, signal, time } = options;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      env: { ...env },
      shell: false,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => {
      stderr = (stderr + text).slice(-STDERR_KEPT);
    });
    let stopped: Error | undefined;
    // The compiler and linker it starts are in its group, and go with it.
    const stop = (why: Error) => {
      stopped ??= why;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // It's gone.
        }
      }
    };
    const timer = setTimeout(
      () =>
        stop(new DownloadError('build', `It took longer than ${time / 60_000} minutes to build.`)),
      time,
    );
    const aborted = () => stop(reasonOf(signal));
    signal?.addEventListener('abort', aborted, { once: true });
    let finished = false;
    const done = (error: Error | undefined) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (error === undefined) resolve();
      else reject(error);
    };
    child.on('error', (error) =>
      done(new DownloadError('build', `Go didn’t start: ${error.message}`)),
    );
    child.on('close', (code, killed) => {
      if (stopped !== undefined) return done(stopped);
      if (code === 0) return done(undefined);
      const last = stderr.trim().split('\n').at(-1) ?? '';
      const why = last === '' ? `it exited with ${code ?? killed ?? 'nothing'}` : last;
      return done(new DownloadError('build', `It didn’t build: ${why}`));
    });
  });
}

/** Why `signal` aborted, as an error. */
function reasonOf(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new Error(String(reason));
}
