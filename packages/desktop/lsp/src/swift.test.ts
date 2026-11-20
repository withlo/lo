// Swift on Linux: which of swift.org's builds a system takes, by what its /etc/os-release says, and
// which of the packages swift.org lists for it aren't installed, by dpkg's list or a stand-in for
// rpm. Nothing here downloads Swift or runs the system's rpm.

import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { tempFolder } from '../test/support.ts';
import { limitsFor, UNPACKED_MARGIN } from './install.ts';
import { downloadFor, parseToolchains, TOOLCHAINS } from './manifest.ts';
import {
  installedDebs,
  missingPackages,
  packagesFor,
  packagesNeeded,
  parseOsRelease,
  readOsRelease,
  RPM_WAIT,
  SWIFT_DISTROS,
  SWIFT_PLATFORMS,
  type SwiftDistro,
  swiftDistroFor,
  swiftDistroOf,
  swiftToolchainId,
  toolchainsFor,
} from './swift.ts';
import { UNPACK_LIMITS } from './unpack.ts';

/** The distribution swift.org builds for by `id`. */
function distro(id: string): SwiftDistro {
  const found = SWIFT_DISTROS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no ${id}`);
  return found;
}

/** The distribution a system whose /etc/os-release holds `lines` takes, by its ID. */
function taken(...lines: string[]): string | undefined {
  return swiftDistroFor(parseOsRelease(lines.join('\n')))?.id;
}

describe('/etc/os-release', () => {
  test('is read as a shell would read its variables, quotes and escapes aside', () => {
    const release = parseOsRelease(
      [
        '# A comment',
        'NAME="Ubuntu"',
        "VERSION_ID='26.04'",
        'ID=ubuntu',
        'PRETTY_NAME="Ubuntu \\"Resolute\\" \\$HOME"',
        '',
        '  ID_LIKE=debian  ',
        'not a variable',
      ].join('\n'),
    );
    expect(Object.fromEntries(release)).toEqual({
      NAME: 'Ubuntu',
      VERSION_ID: '26.04',
      ID: 'ubuntu',
      PRETTY_NAME: 'Ubuntu "Resolute" $HOME',
      ID_LIKE: 'debian',
    });
  });

  test('is /usr/lib/os-release when there’s no /etc/os-release, and nothing when neither is', () => {
    const folder = tempFolder();
    const usr = join(folder, 'usr-os-release');
    writeFileSync(usr, 'ID=fedora\nVERSION_ID=43\n');
    expect(readOsRelease([join(folder, 'etc-os-release'), usr]).get('ID')).toBe('fedora');
    expect(readOsRelease([join(folder, 'none')]).size).toBe(0);
  });
});

describe('the build a Linux takes', () => {
  test('is its own release’s, for each release swift.org builds for', () => {
    expect(taken('ID=ubuntu', 'VERSION_ID="26.04"', 'UBUNTU_CODENAME=resolute')).toBe('ubuntu2604');
    expect(taken('ID=ubuntu', 'VERSION_ID="24.04"', 'UBUNTU_CODENAME=noble')).toBe('ubuntu2404');
    expect(taken('ID=ubuntu', 'VERSION_ID="22.04"')).toBe('ubuntu2204');
    expect(taken('ID=debian', 'VERSION_ID="13"', 'VERSION_CODENAME=trixie')).toBe('debian13');
    expect(taken('ID=debian', 'VERSION_ID="12"')).toBe('debian12');
    expect(taken('ID=fedora', 'VERSION_ID=41')).toBe('fedora41');
    expect(taken('ID="rhel"', 'ID_LIKE="fedora"', 'VERSION_ID="9.6"')).toBe('ubi9');
  });

  test('is the release a distribution built on another names', () => {
    // Linux Mint and Pop!_OS, on Ubuntu.
    expect(
      taken(
        'ID=linuxmint',
        'ID_LIKE="ubuntu debian"',
        'VERSION_ID="23"',
        'UBUNTU_CODENAME=resolute',
      ),
    ).toBe('ubuntu2604');
    expect(
      taken('ID=pop', 'ID_LIKE="ubuntu debian"', 'VERSION_ID="24.04"', 'UBUNTU_CODENAME=noble'),
    ).toBe('ubuntu2404');
    // Linux Mint Debian Edition.
    expect(
      taken('ID=linuxmint', 'ID_LIKE=debian', 'VERSION_ID="7"', 'DEBIAN_CODENAME=trixie'),
    ).toBe('debian13');
    // Rocky Linux, AlmaLinux and CentOS Stream, on Red Hat Enterprise Linux.
    expect(taken('ID="rocky"', 'ID_LIKE="rhel centos fedora"', 'VERSION_ID="9.6"')).toBe('ubi9');
    expect(taken('ID="almalinux"', 'ID_LIKE="rhel centos fedora"', 'VERSION_ID="9.4"')).toBe(
      'ubi9',
    );
    expect(taken('ID="centos"', 'ID_LIKE="rhel fedora"', 'VERSION_ID="9"')).toBe('ubi9');
  });

  test('is Fedora 41’s for every Fedora since, which swift.org builds for no longer', () => {
    for (const version of ['42', '43', '44', '45']) {
      expect(taken('ID=fedora', `VERSION_ID=${version}`)).toBe('fedora41');
    }
    expect(taken('ID=fedora', 'VERSION_ID=40')).toBeUndefined();
    // A version that isn't a whole number isn't one of Fedora's.
    for (const version of ['', '42.1', '42a', ' 42', 'rawhide']) {
      expect(taken('ID=fedora', `VERSION_ID="${version}"`)).toBeUndefined();
    }
    // Fedora itself: a distribution built on it doesn't say which Fedora, and its versions are its
    // own, as Amazon Linux 2023's and CentOS Stream 10's are.
    expect(taken('ID=ultramarine', 'ID_LIKE=fedora', 'VERSION_ID=43')).toBeUndefined();
    expect(taken('ID="amzn"', 'ID_LIKE="fedora"', 'VERSION_ID="2023"')).toBeUndefined();
    expect(taken('ID="centos"', 'ID_LIKE="rhel fedora"', 'VERSION_ID="10"')).toBeUndefined();
  });

  test('is Red Hat’s for a version of its 9, as Red Hat writes versions, and for no other', () => {
    const rhel = (version: string) =>
      taken('ID="rhel"', 'ID_LIKE="fedora"', `VERSION_ID="${version}"`);
    for (const version of ['9', '9.0', '9.6', '9.6.1']) expect(rhel(version)).toBe('ubi9');
    // Not one that starts with 9 but isn't a version, nor one whose first part is 9 and more.
    for (const version of ['', '9.', '.9', '9a', '9.6-beta', ' 9', 'v9', '9,6', '19', '99']) {
      expect(rhel(version)).toBeUndefined();
    }
    expect(taken('ID="rhel"', 'ID_LIKE="fedora"')).toBeUndefined();
  });

  test('is none for a Linux swift.org builds nothing for, or one Lo can’t tell', () => {
    // Ubuntu's releases between its long-term ones, and the one before 22.04.
    expect(taken('ID=ubuntu', 'VERSION_ID="25.10"', 'UBUNTU_CODENAME=questing')).toBeUndefined();
    expect(taken('ID=ubuntu', 'VERSION_ID="20.04"', 'UBUNTU_CODENAME=focal')).toBeUndefined();
    // Debian's next release, while it's testing, and a release of another distribution's.
    expect(taken('ID=debian', 'VERSION_CODENAME=forky')).toBeUndefined();
    expect(taken('ID=kali', 'ID_LIKE=debian', 'VERSION_ID="2026.3"')).toBeUndefined();
    // Red Hat Enterprise Linux 8 and 10, Arch, openSUSE and NixOS.
    expect(taken('ID="rhel"', 'ID_LIKE="fedora"', 'VERSION_ID="8.10"')).toBeUndefined();
    expect(taken('ID="rhel"', 'ID_LIKE="fedora"', 'VERSION_ID="10.0"')).toBeUndefined();
    expect(taken('ID=arch')).toBeUndefined();
    expect(taken('ID="opensuse-tumbleweed"', 'ID_LIKE="opensuse suse"')).toBeUndefined();
    expect(taken('ID=nixos', 'VERSION_ID="26.05"')).toBeUndefined();
    expect(taken()).toBeUndefined();
  });
});

describe('the toolchains pinned', () => {
  test('hold Swift for each distribution, for x64 and arm64, all at one version, as SourceKit-LSP', () => {
    const versions = new Set<string>();
    for (const each of SWIFT_DISTROS) {
      const id = swiftToolchainId(each);
      expect(swiftDistroOf(id)).toBe(each);
      const pinned = TOOLCHAINS[id];
      if (pinned === undefined) throw new Error(`toolchains.json has no ${id}`);
      versions.add(pinned.version);
      expect(pinned.hosts).toEqual(['download.swift.org']);
      expect(Object.keys(pinned.platforms).toSorted()).toEqual([...SWIFT_PLATFORMS].toSorted());
      for (const platform of SWIFT_PLATFORMS) {
        const arch = platform === 'linux-arm64' ? '-aarch64' : '';
        const name = `swift-${pinned.version}-RELEASE-${each.file}${arch}`;
        expect(downloadFor(pinned, platform)).toMatchObject({
          kind: 'tar.gz',
          url: `https://download.swift.org/swift-${pinned.version}-release/${each.id}${arch}/swift-${pinned.version}-RELEASE/${name}.tar.gz`,
          entry: `${name}/usr/bin/sourcekit-lsp`,
        });
      }
    }
    expect(versions.size).toBe(1);
    expect(swiftDistroOf('go')).toBeUndefined();
  });

  test('cap each Swift install at what it unpacks to and 5% more, past the 2 GB the rest share', () => {
    for (const each of SWIFT_DISTROS) {
      for (const platform of SWIFT_PLATFORMS) {
        const download = TOOLCHAINS[swiftToolchainId(each)]?.platforms[platform];
        if (download?.unpacked === undefined) throw new Error('no size recorded');
        expect(download.unpacked).toBeGreaterThan(UNPACK_LIMITS.bytes);
        expect(limitsFor(download)).toEqual({
          entries: UNPACK_LIMITS.entries,
          bytes: Math.ceil(download.unpacked * (1 + UNPACKED_MARGIN)),
        });
      }
    }
    // One that doesn't say what it unpacks to is refused, so none is held to the shared limit.
    const pinned = TOOLCHAINS['swift-ubuntu2604'];
    const download = pinned?.platforms['linux-x64'];
    const changed = { ...pinned, platforms: { 'linux-x64': { ...download, unpacked: undefined } } };
    expect(() => parseToolchains({ 'swift-ubuntu2604': changed })).toThrow(
      /doesn't say what it unpacks to/,
    );
  });

  test('that a system may install hold Swift only for the distribution it takes', () => {
    expect(Object.keys(toolchainsFor(TOOLCHAINS, distro('fedora41')))).toEqual([
      'dotnet',
      'go',
      'rust',
      'swift-fedora41',
      'temurin',
    ]);
    // On macOS, or a Linux none fits, none of Swift's.
    expect(Object.keys(toolchainsFor(TOOLCHAINS, undefined))).toEqual([
      'dotnet',
      'go',
      'rust',
      'temurin',
    ]);
  });
});

/** A package's paragraph in dpkg's list, its `Status` as given, with `more` fields. */
function paragraph(name: string, status: string, more: readonly string[] = []): string {
  return [
    `Package: ${name}`,
    `Status: ${status}`,
    'Architecture: amd64',
    ...more,
    'Description: a package',
    ' Package: not-a-field',
  ].join('\n');
}

/** dpkg's list, with `installed` installed and `removed` removed but for their settings. */
function dpkgStatus(installed: readonly string[], removed: readonly string[] = []): string {
  return [
    ...installed.map((name) => paragraph(name, 'install ok installed')),
    ...removed.map((name) => paragraph(name, 'deinstall ok config-files')),
    // A package held at its version is installed too, and so is what it provides.
    paragraph('gnupg', 'hold ok installed', ['Provides: gnupg2 (= 2.4.8), gpg-agent']),
    paragraph('zip', 'install ok half-installed'),
  ].join('\n\n');
}

describe('the packages missing', () => {
  const ubuntu = distro('ubuntu2604');
  const fedora = distro('fedora41');

  test('are those dpkg’s list doesn’t say are installed, in swift.org’s order', async () => {
    const status = join(tempFolder(), 'status');
    const all = ubuntu.packages.names;
    writeFileSync(
      status,
      dpkgStatus(
        all.filter((name) => !['libc6-dev', 'libxml2-dev', 'gnupg2', 'zip'].includes(name)),
        ['libxml2-dev'],
      ),
    );
    const release = parseOsRelease('ID=ubuntu\nVERSION_ID="26.04"');
    expect(await missingPackages(ubuntu, { dpkgStatus: status, release })).toEqual([
      'libc6-dev',
      'libxml2-dev',
      'zip',
    ]);
    expect(installedDebs(dpkgStatus([])).has('not-a-field')).toBe(false);
    // With no list, Lo can't tell, and stands in nothing's way.
    const none = join(tempFolder(), 'none');
    expect(await missingPackages(ubuntu, { dpkgStatus: none, release })).toEqual([]);
  });

  test('are those rpm says nothing installed provides', async () => {
    const folder = tempFolder();
    const rpm = join(folder, 'rpm');
    const asked = join(folder, 'asked');
    // A stand-in that answers as rpm does, as if three weren't installed, and notes how it ran.
    writeFileSync(
      rpm,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$*" "PATH=$PATH LC_ALL=$LC_ALL $(pwd)" >'${asked}'`,
        'failed=0',
        'shift 4',
        'for name in "$@"; do',
        '  case " libxml2-devel python3-devel libxml2_2.13 " in',
        '    *" $name "*) echo "no package provides $name"; failed=$((failed + 1));;',
        '    *) echo "$name";;',
        '  esac',
        'done',
        'exit $failed',
      ].join('\n'),
    );
    chmodSync(rpm, 0o755);
    const release = parseOsRelease('ID=fedora\nVERSION_ID=44');
    expect(await missingPackages(fedora, { rpm, release })).toEqual([
      'libxml2-devel',
      'python3-devel',
    ]);
    expect(readFileSync(asked, 'utf8').split('\n')).toEqual([
      `--query --whatprovides --queryformat %{NAME}\\n ${fedora.packages.names.join(' ')}`,
      'PATH=/usr/bin:/bin LC_ALL=C /',
      '',
    ]);
    // Fedora 45 keeps the libxml2 the build links in a package of its own.
    const later = parseOsRelease('ID=fedora\nVERSION_ID=45');
    expect(packagesFor(fedora, later)).toEqual([...fedora.packages.names, 'libxml2_2.13']);
    expect(await missingPackages(fedora, { rpm, release: later })).toEqual([
      'libxml2-devel',
      'python3-devel',
      'libxml2_2.13',
    ]);
    // With no rpm, Lo can't tell.
    expect(await missingPackages(fedora, { rpm: join(folder, 'none'), release })).toEqual([]);
  });

  test('are none when rpm doesn’t say in time, since Lo can’t tell, whatever it said by then', async () => {
    expect(RPM_WAIT).toBe(30_000);
    const rpm = join(tempFolder(), 'rpm');
    // A stand-in that says one isn't installed, then hangs.
    writeFileSync(
      rpm,
      ['#!/bin/sh', 'echo "no package provides libxml2-devel"', 'exec sleep 60'].join('\n'),
    );
    chmodSync(rpm, 0o755);
    const release = parseOsRelease('ID=fedora\nVERSION_ID=44');
    const started = performance.now();
    expect(await missingPackages(fedora, { rpm, release, rpmWait: 300 })).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test('are named, with the command that installs them', () => {
    expect(packagesNeeded(ubuntu, ['libc6-dev', 'libxml2-dev', 'zip'])).toEqual({
      needs: 'the packages libc6-dev, libxml2-dev and zip',
      install: 'sudo apt-get install libc6-dev libxml2-dev zip',
      plural: true,
    });
    expect(packagesNeeded(fedora, ['python3-devel'])).toEqual({
      needs: 'the package python3-devel',
      install: 'sudo dnf install python3-devel',
      plural: false,
    });
  });

  test('fit in what a server’s state may say, however many are missing', () => {
    for (const each of SWIFT_DISTROS) {
      const all = packagesFor(each, parseOsRelease('VERSION_ID=99'));
      const { needs, install } = packagesNeeded(each, all);
      expect(needs.length).toBeLessThanOrEqual(400);
      expect(install.length).toBeLessThanOrEqual(400);
    }
  });
});
