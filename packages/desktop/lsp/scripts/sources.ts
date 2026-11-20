// Where each pinned file comes from, and how `pin.ts` checks it before recording its hash: by the
// publisher's own signature where it has one. Where a publisher signs nothing, as php-lsp's
// releases don't, it's checked against the checksum its release lists beside it, which catches a
// download gone wrong but not a release someone else made. Each source downloads through Lo's own
// rules (https, the listed hosts, the redirects), and unpacks what it downloads as Lo would, so a
// version Lo would refuse is refused here, when it's pinned.

import { execFile } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';

import * as openpgp from 'openpgp';
import { z } from 'zod';

import {
  type Download,
  fetchFile,
  type Part,
  type Pinned,
  type Platform,
  PLATFORMS,
  unpackDownload,
} from '../src/index.ts';

/** What a source works with. */
export interface Tools {
  /** Sends one request without following redirects. */
  readonly fetch: typeof globalThis.fetch;
  /** An empty folder for downloads, which the caller removes. */
  readonly folder: string;
  /** Says what's happening, a line at a time. */
  readonly log: (line: string) => void;
  /**
   * What the manifest pins for it now, if anything: what a platform its vendor hasn't published
   * the version for yet keeps, where its source allows that.
   */
  readonly pinned?: Pinned | undefined;
}

/** Records `version` of something, checked, as the manifest's entry for it. */
export type Source = (version: string, tools: Tools) => Promise<Pinned>;

/** The most a checksum file or a package's metadata may be. */
const TEXT_LIMIT = 64 * 1024 ** 2;

/** The most a file pinned may be. */
const FILE_LIMIT = 2 * 1024 ** 3;

/**
 * Node, from nodejs.org: the tarball for each platform, each listed in the release's
 * `SHASUMS256.txt`, which one of Node's releasers signed. `keys` are their public keys, armored.
 */
export function node(keys: readonly string[]): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a Node version`);
    const hosts = ['nodejs.org'];
    const base = `https://nodejs.org/dist/v${version}/`;
    const sums = await fetchBytes(`${base}SHASUMS256.txt`, hosts, tools);
    const signature = await fetchBytes(`${base}SHASUMS256.txt.sig`, hosts, tools);
    await verifySigned(sums, signature, keys);
    tools.log(`SHASUMS256.txt for Node ${version} is signed by one of Node's releasers.`);
    const listed = parseSums(sums.toString('utf8'));
    const platforms: Record<string, Download> = {};
    for (const platform of PLATFORMS) {
      const name = `node-v${version}-${platform}.tar.gz`;
      const expected = listed.get(name);
      if (expected === undefined) throw new Error(`SHASUMS256.txt doesn’t list ${name}`);
      const { part, file } = await fetchPart(`${base}${name}`, hosts, tools);
      if (part.sha256 !== expected) throw new Error(`${name} isn’t what SHASUMS256.txt lists`);
      const download: Download = {
        kind: 'tar.gz',
        ...part,
        entry: `node-v${version}-${platform}/bin/node`,
      };
      await checkUnpacks(download, [file], tools);
      platforms[platform] = download;
    }
    return { version, hosts, platforms };
  };
}

/** rust-analyzer's names for the platforms, as its release assets spell them. */
const RUST_ANALYZER_TARGETS: Record<Platform, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/** What `pin.ts` reads of a GitHub release: each asset's name, its address, and its digest. */
export const GITHUB_RELEASE = z.object({
  assets: z.array(
    z.object({
      name: z.string(),
      browser_download_url: z.string(),
      // GitHub computes this itself and the REST API serves it, e.g. `sha256:…`; older releases
      // may lack it, which `pin.ts` then refuses.
      digest: z.string().nullable().default(null),
    }),
  ),
});

/**
 * rust-analyzer, from its GitHub releases, `<year>-<month>-<day>` (the release tag): a gzipped
 * program for each platform. rust-analyzer publishes no signatures or attestations for its
 * releases, so the strongest check the release allows is GitHub's own asset digest: the REST API
 * (`api.github.com`) serves the SHA-256 GitHub computed when each asset was uploaded, which
 * `pin.ts` checks the download from `github.com` against. GitHub runs both, so this catches a
 * download gone wrong or changed on its way, not a release someone else made. Lo then trusts only
 * the hash `pin.ts` writes.
 */
export function rustAnalyzer(): Source {
  return async (version, tools) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
      throw new Error(`${version} isn’t a rust-analyzer release, which is dated YYYY-MM-DD`);
    }
    const release = await fetchJson(
      `https://api.github.com/repos/rust-lang/rust-analyzer/releases/tags/${version}`,
      GITHUB_RELEASE,
      ['api.github.com'],
      tools,
    );
    // GitHub sends each download on to its host for release files.
    const hosts = ['github.com', 'release-assets.githubusercontent.com'];
    const platforms: Record<string, Download> = {};
    for (const platform of PLATFORMS) {
      const name = `rust-analyzer-${RUST_ANALYZER_TARGETS[platform]}.gz`;
      const asset = release.assets.find((each) => each.name === name);
      if (asset === undefined) throw new Error(`The release ${version} has no ${name}`);
      const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')?.[1];
      if (sha256 === undefined) throw new Error(`The GitHub API lists no SHA-256 for ${name}`);
      const { part, file } = await fetchPart(asset.browser_download_url, hosts, tools);
      if (part.sha256 !== sha256)
        throw new Error(`${name} isn’t what the GitHub API’s digest says`);
      tools.log(`${name} has the SHA-256 the GitHub release API lists.`);
      const download: Download = { kind: 'gz', ...part, entry: 'rust-analyzer' };
      await checkUnpacks(download, [file], tools);
      platforms[platform] = download;
    }
    return { version, hosts, platforms };
  };
}

/** Where GitHub serves a release's files from: its own host, which redirects each to its store. */
const GITHUB_HOSTS = ['github.com', 'release-assets.githubusercontent.com'];

/**
 * A program from a GitHub repository's releases, tagged `v<version>`: for each platform, the
 * `tar.gz` `archives` names, holding the program at `entry`, each checked against the SHA-256 in
 * the `<archive>.sha256` beside it. Nobody signs either: the release's own build made both.
 */
export function githubRelease(
  repo: string,
  archives: Readonly<Record<Platform, string>>,
  entry: string,
): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a release’s version`);
    const base = `https://github.com/${repo}/releases/download/v${version}/`;
    const platforms: Record<string, Download> = {};
    for (const platform of PLATFORMS) {
      const name = archives[platform];
      const sums = await fetchBytes(`${base}${name}.sha256`, GITHUB_HOSTS, tools);
      const expected = parseSums(sums.toString('utf8')).get(name);
      if (expected === undefined) throw new Error(`${name}.sha256 doesn’t list ${name}`);
      const { part, file } = await fetchPart(`${base}${name}`, GITHUB_HOSTS, tools);
      if (part.sha256 !== expected) throw new Error(`${name} isn’t what ${name}.sha256 lists`);
      const download: Download = { kind: 'tar.gz', ...part, entry };
      await checkUnpacks(download, [file], tools);
      platforms[platform] = download;
    }
    tools.log(`Each archive is what the checksum its release lists beside it says.`);
    return { version, hosts: GITHUB_HOSTS, platforms };
  };
}

/** Where Eclipse serves JDT LS's releases from. */
const ECLIPSE_HOSTS = ['download.eclipse.org'];

/** The folders of Equinox's configuration that JDT LS's adapter starts it with, one a platform. */
const JDTLS_CONFIGURATIONS = ['config_mac', 'config_mac_arm', 'config_linux', 'config_linux_arm'];

/**
 * Eclipse JDT LS, as Eclipse publishes each release: one archive for every platform, which the
 * release's `latest.txt` names, checked against the SHA-256 in the `.sha256` beside it, which the
 * same build made. Nothing signs the archive as a whole: Eclipse signs about half the bundles in
 * it, but not the rest, nor Equinox's configuration, so the checksum is all that covers it. That
 * catches a download gone wrong, not a release someone else made. `entry` is Equinox's launcher in
 * it, the jar JDT LS starts from, which is named by its own version.
 */
export function jdtls(): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a release’s version`);
    const base = `https://download.eclipse.org/jdtls/milestones/${version}/`;
    const latest = await fetchBytes(`${base}latest.txt`, ECLIPSE_HOSTS, tools);
    const name = latest.toString('utf8').trim();
    const archive = new RegExp(
      `^jdt-language-server-${version.replaceAll('.', '\\.')}-\\d{12}\\.tar\\.gz$`,
    );
    if (!archive.test(name)) {
      throw new Error(`latest.txt names ${JSON.stringify(name)}, not an archive of ${version}`);
    }
    const sums = await fetchBytes(`${base}${name}.sha256`, ECLIPSE_HOSTS, tools);
    const expected = /^([0-9a-f]{64})\s*$/.exec(sums.toString('utf8'))?.[1];
    if (expected === undefined) throw new Error(`${name}.sha256 holds no SHA-256`);
    const { part, file } = await fetchPart(`${base}${name}`, ECLIPSE_HOSTS, tools);
    if (part.sha256 !== expected) throw new Error(`${name} isn’t what ${name}.sha256 lists`);
    tools.log(`${name} is what the checksum its release lists beside it says.`);
    // What it holds: one launcher, JDT LS of this version, and a configuration a platform.
    const into = join(await mkdtemp(join(tools.folder, 'unpacked-')), 'files');
    await mkdir(into);
    const configuration = `${JDTLS_CONFIGURATIONS[0]}/config.ini`;
    await unpackDownload({ kind: 'tar.gz', ...part, entry: configuration }, [file], into);
    const plugins = await readdir(join(into, 'plugins'));
    const launchers = plugins.filter((each) =>
      /^org\.eclipse\.equinox\.launcher_[\w.-]+\.jar$/.test(each),
    );
    const core = plugins.some((each) => each.startsWith(`org.eclipse.jdt.ls.core_${version}.`));
    const [launcher] = launchers;
    if (launcher === undefined || launchers.length > 1 || !core) {
      throw new Error(`${name} doesn’t hold one launcher and JDT LS ${version}`);
    }
    for (const folder of JDTLS_CONFIGURATIONS) {
      if (!(await readdir(join(into, folder))).includes('config.ini')) {
        throw new Error(`${name} has no ${folder}/config.ini`);
      }
    }
    const download: Download = { kind: 'tar.gz', ...part, entry: `plugins/${launcher}` };
    await checkUnpacks(download, [file], tools);
    return { version, hosts: ECLIPSE_HOSTS, platforms: { any: download } };
  };
}

/** HashiCorp's names for the platforms. */
const HASHICORP_PLATFORMS: Record<Platform, string> = {
  'darwin-arm64': 'darwin_arm64',
  'darwin-x64': 'darwin_amd64',
  'linux-x64': 'linux_amd64',
  'linux-arm64': 'linux_arm64',
};

/**
 * A program HashiCorp releases, such as terraform-ls, from releases.hashicorp.com: the zip for each
 * platform, each listed in the release's `SHA256SUMS`, which HashiCorp signed with one of `keys`,
 * its own, armored. The program is the zip's file named `product`.
 */
export function hashicorp(product: string, keys: readonly string[]): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version))
      throw new Error(`${version} isn’t a version of ${product}`);
    const hosts = ['releases.hashicorp.com'];
    const base = `https://releases.hashicorp.com/${product}/${version}/`;
    const name = `${product}_${version}_SHA256SUMS`;
    const sums = await fetchBytes(`${base}${name}`, hosts, tools);
    await verifySigned(sums, await fetchBytes(`${base}${name}.sig`, hosts, tools), keys);
    tools.log(`${name} is signed with HashiCorp's key.`);
    const listed = parseSums(sums.toString('utf8'));
    const platforms: Record<string, Download> = {};
    for (const platform of PLATFORMS) {
      const zip = `${product}_${version}_${HASHICORP_PLATFORMS[platform]}.zip`;
      const expected = listed.get(zip);
      if (expected === undefined) throw new Error(`${name} doesn’t list ${zip}`);
      const { part, file } = await fetchPart(`${base}${zip}`, hosts, tools);
      if (part.sha256 !== expected) throw new Error(`${zip} isn’t what ${name} lists`);
      const download: Download = { kind: 'zip', ...part, entry: product };
      await checkUnpacks(download, [file], tools);
      platforms[platform] = download;
    }
    return { version, hosts, platforms };
  };
}

/** One of npm's keys for signing what its registry serves, as its `/-/npm/v1/keys` lists them. */
export interface RegistryKey {
  readonly keyid: string;
  /** The key, as base64 of its DER `SubjectPublicKeyInfo`. */
  readonly key: string;
  /** When it stopped signing, if it has. */
  readonly expires: string | null;
}

/**
 * npm's registry keys, as https://registry.npmjs.org/-/npm/v1/keys listed them when they were
 * recorded here. The first signed packages until it expired; the second signs them since.
 */
export const NPM_KEYS: readonly RegistryKey[] = [
  {
    keyid: 'SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA',
    key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE1Olb3zMAFFxXKHiIkQO5cJ3Yhl5i6UPp+IhuteBJbuHcA5UogKo0EWtlWwW6KSaKoTNEYL7JlCQiVnkhBktUgg==',
    expires: '2025-01-29T00:00:00.000Z',
  },
  {
    keyid: 'SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U',
    key: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY6Ya7W++7aUPzvMTrezH6Ycx3c+HOKYCcNGybJZSCJq/fd7Qa8uuAKtdIkUQtQiEKERhAmE5lMMJhP8OkDOa2g==',
    expires: null,
  },
];

const REGISTRY = 'https://registry.npmjs.org/';

/** An npm lockfile, as `pin.ts` reads one: each package by where it goes. */
const LOCKFILE = z.object({
  packages: z.record(
    z.string(),
    z.object({
      version: z.string().optional(),
      resolved: z.string().optional(),
      integrity: z.string().optional(),
      dev: z.boolean().optional(),
      optional: z.boolean().optional(),
      os: z.array(z.string()).optional(),
      cpu: z.array(z.string()).optional(),
      link: z.boolean().optional(),
    }),
  ),
});

/** What npm's registry signed a version with. */
export type Signatures = readonly { readonly keyid: string; readonly sig: string }[];

/** What npm's registry says of one version of a package. */
const VERSION = z.object({
  dist: z.object({
    integrity: z.string(),
    signatures: z.array(z.object({ keyid: z.string(), sig: z.string() })).default([]),
  }),
});

/** What npm's registry says of a package: when each version was published. */
const PACKAGE = z.object({ time: z.record(z.string(), z.string()).optional() });

/**
 * An npm package and what it depends on, as npm itself resolves them (`npm install
 * --package-lock-only --ignore-scripts`, so nothing is installed or run), each tarball from npm's
 * registry, its `integrity` signed by the registry. An optional package for some systems only,
 * such as `fsevents`, is left out, as npm leaves it out elsewhere. `entry` is the file the server starts from,
 * inside the install's folder, such as `node_modules/pyright/langserver.index.js`.
 */
export function npm(name: string, entry: string, keys: readonly RegistryKey[] = NPM_KEYS): Source {
  return async (version, tools) => {
    const hosts = ['registry.npmjs.org'];
    const lock = await resolveLock(name, version, tools);
    const packages: (Part & { path: string })[] = [];
    const files: string[] = [];
    for (const [path, locked] of Object.entries(lock)) {
      if (path === '') continue;
      if (locked.link === true || locked.dev === true) {
        throw new Error(`${path} is a link or a dev dependency, which pin.ts doesn't record`);
      }
      if (locked.os !== undefined || locked.cpu !== undefined) {
        // npm leaves such a package out wherever it doesn't fit, so the server runs without it.
        if (locked.optional === true) {
          tools.log(`Leaving out ${path}: it's optional, and for some systems only.`);
          continue;
        }
        throw new Error(`${path} is for some systems only, which pin.ts doesn't record yet`);
      }
      const pkg = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const { version: exact, resolved, integrity } = locked;
      if (exact === undefined || resolved === undefined || integrity === undefined) {
        throw new Error(`${path} has no version, address or integrity in the lockfile`);
      }
      const { dist } = await fetchJson(`${REGISTRY}${pkg}/${exact}`, VERSION, hosts, tools);
      if (dist.integrity !== integrity) {
        throw new Error(`${pkg}@${exact}'s integrity isn't the registry's`);
      }
      await verifyRegistry(pkg, exact, integrity, dist.signatures, keys, tools);
      const { part, file } = await fetchPart(resolved, hosts, tools);
      if (sri(await readFile(file), integrity) !== integrity) {
        throw new Error(`${pkg}@${exact}'s tarball isn't what its integrity says`);
      }
      packages.push({ path, ...part });
      files.push(file);
    }
    const count = packages.length === 1 ? '1 package' : `${packages.length} packages`;
    tools.log(`${count}, each signed by npm's registry.`);
    const download: Download = { kind: 'npm', entry, packages };
    await checkUnpacks(download, files, tools);
    return { version, hosts, platforms: { any: download } };
  };
}

/** The packages npm resolves for `name@version`, by where each goes, from its lockfile. */
async function resolveLock(
  name: string,
  version: string,
  tools: Tools,
): Promise<z.infer<typeof LOCKFILE>['packages']> {
  const folder = await mkdtemp(join(tools.folder, 'lock-'));
  await writeFile(join(folder, 'package.json'), '{ "private": true }\n');
  tools.log(`Resolving ${name}@${version} with npm, installing nothing.`);
  await promisify(execFile)(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-exact',
      '--omit=dev',
      `--registry=${REGISTRY}`,
      `${name}@${version}`,
    ],
    { cwd: folder },
  );
  const lock = JSON.parse(await readFile(join(folder, 'package-lock.json'), 'utf8')) as unknown;
  return LOCKFILE.parse(lock).packages;
}

/**
 * Checks that npm's registry signed `name@version:integrity` with one of `keys`: one that still
 * signs, or one that had expired only after the version was published.
 */
export async function verifyRegistry(
  name: string,
  version: string,
  integrity: string,
  signatures: Signatures,
  keys: readonly RegistryKey[],
  tools: Pick<Tools, 'fetch' | 'folder'>,
): Promise<void> {
  const signed = Buffer.from(`${name}@${version}:${integrity}`);
  for (const { keyid, sig } of signatures) {
    const key = keys.find((known) => known.keyid === keyid);
    if (key === undefined) continue;
    const publicKey = createPublicKey({
      key: Buffer.from(key.key, 'base64'),
      format: 'der',
      type: 'spki',
    });
    if (!verify('sha256', signed, publicKey, Buffer.from(sig, 'base64'))) continue;
    if (key.expires === null) return;
    const published = await publishedAt(name, version, tools);
    if (published !== undefined && published < new Date(key.expires)) return;
  }
  throw new Error(`npm's registry didn't sign ${name}@${version} with a key pin.ts knows`);
}

/** When `name@version` was published, as its registry says. */
async function publishedAt(
  name: string,
  version: string,
  tools: Pick<Tools, 'fetch' | 'folder'>,
): Promise<Date | undefined> {
  const meta = await fetchJson(`${REGISTRY}${name}`, PACKAGE, ['registry.npmjs.org'], tools);
  const time = meta.time?.[version];
  return time === undefined ? undefined : new Date(time);
}

/** `data`'s subresource integrity, in the algorithm `like` uses. */
function sri(data: Buffer, like: string): string {
  const algorithm = like.slice(0, like.indexOf('-'));
  if (algorithm !== 'sha512')
    throw new Error(`pin.ts checks only sha512 integrity, not ${algorithm}`);
  return `${algorithm}-${createHash(algorithm).update(data).digest('base64')}`;
}

/**
 * Checks that `signature`, a detached OpenPGP signature, signs `data` with one of `keys`, armored
 * public keys.
 */
export async function verifySigned(
  data: Buffer,
  signature: Buffer,
  keys: readonly string[],
): Promise<void> {
  const verificationKeys = (
    await Promise.all(keys.map((armoredKeys) => openpgp.readKeys({ armoredKeys })))
  ).flat();
  try {
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ binary: data }),
      signature: await openpgp.readSignature({ binarySignature: signature }),
      verificationKeys,
      expectSigned: true,
      format: 'binary',
    });
    const [first] = result.signatures;
    if (first === undefined) throw new Error('it signs nothing');
    await first.verified;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`It isn't signed with one of the keys pin.ts knows (${why}).`, {
      cause: error,
    });
  }
}

/** The files a checksum file lists, by name, each with its SHA-256. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) [ *]([^\s/]+)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) sums.set(match[2], match[1]);
  }
  return sums;
}

/** Downloads `url` into the tools' folder, as Lo would, and says what came. */
export async function fetchPart(
  url: string,
  hosts: readonly string[],
  tools: Pick<Tools, 'fetch' | 'folder' | 'log'>,
): Promise<{ part: Part; file: string }> {
  const folder = await mkdtemp(join(tools.folder, 'part-'));
  const file = join(folder, posix.basename(new URL(url).pathname) || 'download');
  tools.log(`Downloading ${url}`);
  const { size, sha256 } = await fetchFile(url, file, {
    fetch: tools.fetch,
    hosts,
    limit: FILE_LIMIT,
  });
  return { part: { url, size, sha256 }, file };
}

export async function fetchBytes(
  url: string,
  hosts: readonly string[],
  tools: Pick<Tools, 'fetch' | 'folder'>,
): Promise<Buffer> {
  const folder = await mkdtemp(join(tools.folder, 'text-'));
  const file = join(folder, 'file');
  await fetchFile(url, file, { fetch: tools.fetch, hosts, limit: TEXT_LIMIT });
  return readFile(file);
}

/** The JSON at `url`, as `schema` reads it. */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  hosts: readonly string[],
  tools: Pick<Tools, 'fetch' | 'folder'>,
): Promise<T> {
  const json = JSON.parse((await fetchBytes(url, hosts, tools)).toString('utf8')) as unknown;
  return schema.parse(json);
}

/** Unpacks `files`, as Lo would install `download`, to check that Lo would. */
async function checkUnpacks(
  download: Download,
  files: readonly string[],
  tools: Pick<Tools, 'folder' | 'log'>,
): Promise<void> {
  const into = join(await mkdtemp(join(tools.folder, 'unpacked-')), 'files');
  await mkdir(into);
  await unpackDownload(download, files, into);
  tools.log(`It unpacks as Lo would, with ${download.entry} inside.`);
}
