// Where each toolchain in toolchains.json comes from, and how `pin.ts` checks it before recording
// its hash, as sources.ts does for servers: by its publisher's own signature where it has one.
//
// - Go, from dl.google.com: each archive's detached `.asc`, made with Google's key for its Linux
//   packages, and its SHA-256 in go.dev's list of releases, a host of its own.
// - Rust, from static.rust-lang.org: the release's channel file, signed with the Rust project's
//   key, which lists each component's SHA-256. rustc, cargo, the standard library and its sources
//   are layers of one sysroot.
// - The Temurin JDK, from Adoptium's releases on GitHub: each archive's detached `.sig`, made with
//   Adoptium's key.
// - The .NET SDK, from builds.dotnet.microsoft.com, which publishes no signature: each archive's
//   SHA-512 must be the one both Microsoft's download site and the dotnet/core repository list in
//   their `releases.json`.
// - Swift, for Linux alone, from download.swift.org: an entry for each distribution swift.org
//   builds for (`swift-<distribution>`, `src/swift.ts`), each archive with its detached `.sig`,
//   made with swift.org's key for the release's major version. Each entry is pinned on its own,
//   all to one version.
//
// Each records, for every platform it has, what its download unpacks to, which caps its install.
// Each platform's files are removed once it's recorded, since a toolchain's run to gigabytes.

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import * as openpgp from 'openpgp';
import { z } from 'zod';

import {
  type Download,
  PLATFORMS,
  type Pinned,
  type Platform,
  SWIFT_PLATFORMS,
  SWIFT_UNPACK_LIMITS,
  type SwiftDistro,
  type UnpackLimits,
  unpackMeasured,
} from '../src/index.ts';
import {
  fetchBytes,
  fetchJson,
  fetchPart,
  type Source,
  type Tools,
  verifySigned,
} from './sources.ts';

/** Runs `work` with a folder of its own inside the tools' folder, removed once it's done. */
async function inFolder<T>(tools: Tools, work: (tools: Tools) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(join(tools.folder, 'platform-'));
  try {
    return await work({ ...tools, folder });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * `download` with what its `files` unpack to recorded, once they've unpacked as Lo would, within
 * `limits`, with its entry point inside.
 */
async function measured<T extends Download>(
  download: T,
  files: readonly string[],
  tools: Tools,
  limits?: UnpackLimits,
): Promise<T> {
  const into = join(await mkdtemp(join(tools.folder, 'unpacked-')), 'files');
  await mkdir(into);
  const { bytes } = await unpackMeasured(download, files, into, { limits });
  tools.log(`It unpacks as Lo would, to ${bytes} bytes, with ${download.entry} inside.`);
  return { ...download, unpacked: bytes };
}

/** Checks that `signature`, armored or not, signs `data` with one of `keys`. */
async function verifyDetached(data: Buffer, signature: Buffer, keys: readonly string[]) {
  const text = signature.toString('latin1');
  const binary = text.startsWith('-----BEGIN PGP SIGNATURE-----')
    ? Buffer.from((await openpgp.readSignature({ armoredSignature: text })).write())
    : signature;
  await verifySigned(data, binary, keys);
}

/**
 * Records `version` of a toolchain with a download that `each` makes for each of `platforms`, every
 * one Lo downloads for unless it says.
 */
async function everyPlatform(
  version: string,
  hosts: readonly string[],
  tools: Tools,
  each: (platform: Platform, tools: Tools) => Promise<Download>,
  platforms: readonly Platform[] = PLATFORMS,
): Promise<Pinned> {
  const downloads: Partial<Record<Platform, Download>> = {};
  for (const platform of platforms) {
    downloads[platform] = await inFolder(tools, (inside) => each(platform, inside));
  }
  return { version, hosts: [...hosts], platforms: downloads };
}

/** go.dev's list of Go's releases, as `?mode=json&include=all` gives it. */
const GO_RELEASES = z.array(
  z.object({
    version: z.string(),
    files: z.array(z.object({ filename: z.string(), sha256: z.string(), kind: z.string() })),
  }),
);

/** Go's names for the platforms' systems and processors. */
const GO_PLATFORMS: Record<Platform, string> = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-amd64',
  'linux-x64': 'linux-amd64',
  'linux-arm64': 'linux-arm64',
};

/**
 * Go, from dl.google.com: each archive signed with `keys`, Google's key for its Linux packages,
 * and listed with its SHA-256 by go.dev.
 */
export function go(keys: readonly string[]): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a Go version`);
    const hosts = ['dl.google.com'];
    const releases = await fetchJson(
      'https://go.dev/dl/?mode=json&include=all',
      GO_RELEASES,
      ['go.dev'],
      tools,
    );
    const release = releases.find((each) => each.version === `go${version}`);
    if (release === undefined) throw new Error(`go.dev lists no Go ${version}`);
    return everyPlatform(version, hosts, tools, async (platform, inside) => {
      const name = `go${version}.${GO_PLATFORMS[platform]}.tar.gz`;
      const listed = release.files.find(
        (file) => file.filename === name && file.kind === 'archive',
      );
      if (listed === undefined) throw new Error(`go.dev lists no ${name}`);
      const url = `https://dl.google.com/go/${name}`;
      const signature = await fetchBytes(`${url}.asc`, hosts, inside);
      const { part, file } = await fetchPart(url, hosts, inside);
      if (part.sha256 !== listed.sha256) throw new Error(`${name} isn’t what go.dev lists`);
      await verifyDetached(await readFile(file), signature, keys);
      inside.log(`${name} is signed with Google's key, and is what go.dev lists.`);
      return measured({ kind: 'tar.gz', ...part, entry: 'go/bin/go' }, [file], inside);
    });
  };
}

/**
 * The tables of a Rust channel file that `pin.ts` reads, by their names with any quotes taken off
 * (`pkg.rust-src.target.*`), each with its keys' string and boolean values. It reads only what
 * such a file holds: `[table]` headers, and `key = "string"` or `key = true` lines, each with or
 * without a comment after it. Arrays of tables, arrays, and multi-line strings, whose lines are
 * text however they look, are left out, and a header it can't read ends the table before it
 * rather than letting its keys join that one. A table's header twice, which TOML forbids, throws.
 */
export function parseChannel(text: string): Map<string, Map<string, string | boolean>> {
  const tables = new Map<string, Map<string, string | boolean>>();
  let table: Map<string, string | boolean> | undefined;
  let open: MultiLine | undefined;
  for (const line of text.split('\n')) {
    const read = codeOf(line, open);
    open = read.open;
    const trimmed = read.code.trim();
    if (trimmed.startsWith('[')) {
      const name = trimmed.startsWith('[[') ? undefined : headerName(trimmed);
      // TOML has a table once: a second header for it would have its keys replace the first's.
      if (name !== undefined && tables.has(name)) {
        throw new Error(`The channel file has the table [${name}] twice.`);
      }
      table = name === undefined ? undefined : new Map();
      if (name !== undefined && table !== undefined) tables.set(name, table);
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"\\]*)"|(true|false))$/.exec(trimmed);
    if (table !== undefined && pair?.[1] !== undefined) {
      table.set(pair[1], pair[2] ?? pair[3] === 'true');
    }
  }
  return tables;
}

/** The delimiters of TOML's multi-line strings, basic and literal. */
const MULTI_LINE = ['"""', "'''"] as const;

/** The delimiter of a multi-line string left open at the end of a line. */
type MultiLine = (typeof MULTI_LINE)[number];

/** A bare key, or a quoted one without escapes, in a table's header. */
const HEADER_KEY = /"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_-]+)/y;

/** The name of the table `header` begins, its keys' quotes taken off, or none if it isn't one. */
function headerName(header: string): string | undefined {
  const inside = /^\[(.*)\]$/.exec(header)?.[1];
  if (inside === undefined) return undefined;
  const keys: string[] = [];
  let at = 0;
  for (;;) {
    while (inside[at] === ' ' || inside[at] === '\t') at += 1;
    HEADER_KEY.lastIndex = at;
    const key = HEADER_KEY.exec(inside);
    if (key === null) return undefined;
    keys.push(key[1] ?? key[2] ?? key[3] ?? '');
    at = HEADER_KEY.lastIndex;
    while (inside[at] === ' ' || inside[at] === '\t') at += 1;
    if (at === inside.length) return keys.join('.');
    if (inside[at] !== '.') return undefined;
    at += 1;
  }
}

/**
 * What of `line` is TOML outside a comment and a multi-line string, with the multi-line string
 * still open at its end, if one is, given `open`, the one open at its start. A single-line string
 * is kept as it is; a multi-line one is left as `<text>`, which no key's value matches.
 */
function codeOf(line: string, open: MultiLine | undefined): { code: string; open?: MultiLine } {
  let code = '';
  let at = 0;
  let inside = open;
  while (at < line.length) {
    if (inside !== undefined) {
      const end = closing(line, at, inside);
      if (end === undefined) return { code, open: inside };
      at = end;
      inside = undefined;
      continue;
    }
    const rest = line.slice(at);
    if (rest.startsWith('#')) break;
    const opened = MULTI_LINE.find((delimiter) => rest.startsWith(delimiter));
    if (opened !== undefined) {
      inside = opened;
      code += '<text>';
      at += 3;
      continue;
    }
    const quote = line[at];
    if (quote === '"' || quote === "'") {
      let end = at + 1;
      while (end < line.length && line[end] !== quote)
        end += quote === '"' && line[end] === '\\' ? 2 : 1;
      code += line.slice(at, end + 1);
      at = end + 1;
      continue;
    }
    code += line[at];
    at += 1;
  }
  return inside === undefined ? { code } : { code, open: inside };
}

/**
 * Where the multi-line string `delimiter` opened ends in `line`, from `from`: just past its
 * closing delimiter, which in a basic string no backslash escapes, or none if it goes on.
 */
function closing(line: string, from: number, delimiter: MultiLine): number | undefined {
  for (let at = from; at <= line.length - 3; at += 1) {
    if (delimiter === '"""' && line[at] === '\\') {
      at += 1;
      continue;
    }
    if (line.startsWith(delimiter, at)) return at + 3;
  }
  return undefined;
}

/** Rust's names for the platforms. */
const RUST_TARGETS: Record<Platform, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
};

/** The components laid one over another in Rust's sysroot, and the folder each layer keeps them in. */
const RUST_COMPONENTS = [
  { component: 'rustc', folder: () => 'rustc' },
  { component: 'cargo', folder: () => 'cargo' },
  { component: 'rust-std', folder: (target: string) => `rust-std-${target}` },
  { component: 'rust-src', folder: () => 'rust-src' },
] as const;

/**
 * Rust, from static.rust-lang.org: rustc, cargo, the standard library and its sources, as layers
 * of one sysroot, each listed with its SHA-256 in the release's channel file, which `keys`, the
 * Rust project's, signed.
 */
export function rust(keys: readonly string[]): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${version} isn’t a Rust version`);
    const hosts = ['static.rust-lang.org'];
    const address = `https://static.rust-lang.org/dist/channel-rust-${version}.toml`;
    const channel = await fetchBytes(address, hosts, tools);
    await verifyDetached(channel, await fetchBytes(`${address}.asc`, hosts, tools), keys);
    tools.log(`channel-rust-${version}.toml is signed with the Rust project's key.`);
    const tables = parseChannel(channel.toString('utf8'));
    const said = tables.get('pkg.rustc')?.get('version');
    if (typeof said !== 'string' || !said.startsWith(`${version} `)) {
      throw new Error(`channel-rust-${version}.toml is for rustc ${String(said)}`);
    }
    return everyPlatform(version, hosts, tools, async (platform, inside) => {
      const target = RUST_TARGETS[platform];
      const layers: Extract<Download, { kind: 'layers' }>['layers'][number][] = [];
      const files: string[] = [];
      for (const { component, folder } of RUST_COMPONENTS) {
        // The sources are the same for every target.
        const table = tables.get(
          `pkg.${component}.target.${component === 'rust-src' ? '*' : target}`,
        );
        const url = table?.get('url');
        const hash = table?.get('hash');
        if (
          table?.get('available') !== true ||
          typeof url !== 'string' ||
          typeof hash !== 'string'
        ) {
          throw new Error(`Rust ${version} has no ${component} for ${target}`);
        }
        const { part, file } = await fetchPart(url, hosts, inside);
        if (part.sha256 !== hash) throw new Error(`${url} isn’t what the channel file lists`);
        layers.push({ ...part, from: `${basename(url, '.tar.gz')}/${folder(target)}` });
        files.push(file);
      }
      return measured({ kind: 'layers', entry: 'bin/cargo', layers }, files, inside);
    });
  };
}

/** Adoptium's names for the platforms. */
const TEMURIN_PLATFORMS: Record<Platform, string> = {
  'darwin-arm64': 'aarch64_mac',
  'darwin-x64': 'x64_mac',
  'linux-x64': 'x64_linux',
  'linux-arm64': 'aarch64_linux',
};

/**
 * The Temurin JDK, from Adoptium's releases on GitHub, `<feature>.<interim>.<update>+<build>`: each
 * archive signed with `keys`, Adoptium's.
 */
export function temurin(keys: readonly string[]): Source {
  return async (version, tools) => {
    const parts = /^(\d+)\.\d+\.\d+\+(\d+)$/.exec(version);
    const feature = parts?.[1];
    if (feature === undefined) throw new Error(`${version} isn’t a Temurin version`);
    // GitHub sends each download on to its host for release files.
    const hosts = ['github.com', 'release-assets.githubusercontent.com'];
    const tag = encodeURIComponent(`jdk-${version}`);
    const base = `https://github.com/adoptium/temurin${feature}-binaries/releases/download/${tag}/`;
    return everyPlatform(version, hosts, tools, async (platform, inside) => {
      const name = `OpenJDK${feature}U-jdk_${TEMURIN_PLATFORMS[platform]}_hotspot_${version.replace('+', '_')}.tar.gz`;
      const signature = await fetchBytes(`${base}${name}.sig`, hosts, inside);
      const { part, file } = await fetchPart(`${base}${name}`, hosts, inside);
      await verifyDetached(await readFile(file), signature, keys);
      inside.log(`${name} is signed with Adoptium's key.`);
      const home = platform.startsWith('darwin-')
        ? `jdk-${version}/Contents/Home`
        : `jdk-${version}`;
      return measured({ kind: 'tar.gz', ...part, entry: `${home}/bin/java` }, [file], inside);
    });
  };
}

/** What `pin.ts` reads of a `releases.json` of .NET's: each SDK's files, with their SHA-512s. */
const DOTNET_RELEASES = z.object({
  releases: z.array(
    z.object({
      sdks: z
        .array(
          z.object({
            version: z.string(),
            files: z.array(z.object({ name: z.string(), url: z.string(), hash: z.string() })),
          }),
        )
        .default([]),
    }),
  ),
});

/** .NET's names for the platforms. */
const DOTNET_PLATFORMS: Record<Platform, string> = {
  'darwin-arm64': 'osx-arm64',
  'darwin-x64': 'osx-x64',
  'linux-x64': 'linux-x64',
  'linux-arm64': 'linux-arm64',
};

/** What the SDK `version` downloads as `name`, as one `releases.json` lists it. */
function dotnetFile(
  releases: z.infer<typeof DOTNET_RELEASES>,
  version: string,
  name: string,
): { url: string; hash: string } | undefined {
  const sdk = releases.releases
    .flatMap((release) => release.sdks)
    .find((each) => each.version === version);
  const file = sdk?.files.find((each) => each.name === name);
  return file && { url: file.url, hash: file.hash.toLowerCase() };
}

/** The SHA-512 of the file at `path`, in lowercase hex. */
async function sha512(path: string): Promise<string> {
  return createHash('sha512')
    .update(await readFile(path))
    .digest('hex');
}

/**
 * The .NET SDK, from builds.dotnet.microsoft.com. It has no signature, so each archive's SHA-512
 * must be the one listed by both Microsoft's download site and the dotnet/core repository on
 * GitHub, two hosts run apart.
 */
export function dotnet(): Source {
  return async (version, tools) => {
    const parts = /^(\d+\.\d+)\.\d+$/.exec(version);
    const channel = parts?.[1];
    if (channel === undefined) throw new Error(`${version} isn’t a .NET SDK version`);
    const hosts = ['builds.dotnet.microsoft.com'];
    const lists = await Promise.all([
      fetchJson(
        `https://builds.dotnet.microsoft.com/dotnet/release-metadata/${channel}/releases.json`,
        DOTNET_RELEASES,
        hosts,
        tools,
      ),
      fetchJson(
        `https://raw.githubusercontent.com/dotnet/core/main/release-notes/${channel}/releases.json`,
        DOTNET_RELEASES,
        ['raw.githubusercontent.com'],
        tools,
      ),
    ]);
    return everyPlatform(version, hosts, tools, async (platform, inside) => {
      const name = `dotnet-sdk-${DOTNET_PLATFORMS[platform]}.tar.gz`;
      const [site, repository] = lists.map((list) => dotnetFile(list, version, name));
      if (site === undefined || repository === undefined) {
        throw new Error(`Both releases.json files must list ${name} for SDK ${version}`);
      }
      if (site.url !== repository.url || site.hash !== repository.hash) {
        throw new Error(`The two releases.json files list ${name} for SDK ${version} differently`);
      }
      const { part, file } = await fetchPart(site.url, hosts, inside);
      if ((await sha512(file)) !== site.hash) {
        throw new Error(`${name} isn’t what both releases.json files list`);
      }
      inside.log(`${name} has the SHA-512 both releases.json files list.`);
      return measured({ kind: 'tar.gz', ...part, entry: 'dotnet' }, [file], inside);
    });
  };
}

/** How swift.org's builds' addresses and names spell each processor: x86-64 by nothing. */
const SWIFT_ARCHES: Record<(typeof SWIFT_PLATFORMS)[number], string> = {
  'linux-x64': '',
  'linux-arm64': '-aarch64',
};

/**
 * Swift for the Linux distribution `distro`, from download.swift.org, `<major>.<minor>` or
 * `<major>.<minor>.<patch>` as swift.org names its releases: the archive for each processor, signed
 * with one of `keys`, swift.org's, its entry point SourceKit-LSP. It unpacks to more than the
 * other downloads, so it's measured within `limits`, its own.
 */
export function swift(
  distro: SwiftDistro,
  keys: readonly string[],
  limits: UnpackLimits = SWIFT_UNPACK_LIMITS,
): Source {
  return async (version, tools) => {
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) {
      throw new Error(`${version} isn’t a Swift version`);
    }
    const hosts = ['download.swift.org'];
    const release = `swift-${version}-RELEASE`;
    const each = async (platform: (typeof SWIFT_PLATFORMS)[number], inside: Tools) => {
      const arch = SWIFT_ARCHES[platform];
      const name = `${release}-${distro.file}${arch}`;
      const url = `https://download.swift.org/swift-${version}-release/${distro.id}${arch}/${release}/${name}.tar.gz`;
      const signature = await fetchBytes(`${url}.sig`, hosts, inside);
      const { part, file } = await fetchPart(url, hosts, inside);
      await verifyDetached(await readFile(file), signature, keys);
      inside.log(`${name}.tar.gz is signed with swift.org's key.`);
      const download = { kind: 'tar.gz', ...part, entry: `${name}/usr/bin/sourcekit-lsp` } as const;
      return measured(download, [file], inside, limits);
    };
    return everyPlatform(
      version,
      hosts,
      tools,
      (platform, inside) => {
        if (platform !== 'linux-x64' && platform !== 'linux-arm64') {
          throw new Error(`swift.org builds no Swift for ${platform}`);
        }
        return each(platform, inside);
      },
      SWIFT_PLATFORMS,
    );
  };
}
