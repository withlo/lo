/**
 * Swift on Linux. Apple's Command Line Tools have no Linux, so there Lo downloads Swift's toolchain
 * itself, from download.swift.org, which builds one for each Linux distribution it supports: they
 * link the distribution's own libraries, so each runs only on its own. `toolchains.json` pins one
 * entry for each, `swift-<distribution>` ({@link swiftToolchainId}), with an archive for x64 and
 * one for arm64, checked against swift.org's signature when it's pinned. SourceKit-LSP, Swift's
 * language server, comes in the toolchain.
 *
 * Which entry a system takes is read from `/etc/os-release` ({@link swiftDistroFor}): the
 * distribution swift.org builds for, or one built on it that names which release there, as Linux
 * Mint does Ubuntu's. A system none of them fits gets no Swift server, and Swift answers from the
 * syntax index.
 *
 * Each distribution's build needs some of its packages installed, which swift.org's instructions
 * for installing the toolchain list ({@link SWIFT_DISTROS}). Lo installs nothing on the system, so
 * when any of them is missing ({@link missingPackages}) Swift's server says which, and the command
 * that installs them, rather than downloading a toolchain that can't run.
 *
 * The distributions are those swift.org gives install instructions for, and so a list of packages,
 * all of them installed with deb or rpm packages, as Lo is on Linux. It also builds for Amazon
 * Linux 2023 and Red Hat's UBI 10, but lists no packages for them.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { Manifest, Platform } from './manifest.ts';
import { UNPACK_LIMITS, type UnpackLimits } from './unpack.ts';

/**
 * Which releases of a distribution a build of swift.org's is for, by what `/etc/os-release` says:
 *
 * - `ubuntu`: the release `version` (`VERSION_ID`), or one built on it, which names its
 *   `codename` in `UBUNTU_CODENAME`, as Linux Mint and Pop!_OS do;
 * - `debian`: the release `version`, or one built on it that names its `codename` in
 *   `DEBIAN_CODENAME`, as Linux Mint Debian Edition does;
 * - `fedora`: Fedora `since` and every release after it, since swift.org builds for one Fedora
 *   alone, and keeps it after Fedora stops supporting it, while Fedora releases twice a year. Of
 *   the system's libraries, SourceKit-LSP and what it loads link only glibc's, GCC's runtime,
 *   libstdc++, libcurl, libxml2, SQLite, ncurses, libuuid and zlib, and the Fedoras since keep
 *   each under the name it links, libxml2's in a package of its own from Fedora 45
 *   (`packages.since`). Fedora itself only: a distribution built on Fedora, such as Amazon Linux,
 *   says so in `ID_LIKE` but not which Fedora, and its own versions are no Fedora's;
 * - `rhel`: every release of Red Hat Enterprise Linux with the major version `major`, or of a
 *   distribution built on it, which says so in `ID_LIKE`, as Rocky Linux and AlmaLinux do.
 */
export type SwiftRelease =
  | { readonly kind: 'ubuntu'; readonly version: string; readonly codename: string }
  | { readonly kind: 'debian'; readonly version: string; readonly codename: string }
  | { readonly kind: 'fedora'; readonly since: number }
  | { readonly kind: 'rhel'; readonly major: number };

/** A Linux distribution swift.org builds Swift for. */
export interface SwiftDistro {
  /** swift.org's name for it, in its builds' addresses, and in the ID Lo pins it by: `ubuntu2604`. */
  readonly id: string;
  /** What a sentence calls it: "Ubuntu 26.04". */
  readonly name: string;
  /** How its archives' names spell it: `ubuntu26.04`. */
  readonly file: string;
  /** Which systems take it. */
  readonly release: SwiftRelease;
  /**
   * What installs its packages, `apt` or `dnf`, and those swift.org's instructions for installing
   * the toolchain list for it, in their order; and those a later release of a distribution whose
   * releases take the build (`fedora`) needs besides, from the `VERSION_ID` each names
   * ({@link packagesFor}).
   */
  readonly packages: {
    readonly manager: 'apt' | 'dnf';
    readonly names: readonly string[];
    readonly since?: readonly { readonly version: number; readonly names: readonly string[] }[];
  };
}

/**
 * The distributions swift.org builds Swift for and lists packages for, in its instructions for
 * installing the toolchain from its archive (swift.org/install/linux/tarball), as of Swift 6.4.2.
 */
export const SWIFT_DISTROS: readonly SwiftDistro[] = [
  {
    id: 'ubuntu2604',
    name: 'Ubuntu 26.04',
    file: 'ubuntu26.04',
    release: { kind: 'ubuntu', version: '26.04', codename: 'resolute' },
    packages: {
      manager: 'apt',
      names: [
        'binutils',
        'binutils-gold',
        'git',
        'gnupg2',
        'libc6-dev',
        'libcurl4-openssl-dev',
        'libedit2',
        'libgcc-15-dev',
        'libpython3-dev',
        'libsqlite3-0',
        'libstdc++-15-dev',
        'libxml2-dev',
        'libncurses-dev',
        'libz3-dev',
        'pkg-config',
        'tzdata',
        'unzip',
        'zip',
        'zlib1g-dev',
      ],
    },
  },
  {
    id: 'ubuntu2404',
    name: 'Ubuntu 24.04',
    file: 'ubuntu24.04',
    release: { kind: 'ubuntu', version: '24.04', codename: 'noble' },
    packages: {
      manager: 'apt',
      names: [
        'binutils',
        'git',
        'gnupg2',
        'libc6-dev',
        'libcurl4-openssl-dev',
        'libedit2',
        'libgcc-13-dev',
        'libncurses-dev',
        'libpython3-dev',
        'libsqlite3-0',
        'libstdc++-13-dev',
        'libxml2-dev',
        'libz3-dev',
        'pkg-config',
        'tzdata',
        'zip',
        'unzip',
        'zlib1g-dev',
      ],
    },
  },
  {
    id: 'ubuntu2204',
    name: 'Ubuntu 22.04',
    file: 'ubuntu22.04',
    release: { kind: 'ubuntu', version: '22.04', codename: 'jammy' },
    packages: {
      manager: 'apt',
      names: [
        'binutils',
        'git',
        'gnupg2',
        'libc6-dev',
        'libcurl4-openssl-dev',
        'libedit2',
        'libgcc-11-dev',
        'libpython3-dev',
        'libsqlite3-0',
        'libstdc++-11-dev',
        'libxml2-dev',
        'libz3-dev',
        'pkg-config',
        'python3-lldb-13',
        'tzdata',
        'zip',
        'unzip',
        'zlib1g-dev',
      ],
    },
  },
  {
    id: 'debian13',
    name: 'Debian 13',
    file: 'debian13',
    release: { kind: 'debian', version: '13', codename: 'trixie' },
    packages: {
      manager: 'apt',
      names: [
        'binutils',
        'binutils-gold',
        'gcc',
        'git',
        'libcurl4-openssl-dev',
        'libedit-dev',
        'libicu-dev',
        'libncurses-dev',
        'libpython3-dev',
        'libsqlite3-dev',
        'libstdc++-14-dev',
        'libxml2-dev',
        'pkg-config',
        'tzdata',
        'unzip',
        'uuid-dev',
        'zip',
      ],
    },
  },
  {
    id: 'debian12',
    name: 'Debian 12',
    file: 'debian12',
    release: { kind: 'debian', version: '12', codename: 'bookworm' },
    packages: {
      manager: 'apt',
      names: [
        'binutils-gold',
        'gcc',
        'git',
        'libcurl4-openssl-dev',
        'libedit-dev',
        'libicu-dev',
        'libncurses-dev',
        'libpython3-dev',
        'libsqlite3-dev',
        'libxml2-dev',
        'pkg-config',
        'tzdata',
        'uuid-dev',
      ],
    },
  },
  {
    id: 'fedora41',
    name: 'Fedora 41',
    file: 'fedora41',
    release: { kind: 'fedora', since: 41 },
    packages: {
      manager: 'dnf',
      names: [
        'binutils',
        'gcc',
        'git',
        'libcurl-devel',
        'libedit-devel',
        'libicu-devel',
        'libuuid-devel',
        'libstdc++-devel',
        'libstdc++-static',
        'libxml2-devel',
        'python3-devel',
        'sqlite-devel',
        'unzip',
        'zip',
      ],
      // Fedora 45 moved libxml2 on to `libxml2.so.16`, and keeps the `libxml2.so.2` the build's
      // Foundation links in a package of its own.
      since: [{ version: 45, names: ['libxml2_2.13'] }],
    },
  },
  {
    id: 'ubi9',
    name: 'Red Hat Enterprise Linux 9',
    file: 'ubi9',
    release: { kind: 'rhel', major: 9 },
    packages: {
      manager: 'dnf',
      names: [
        'git',
        'gcc-c++',
        'libcurl-devel',
        'libedit-devel',
        'libuuid-devel',
        'libxml2-devel',
        'ncurses-devel',
        'python3-devel',
        'rsync',
        'sqlite-devel',
        'unzip',
        'zip',
      ],
    },
  },
];

/** The platforms swift.org builds Swift for Linux on, which each of Lo's Swift entries pins. */
export const SWIFT_PLATFORMS = ['linux-x64', 'linux-arm64'] as const satisfies readonly Platform[];

/** The ID `toolchains.json` pins Swift for `distro` by: `swift-ubuntu2604`. */
export function swiftToolchainId(distro: SwiftDistro): string {
  return `swift-${distro.id}`;
}

/** The distribution toolchain `id` is Swift for, if it's one of Swift's. */
export function swiftDistroOf(id: string): SwiftDistro | undefined {
  return SWIFT_DISTROS.find((distro) => swiftToolchainId(distro) === id);
}

/**
 * The toolchains in `manifest` this system may install: all but Swift's for distributions other
 * than `distro`, the one this Linux takes, so on macOS, or a Linux none fits, none of Swift's.
 */
export function toolchainsFor(manifest: Manifest, distro: SwiftDistro | undefined): Manifest {
  return Object.fromEntries(
    Object.entries(manifest).filter(([id]) => {
      const swift = swiftDistroOf(id);
      return swift === undefined || swift === distro;
    }),
  );
}

/**
 * The most `pin.ts` lets Swift's toolchain unpack to as it measures it, rather than the 2 GB the
 * other downloads share: swift.org's builds for Linux unpack to about 3.5 GB. Each is then held,
 * as every toolchain is, to what it was measured to unpack to and 5% more.
 */
export const SWIFT_UNPACK_LIMITS: UnpackLimits = { ...UNPACK_LIMITS, bytes: 6 * 1024 ** 3 };

/** What `/etc/os-release` says, by its variables' names. */
export type OsRelease = ReadonlyMap<string, string>;

/**
 * Reads `text` as `/etc/os-release` is written: a variable a line, `NAME=value`, the value perhaps
 * in quotes, double ones with backslashes before the characters a shell would take otherwise.
 * Comments, blank lines and anything else are left out.
 */
export function parseOsRelease(text: string): OsRelease {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    const [, name, value] = match ?? [];
    if (name === undefined || value === undefined) continue;
    fields.set(name, unquoted(value));
  }
  return fields;
}

/** `value` without the quotes around it, and in double ones, the backslashes that escape. */
function unquoted(value: string): string {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value.length < 2 || !value.endsWith(quote)) return value;
  const inside = value.slice(1, -1);
  return quote === '"' ? inside.replace(/\\(.)/g, '$1') : inside;
}

/** Where a Linux system says what it is, the first that's there: os-release(5). */
export const OS_RELEASE = ['/etc/os-release', '/usr/lib/os-release'] as const;

/** What this system's `/etc/os-release`, or the file in its place, says, or nothing. */
export function readOsRelease(paths: readonly string[] = OS_RELEASE): OsRelease {
  for (const path of paths) {
    try {
      return parseOsRelease(readFileSync(path, 'utf8'));
    } catch {
      // The next.
    }
  }
  return new Map();
}

/** The distribution whose build of Swift a system that says `release` takes, if one fits. */
export function swiftDistroFor(release: OsRelease): SwiftDistro | undefined {
  return SWIFT_DISTROS.find((distro) => takes(distro.release, release));
}

/** Whether a system that says `release` takes builds for `wanted`. */
function takes(wanted: SwiftRelease, release: OsRelease): boolean {
  const id = release.get('ID') ?? '';
  const like = (release.get('ID_LIKE') ?? '').split(/\s+/);
  const version = release.get('VERSION_ID') ?? '';
  const is = (name: string) => id === name || like.includes(name);
  switch (wanted.kind) {
    case 'ubuntu':
      return (
        is('ubuntu') &&
        (release.get('UBUNTU_CODENAME') === wanted.codename ||
          (id === 'ubuntu' && version === wanted.version))
      );
    case 'debian':
      return (
        (id === 'debian' && version === wanted.version) ||
        (like.includes('debian') && release.get('DEBIAN_CODENAME') === wanted.codename)
      );
    case 'fedora':
      return id === 'fedora' && /^\d+$/.test(version) && Number(version) >= wanted.since;
    case 'rhel':
      return is('rhel') && Number(/^(\d+)(?:\.\d+)*$/.exec(version)?.[1]) === wanted.major;
    default:
      wanted satisfies never;
      return false;
  }
}

/**
 * The packages `distro`'s build needs on a system that says `release`: those swift.org lists, in
 * its order, then those the system's release needs besides.
 */
export function packagesFor(distro: SwiftDistro, release: OsRelease): readonly string[] {
  const version = Number(release.get('VERSION_ID'));
  const later = (distro.packages.since ?? []).filter((each) => version >= each.version);
  return [...distro.packages.names, ...later.flatMap((each) => each.names)];
}

/** Where Lo looks for which of a distribution's packages are installed. */
export interface PackageQuery {
  /** What the system says it is, which some packages depend on: its `/etc/os-release`. */
  readonly release?: OsRelease | undefined;
  /** dpkg's list of packages, which Debian and Ubuntu keep: `/var/lib/dpkg/status`. */
  readonly dpkgStatus?: string | undefined;
  /** rpm, which Fedora and Red Hat's distributions are asked theirs with: `/usr/bin/rpm`. */
  readonly rpm?: string | undefined;
  /** How long rpm may take to say, in milliseconds: {@link RPM_WAIT}. */
  readonly rpmWait?: number | undefined;
}

/** How long rpm may take to say which packages are installed, in milliseconds. */
export const RPM_WAIT = 30_000;

/**
 * The packages `distro`'s build needs that aren't installed ({@link packagesFor}), by the name each
 * is installed by or one an installed package provides, as `apt` and `dnf` take them. On Debian and
 * Ubuntu Lo reads dpkg's list; on Fedora and Red Hat's it asks rpm, by its absolute path, with no
 * shell and only the system's `PATH`. When it can't tell, as when there's no list or no rpm, it
 * says none is missing, and the toolchain is downloaded all the same.
 */
export async function missingPackages(
  distro: SwiftDistro,
  query: PackageQuery = {},
): Promise<readonly string[]> {
  const { manager } = distro.packages;
  const names = packagesFor(distro, query.release ?? readOsRelease());
  switch (manager) {
    case 'apt': {
      let text: string;
      try {
        text = await readFile(query.dpkgStatus ?? '/var/lib/dpkg/status', 'utf8');
      } catch {
        return [];
      }
      const installed = installedDebs(text);
      return names.filter((name) => !installed.has(name));
    }
    case 'dnf':
      return missingRpms(names, query.rpm ?? '/usr/bin/rpm', query.rpmWait ?? RPM_WAIT);
    default:
      manager satisfies never;
      return [];
  }
}

/**
 * The packages dpkg's list `text` says are installed, by their names and the names they provide.
 * Each package has a paragraph of its own, and is installed when the last word of its `Status`
 * is `installed`.
 */
export function installedDebs(text: string): ReadonlySet<string> {
  const installed = new Set<string>();
  for (const paragraph of text.split(/\n\s*\n/)) {
    const field = (name: string) =>
      new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(paragraph)?.[1]?.trim();
    const name = field('Package');
    if (name === undefined || field('Status')?.split(/\s+/)[2] !== 'installed') continue;
    installed.add(name);
    // `Provides: a (= 1.0), b`: the names alone.
    for (const provided of (field('Provides') ?? '').split(',')) {
      const each = provided.trim().split(/[\s(]/)[0];
      if (each !== undefined && each !== '') installed.add(each);
    }
  }
  return installed;
}

/** Those of `names` no installed package provides, as `rpm` at `program` says within `wait` ms. */
async function missingRpms(
  names: readonly string[],
  program: string,
  wait: number,
): Promise<string[]> {
  let output: string;
  try {
    const { stdout } = await promisify(execFile)(
      program,
      ['--query', '--whatprovides', '--queryformat', '%{NAME}\\n', ...names],
      {
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        cwd: '/',
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: wait,
      },
    );
    output = stdout;
  } catch (error) {
    // rpm fails when anything isn't installed, and says what in its output. One that couldn't run,
    // or ran out of time, leaves Lo unable to tell.
    if (typeof error !== 'object' || error === null) return [];
    if ('killed' in error && error.killed === true) return [];
    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
    output = `${stdout}\n${stderr}`;
  }
  const missing = new Set(
    output
      .split('\n')
      .flatMap((line) => /^no package provides (\S+)$/.exec(line.trim())?.[1] ?? []),
  );
  return names.filter((name) => missing.has(name));
}

/**
 * What Swift's server says when `missing`, packages of `distro`'s, aren't installed: what it
 * needs, "the packages libc6-dev and libxml2-dev", and the command that installs them.
 */
export function packagesNeeded(
  distro: SwiftDistro,
  missing: readonly string[],
): { needs: string; install: string; plural: boolean } {
  const plural = missing.length > 1;
  const listed =
    missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
  const manager = distro.packages.manager === 'apt' ? 'apt-get' : 'dnf';
  return {
    needs: `the ${plural ? 'packages' : 'package'} ${listed ?? ''}`,
    install: `sudo ${manager} install ${missing.join(' ')}`,
    plural,
  };
}
