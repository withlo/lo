import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'cask.sh');
const root = join(here, '..', '..');

/** Made-up SHA-256s, as sha256sum writes them, for the arm64 DMG and the x64 one. CI uses these too. */
const ARM64 = '0123456789abcdef'.repeat(4);
const X64 = 'fedcba9876543210'.repeat(4);

/** What cask.sh says for these arguments. */
function cask(...args: string[]) {
  const run = spawnSync('sh', [script, ...args], { encoding: 'utf8' });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe('cask.sh', () => {
  test.each([
    ['a release', '0.1.0'],
    ['a release candidate', '0.1.0-rc.1'],
  ])('renders the cask for %s, %s', async (_, version) => {
    const run = cask(version, ARM64, X64);
    expect(run).toMatchObject({ status: 0, stderr: '' });
    await expect(run.stdout).toMatchFileSnapshot(join(here, 'golden', `lo-${version}.rb`));
  });

  test.each([
    ['a v', 'v0.1.0'],
    ['two numbers', '0.1'],
    ['a leading zero', '01.1.0'],
    ['build metadata', '0.1.0+build.1'],
    ['an underscore', '0.1.0-rc_1'],
    ['a slash, which would change the path it names', '0.1.0-rc/1'],
    ['a line break', '0.1.0\n9.9.9'],
    ['nothing', ''],
  ])('refuses a version with %s', (_, version) => {
    const run = cask(version, ARM64, X64);
    expect(run).toMatchObject({ status: 1, stdout: '' });
    expect(run.stderr).toContain("isn't a SemVer version");
  });

  test.each([
    ['capitals', ARM64.toUpperCase()],
    ['63 digits', ARM64.slice(1)],
    ['65 digits', `${ARM64}0`],
    ['a letter past f', `g${ARM64.slice(1)}`],
    ['a line break', `${ARM64}\n${X64}`],
    ['a sed replacement', `${ARM64.slice(2)}\\&`],
  ])('refuses a SHA-256 with %s, for either DMG', (_, sha256) => {
    const arm64 = cask('0.1.0', sha256, X64);
    expect(arm64).toMatchObject({ status: 1, stdout: '' });
    expect(arm64.stderr).toContain("The arm64 DMG's SHA-256 isn't 64 lowercase hex digits.");
    const x64 = cask('0.1.0', ARM64, sha256);
    expect(x64).toMatchObject({ status: 1, stdout: '' });
    expect(x64.stderr).toContain("The x64 DMG's SHA-256 isn't 64 lowercase hex digits.");
  });

  test('takes exactly three arguments', () => {
    expect(cask('0.1.0', ARM64)).toMatchObject({ status: 2, stdout: '' });
    expect(cask('0.1.0', ARM64, X64, X64)).toMatchObject({ status: 2, stdout: '' });
  });
});

describe('lo.rb.in', () => {
  const template = readFileSync(join(here, 'lo.rb.in'), 'utf8');
  const base = parse(readFileSync(join(root, 'apps/desktop/build/electron-builder.yml'), 'utf8'));
  const release = parse(readFileSync(join(root, 'apps/desktop/build/release.yml'), 'utf8'));

  test('names the app and its bundle ID as electron-builder does', () => {
    expect(template).toContain(`  name "${base.productName}"\n`);
    expect(template).toContain(`  app "${base.productName}.app"\n`);
    expect(template).toContain(`  uninstall quit: "${base.appId}"\n`);
    expect(template).toContain(`"~/Library/Preferences/${base.appId}.plist"`);
    expect(template).toContain(`"~/Library/Saved Application State/${base.appId}.savedState"`);
    expect(template).toContain(`"~/Library/Application Support/${base.productName}"`);
    expect(template).toContain(`"/private/var/folders/*/*/C/${base.productName}"`);
  });

  test("names the folder electron-updater downloads to, after the release's package name", () => {
    expect(template).toContain(`"~/Library/Caches/${release.extraMetadata.name}-updater"`);
  });

  test("asks for the release's minimum macOS", () => {
    // Homebrew's names for the versions Electron may need.
    const names: Record<string, string> = {
      '12.0': 'monterey',
      '13.0': 'ventura',
      '14.0': 'sonoma',
      '15.0': 'sequoia',
      '26.0': 'tahoe',
    };
    const name = names[release.mac.minimumSystemVersion];
    expect(name).toBeDefined();
    expect(template).toContain(`  depends_on macos: :${name}\n`);
  });

  test("doesn't say Lo updates itself, so `brew upgrade` updates it", () => {
    expect(template).not.toContain('auto_updates');
  });
});
