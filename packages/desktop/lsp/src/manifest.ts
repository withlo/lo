/**
 * What Lo downloads: each language server, and the Node the JavaScript ones run on, pinned to one
 * version, with each file's address, size and SHA-256 for each platform. The manifest is
 * `servers.json`, written by `scripts/pin.ts` when a version changes and committed, so it ships
 * inside the signed app. Lo checks a download only against the hashes recorded there, never
 * against a checksum fetched beside the download.
 *
 * Each entry names:
 *
 * - its `version`, which names the folder it's installed in;
 * - the `hosts` its files and their redirects may come from, by exact name;
 * - per platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`), or `any` for one
 *   that runs everywhere, what to download: an archive (`tar.gz` or `zip`), a gzipped program
 *   (`gz`), a program as it is (`file`), an npm package with its dependencies (`npm`), each
 *   of its tarballs pinned the same way, gzipped tars laid one over another in one folder
 *   (`layers`), as Rust's components make one sysroot, or a Go program's modules, which Lo builds
 *   the program from with its own Go (`go`), as it does gopls;
 * - its `entry`: the file the server starts from, inside what's installed;
 * - where it's recorded, what it `unpacked` to, in bytes, which caps its install at that and 5%
 *   more, in place of the limit every download shares.
 *
 * `toolchains.json` pins the toolchains language servers use, Go, Rust, a JDK, the .NET SDK and,
 * for Linux, Swift (`swift.ts`), the same way, each with what it unpacks to ({@link TOOLCHAINS}).
 * A toolchain's archive for a platform may name a `version` of its own, older than the entry's,
 * when its vendor hasn't published the entry's version for that platform yet: that platform
 * installs and names that version ({@link versionFor}), and the rest the entry's. A server's never
 * does.
 */

import { z } from 'zod';

import servers from '../servers.json' with { type: 'json' };
import toolchains from '../toolchains.json' with { type: 'json' };

/** The platforms Lo downloads for, as `<platform>-<arch>`. */
export const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'] as const;

export type Platform = (typeof PLATFORMS)[number];

/** The platform Lo runs on, or `undefined` for one it downloads nothing for. */
export function currentPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Platform | undefined {
  const name = `${platform}-${arch}`;
  return PLATFORMS.find((known) => known === name);
}

/** Whether `path` is a relative path that stays where it starts: `/`-separated, with no `..`. */
export function isPlainPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || /[\p{Cc}\\]/u.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Whether `href` is an address Lo may download from: `https`, on its usual port, with no login. */
export function isDownloadAddress(href: string): boolean {
  const url = URL.parse(href);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.hash === ''
  );
}

/** A name for a folder: the ID of an entry, or its version. */
const NAME = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

const address = z.string().refine(isDownloadAddress, 'an https address on its usual port');
const size = z.number().int().positive();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a SHA-256 in lowercase hex');
const path = z.string().refine(isPlainPath, 'a relative path that stays inside its folder');

/** Where an npm package goes: `node_modules/<name>`, perhaps inside another package's. */
const MODULE_PATH =
  /^node_modules\/(?:@[^/]+\/)?[^/@][^/]*(?:\/node_modules\/(?:@[^/]+\/)?[^/@][^/]*)*$/;

/** One file to download. */
const file = z.strictObject({ url: address, size, sha256 });

/** What a download unpacks to, in bytes, where it's recorded. */
const unpacked = size.optional();

const archive = file.extend({
  kind: z.enum(['tar.gz', 'zip']),
  entry: path,
  unpacked,
  /** The version this platform has, where it isn't the entry's: a toolchain's only. */
  version: z.string().regex(NAME, 'a version').optional(),
});

/** A program alone, gzipped or as it is: `entry` is the name it's installed by. */
const program = file.extend({
  kind: z.enum(['gz', 'file']),
  entry: z.string().regex(NAME, 'a file name'),
  unpacked,
});

/** An npm package and its dependencies, each tarball unpacked at its `path`. */
const npm = z.strictObject({
  kind: z.literal('npm'),
  entry: path,
  packages: z
    .array(file.extend({ path: z.string().regex(MODULE_PATH).refine(isPlainPath) }))
    .min(1)
    .refine((packages) => new Set(packages.map((pkg) => pkg.path)).size === packages.length, {
      message: 'each package once',
    }),
  unpacked,
});

/**
 * Gzipped tars unpacked one over another into one folder, in order, as rust-installer's
 * components are: each layer's files are those in its folder `from` (`rustc-<version>-<target>/
 * rustc`), but the `manifest.in` that lists them. A file two layers both hold is refused.
 */
const layers = z.strictObject({
  kind: z.literal('layers'),
  entry: path,
  layers: z.array(file.extend({ from: path })).min(1),
  unpacked,
});

/** A Go package's import path: `golang.org/x/tools/gopls`. */
const GO_PACKAGE = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~+-]+)*$/;

/**
 * Where a module's `go.mod` or zip is in a Go module proxy, as the proxy protocol escapes it, each
 * capital letter a `!` and the letter: `github.com/!burnt!sushi/toml/@v/v1.6.0.zip`.
 */
const PROXY_PATH = /^(?:[a-z0-9._~!-]+\/)+@v\/v[a-z0-9.!+_-]+\.(?:mod|zip)$/;

/** A line of a `go.sum`: a module, its version, perhaps for its `go.mod` alone, and its hash. */
const GO_SUM = /^[A-Za-z0-9._~/+-]+ v[A-Za-z0-9.+_-]+(?:\/go\.mod)? h1:[A-Za-z0-9+/]{43}=$/;

/** A line of text, its tabs aside with nothing that would end or hide it. */
const LINE = /^(?:\t|[^\p{Cc}])*$/u;

/** A program's size and SHA-256, as it's built. */
const built = z.strictObject({ size, sha256 });

/**
 * A Go program Lo builds from source, as it does gopls, rather than downloading a binary: each
 * module file the build reads (`modules`), fetched from the module proxy at its `path` there and
 * pinned as any file is, laid out as a proxy of Lo's own; a `go.mod` and `go.sum` of Lo's (`mod`
 * and `sum`, a line each) that require exactly those modules; and the program `entry`, built from
 * `package` with Lo's Go, the version `go` names, offline, whose size and SHA-256 on each
 * platform `builds` pins, refusing any other. `room` is the most its build holds on the disk, the
 * module files moved into it among them; all of it but the program goes once it's built.
 */
const goProgram = z
  .strictObject({
    kind: z.literal('go'),
    entry: z.string().regex(NAME, 'a file name'),
    package: z.string().regex(GO_PACKAGE, 'a Go package'),
    go: z.string().regex(NAME, 'a Go version'),
    mod: z.array(z.string().regex(LINE, 'a line')).min(1),
    sum: z.array(z.string().regex(GO_SUM, 'a line of a go.sum')).min(1),
    modules: z
      .array(file.extend({ path: z.string().regex(PROXY_PATH).refine(isPlainPath) }))
      .min(1)
      .refine((modules) => new Set(modules.map((each) => each.path)).size === modules.length, {
        message: 'each module file once',
      })
      .refine(
        (modules) => modules.every((each) => new URL(each.url).pathname === `/${each.path}`),
        {
          message: 'each module file from its own path in the proxy',
        },
      ),
    builds: z.partialRecord(z.enum(PLATFORMS), built),
    room: size,
    unpacked,
  })
  .refine((download) => Object.keys(download.builds).length > 0, 'it builds for no platform');

const anyDownload = z.discriminatedUnion('kind', [archive, program, npm, layers, goProgram]);

const pinned = z
  .strictObject({
    version: z.string().regex(NAME, 'a version'),
    hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/, 'a host name in lowercase')).min(1),
    platforms: z.partialRecord(z.enum([...PLATFORMS, 'any']), anyDownload),
  })
  .superRefine((entry, context) => {
    const downloads = Object.values(entry.platforms);
    if (downloads.length === 0) {
      context.addIssue({ code: 'custom', message: 'it downloads nothing' });
    }
    for (const part of downloads.flatMap(partsOf)) {
      if (!entry.hosts.includes(new URL(part.url).hostname)) {
        context.addIssue({ code: 'custom', message: `${part.url} isn’t on one of its hosts` });
      }
    }
  });

const manifest = z.record(z.string().regex(NAME, 'an ID'), pinned);

export type Download = z.infer<typeof anyDownload>;
export type Pinned = z.infer<typeof pinned>;
export type Manifest = z.infer<typeof manifest>;

/** One file a download fetches. */
export interface Part {
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

/** The files `download` fetches: its own, or each of its npm packages', layers' or modules'. */
export function partsOf(download: Download): readonly Part[] {
  switch (download.kind) {
    case 'npm':
      return download.packages;
    case 'layers':
      return download.layers;
    case 'go':
      return download.modules;
    case 'tar.gz':
    case 'zip':
    case 'gz':
    case 'file':
      return [download];
    default:
      throw new Error(`a download Lo doesn’t know: ${JSON.stringify(download satisfies never)}`);
  }
}

/** Reads a manifest of either kind, and throws with what's wrong with one Lo can't use. */
function parseEntries(json: unknown): Manifest {
  const parsed = manifest.safeParse(json);
  if (!parsed.success) throw new Error(`the manifest is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/**
 * Reads a manifest of servers, and throws with what's wrong with one Lo can't use: a server is
 * one version on every platform, so none names a version of its own for one.
 */
export function parseManifest(json: unknown): Manifest {
  const parsed = parseEntries(json);
  for (const [id, entry] of Object.entries(parsed)) {
    for (const [platform, download] of Object.entries(entry.platforms)) {
      if ('version' in download && download.version !== undefined) {
        throw new Error(
          `the manifest is invalid: ${id} names a version of its own on ${platform}, which only a toolchain may`,
        );
      }
    }
  }
  return parsed;
}

/** Lo's own manifest. */
export const MANIFEST: Manifest = parseManifest(servers);

/**
 * Reads a manifest of toolchains, which must each say what they unpack to on every platform, and
 * throws with what's wrong with one Lo can't use.
 */
export function parseToolchains(json: unknown): Manifest {
  const parsed = parseEntries(json);
  for (const [id, entry] of Object.entries(parsed)) {
    for (const [platform, download] of Object.entries(entry.platforms)) {
      if (download.unpacked === undefined) {
        throw new Error(
          `the manifest is invalid: ${id} doesn’t say what it unpacks to on ${platform}`,
        );
      }
    }
  }
  return parsed;
}

/** The toolchains language servers use, which Lo downloads as it does servers: `toolchains.json`. */
export const TOOLCHAINS: Manifest = parseToolchains(toolchains);

/** What `entry` downloads on `platform`, or `undefined` when it has nothing for it. */
export function downloadFor(entry: Pinned, platform: Platform): Download | undefined {
  return entry.platforms[platform] ?? entry.platforms.any;
}

/**
 * The version of `entry` that `platform` installs: the one its download names, where its vendor
 * hasn't published the entry's for it yet, else the entry's.
 */
export function versionFor(entry: Pinned, platform: Platform): string {
  const download = downloadFor(entry, platform);
  const own = download !== undefined && 'version' in download ? download.version : undefined;
  return own ?? entry.version;
}
