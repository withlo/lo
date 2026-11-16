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
 *   of its tarballs pinned the same way, or gzipped tars laid one over another in one folder
 *   (`layers`), as Rust's components make one sysroot;
 * - its `entry`: the file the server starts from, inside what's installed;
 * - where it's recorded, what it `unpacked` to, in bytes, which caps its install at that and 5%
 *   more, in place of the limit every download shares.
 *
 * `toolchains.json` pins the toolchains language servers use, Go, Rust, a JDK and the .NET SDK,
 * the same way, each with what it unpacks to ({@link TOOLCHAINS}).
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

const anyDownload = z.discriminatedUnion('kind', [archive, program, npm, layers]);

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
        context.addIssue({ code: 'custom', message: `${part.url} isn't on one of its hosts` });
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

/** The files `download` fetches: its own, or each of its npm packages' or layers'. */
export function partsOf(download: Download): readonly Part[] {
  switch (download.kind) {
    case 'npm':
      return download.packages;
    case 'layers':
      return download.layers;
    case 'tar.gz':
    case 'zip':
    case 'gz':
    case 'file':
      return [download];
    default:
      throw new Error(`a download Lo doesn't know: ${JSON.stringify(download satisfies never)}`);
  }
}

/** Reads a manifest, and throws with what's wrong with one Lo can't use. */
export function parseManifest(json: unknown): Manifest {
  const parsed = manifest.safeParse(json);
  if (!parsed.success) throw new Error(`the manifest is invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Lo's own manifest. */
export const MANIFEST: Manifest = parseManifest(servers);

/**
 * Reads a manifest of toolchains, which must each say what they unpack to on every platform, and
 * throws with what's wrong with one Lo can't use.
 */
export function parseToolchains(json: unknown): Manifest {
  const parsed = parseManifest(json);
  for (const [id, entry] of Object.entries(parsed)) {
    for (const [platform, download] of Object.entries(entry.platforms)) {
      if (download.unpacked === undefined) {
        throw new Error(
          `the manifest is invalid: ${id} doesn't say what it unpacks to on ${platform}`,
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
