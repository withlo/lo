// A Go program Lo builds from its modules, as it does gopls, and how `pin.ts` records one: the
// module files its build reads, each fetched from proxy.golang.org as Lo would and pinned by its
// SHA-256, the `go.mod` and `go.sum` Lo builds in, and the program Lo's build makes for each
// platform, by its size and SHA-256.
//
// - Resolving: Lo's own Go, from toolchains.json and installed as Lo installs it, makes a module
//   that requires the program as a tool (`go get -tool`, then `go mod tidy`), from an empty
//   `go.sum`, with Go's checksum database on (`GOSUMDB=sum.golang.org`), so each module's hash is
//   one the database lists, which Go checks before it writes the module's line. Go fetches these
//   itself, as npm does when sources.ts resolves an npm package, and runs nothing it fetches.
// - Narrowing: for each platform, Lo's Go builds the program offline from what that fetched, into
//   an empty module cache, which then holds only the files the build read: the `go.mod` of each
//   module it needs, and the zip of each that has a package it builds. Those are what's pinned,
//   with the lines of the `go.sum` that check them.
// - Checking: each file is fetched again from proxy.golang.org, through Lo's rules, and must be
//   the one Go checked, and each `go.mod`'s hash the one its `go.sum` line says.
// - Building: each platform's program is built as Lo builds it (`buildGo` in src/build.ts), from
//   those files alone, and its size and SHA-256 recorded. Go's builds are reproducible, so Lo's
//   build on that platform makes the same file, which Lo checks before it's used.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import {
  buildGo,
  type Download,
  GO_TARGETS,
  type GoDownload,
  Installer,
  NO_NETWORK,
  PLATFORMS,
  type Platform,
  SYSTEM_PATH,
  TOOLCHAINS,
  type Manifest,
} from '../src/index.ts';
import { fetchPart, type Source, type Tools } from './sources.ts';

/** Where Go's modules come from. */
const PROXY = 'https://proxy.golang.org/';

/** The proxy's host, and the one it sends some zips on to, the store it keeps them in. */
const HOSTS = ['proxy.golang.org', 'storage.googleapis.com'];

/** How much more room than the largest build took Lo asks the disk for, before it builds. */
const ROOM_MARGIN = 1.25;

/**
 * The Go program `pkg`, at the version of its module pinned, built into `entry` with Lo's Go, as
 * `toolchains` pins it.
 */
export function goProgram(pkg: string, entry: string, toolchains: Manifest = TOOLCHAINS): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a version of ${pkg}`);
    const pinned = toolchains.go;
    if (pinned === undefined) throw new Error('toolchains.json pins no Go');
    const installer = new Installer({
      folder: join(tools.folder, 'toolchains'),
      fetch: tools.fetch,
    });
    const go = (await installer.install('go', pinned)).entry;
    tools.log(`Go ${pinned.version}, as Lo installs it, resolves and builds ${pkg}.`);

    const resolved = await resolve(go, pkg, version, pinned.version, tools);
    const paths = new Set<string>();
    for (const platform of PLATFORMS) {
      for (const path of await narrowed(go, pkg, resolved, platform, tools)) paths.add(path);
    }
    const sum = await readFile(join(resolved.module, 'go.sum'), 'utf8');
    const lines = sumLines(sum);
    const modules: (GoDownload['modules'][number] & { file: string })[] = [];
    const kept: string[] = [];
    for (const path of [...paths].toSorted()) {
      const checked = join(resolved.cache, 'cache', 'download', ...path.split('/'));
      const { part, file } = await fetchPart(`${PROXY}${path}`, HOSTS, tools);
      if (part.sha256 !== (await sha256(checked))) {
        throw new Error(`${path} on proxy.golang.org isn’t the file Go checked`);
      }
      const line = lines.get(sumKey(path));
      if (line === undefined) throw new Error(`the go.sum has no line for ${path}`);
      if (path.endsWith('.mod') && line.hash !== modHash(await readFile(file))) {
        throw new Error(`${path} isn’t what its go.sum line says`);
      }
      kept.push(line.text);
      modules.push({ ...part, path, file });
    }
    tools.log(`${modules.length} module files, each the one Go checked against sum.golang.org.`);

    const mod = (await readFile(join(resolved.module, 'go.mod'), 'utf8')).trimEnd().split('\n');
    const base = {
      kind: 'go' as const,
      entry,
      package: pkg,
      go: pinned.version,
      mod,
      sum: kept.toSorted(),
      modules: modules.map(({ file: _, ...part }) => part),
    };
    const builds: GoDownload['builds'] = {};
    let room = 0;
    for (const platform of PLATFORMS) {
      const folder = await mkdtemp(join(tools.folder, `build-${platform}-`));
      const files: string[] = [];
      for (const [index, { file }] of modules.entries()) {
        const copy = join(folder, 'downloads', String(index));
        await mkdir(dirname(copy), { recursive: true });
        await copyFile(file, copy);
        files.push(copy);
      }
      const download: GoDownload = {
        ...base,
        builds: { [platform]: { size: 1, sha256: '' } },
        room: 1,
      };
      const program = await buildGo({
        go,
        download,
        files,
        folder: join(folder, 'build'),
        platform,
      });
      const { size } = await lstat(program);
      builds[platform] = { size, sha256: await sha256(program) };
      room = Math.max(room, await bytesIn(join(folder, 'build')));
      tools.log(`Lo's build for ${platform} is ${size} bytes.`);
    }
    const download: Download = { ...base, builds, room: Math.ceil(room * ROOM_MARGIN) };
    return { version, hosts: HOSTS, platforms: { any: download } };
  };
}

/** A module that requires `pkg` as a tool, resolved by Go from proxy.golang.org. */
interface Resolved {
  /** The module's folder, with its `go.mod` and `go.sum`. */
  readonly module: string;
  /** The module cache Go fetched into. */
  readonly cache: string;
}

async function resolve(
  go: string,
  pkg: string,
  version: string,
  goVersion: string,
  tools: Tools,
): Promise<Resolved> {
  const folder = await mkdtemp(join(tools.folder, 'resolve-'));
  const module = join(folder, 'module');
  const cache = join(folder, 'modules');
  await mkdir(module, { recursive: true });
  await writeFile(
    join(module, 'go.mod'),
    `module lo/${pkg.split('/').at(-1) ?? 'program'}\n\ngo ${goVersion}\n`,
  );
  const env = {
    ...goEnvironment(go, folder, cache),
    GOPROXY: PROXY.slice(0, -1),
    GOSUMDB: 'sum.golang.org',
  };
  tools.log(`Resolving ${pkg}@v${version} with Go, its modules checked against sum.golang.org.`);
  await run(go, ['get', '-tool', `${pkg}@v${version}`], module, env);
  await run(go, ['mod', 'tidy'], module, env);
  return { module, cache };
}

/**
 * The paths, in a module proxy, of the files Go reads to build `pkg` for `platform`: those an
 * offline build from what `resolved` fetched fetches into an empty module cache.
 */
async function narrowed(
  go: string,
  pkg: string,
  resolved: Resolved,
  platform: Platform,
  tools: Tools,
): Promise<string[]> {
  const folder = await mkdtemp(join(tools.folder, `narrow-${platform}-`));
  const cache = join(folder, 'modules');
  const env = {
    ...goEnvironment(go, folder, cache),
    GOPROXY: `file://${join(resolved.cache, 'cache', 'download')}`,
    GOSUMDB: 'off',
    HTTPS_PROXY: NO_NETWORK,
    HTTP_PROXY: NO_NETWORK,
    GOOS: GO_TARGETS[platform].os,
    GOARCH: GO_TARGETS[platform].arch,
  };
  const args = [
    'build',
    '-trimpath',
    '-buildvcs=false',
    '-mod=readonly',
    '-o',
    join(folder, 'out'),
  ];
  await run(go, [...args, pkg], resolved.module, env);
  const download = join(cache, 'cache', 'download');
  const paths = (await readdir(download, { recursive: true, encoding: 'utf8' })).filter((path) =>
    /\.(?:mod|zip)$/.test(path),
  );
  tools.log(`Building for ${platform} reads ${paths.length} module files.`);
  return paths;
}

/** Go's environment for pinning, built from nothing, its folders in `folder`. */
function goEnvironment(go: string, folder: string, cache: string): Record<string, string> {
  const bin = dirname(go);
  return {
    HOME: join(folder, 'home'),
    TMPDIR: folder,
    PATH: [bin, ...SYSTEM_PATH].join(':'),
    LANG: 'C.UTF-8',
    GOROOT: dirname(bin),
    GOTOOLCHAIN: 'local',
    GOENV: 'off',
    GOFLAGS: '-modcacherw',
    GOWORK: 'off',
    GO111MODULE: 'on',
    GONOPROXY: '',
    GOPRIVATE: '',
    GONOSUMDB: '',
    GOINSECURE: '',
    GOVCS: '*:off',
    GOPATH: join(folder, 'go'),
    GOMODCACHE: cache,
    GOCACHE: join(folder, 'cache'),
    CGO_ENABLED: '0',
  };
}

async function run(
  program: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  try {
    await promisify(execFile)(program, args, { cwd, env, maxBuffer: 64 * 1024 ** 2 });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new Error(`go ${args.join(' ')} failed: ${stderr.trim()}`, { cause: error });
  }
}

/** A `go.sum`'s lines, each by its module, its version and whether it's for the `go.mod` alone. */
function sumLines(text: string): Map<string, { text: string; hash: string }> {
  const lines = new Map<string, { text: string; hash: string }>();
  for (const line of text.split('\n')) {
    const [module, version, hash] = line.trim().split(' ');
    if (module === undefined || version === undefined || hash === undefined) continue;
    lines.set(`${module} ${version}`, { text: line.trim(), hash });
  }
  return lines;
}

/**
 * The key of the `go.sum` line that checks the file at `path` in a module proxy: its module and
 * version, unescaped, and `/go.mod` after the version for a `go.mod`.
 */
export function sumKey(path: string): string {
  const at = path.indexOf('/@v/');
  if (at === -1) throw new Error(`${path} isn’t a module proxy’s path`);
  const module = unescapePath(path.slice(0, at));
  const file = path.slice(at + '/@v/'.length);
  const mod = file.endsWith('.mod');
  const version = unescapePath(file.slice(0, file.lastIndexOf('.')));
  return `${module} ${version}${mod ? '/go.mod' : ''}`;
}

/** A module path or version as the proxy protocol escapes it, back as Go spells it. */
function unescapePath(escaped: string): string {
  return escaped.replace(/!([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** A `go.mod`'s hash, as its `go.sum` line has it: Go's `h1` hash of a folder holding it alone. */
export function modHash(data: Buffer): string {
  const line = `${createHash('sha256').update(data).digest('hex')}  go.mod\n`;
  return `h1:${createHash('sha256').update(line).digest('base64')}`;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** How many bytes the files in `folder` hold. */
async function bytesIn(folder: string): Promise<number> {
  let bytes = 0;
  for (const path of await readdir(folder, { recursive: true, encoding: 'utf8' })) {
    const info = await lstat(join(folder, path));
    if (info.isFile()) bytes += info.size;
  }
  return bytes;
}
