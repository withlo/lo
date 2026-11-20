import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { aboutOptions, buildOf, COPYRIGHT, FREE_SOFTWARE } from './about.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe('buildOf', () => {
  it('is the first seven digits of the commit a packaged Lo was built from', () => {
    expect(buildOf({ packaged: true, commit: COMMIT })).toBe('0123456');
  });

  it('is "from source" for a build run from source, whatever commit it was built at', () => {
    expect(buildOf({ packaged: false, commit: COMMIT })).toBe('from source');
    expect(buildOf({ packaged: false, commit: '' })).toBe('from source');
  });

  it('is nothing for a packaged Lo built where no commit could be found', () => {
    expect(buildOf({ packaged: true, commit: '' })).toBeUndefined();
  });
});

describe('aboutOptions', () => {
  const about = { name: 'Lo', version: '0.1.0', build: '0123456', icon: undefined };

  it('on macOS gives the version with the build beside it, and the license as credits', () => {
    expect(aboutOptions({ ...about, platform: 'darwin' })).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0',
      version: '0123456',
      copyright: COPYRIGHT,
      credits: FREE_SOFTWARE,
    });
    expect(
      aboutOptions({ ...about, platform: 'darwin', name: 'Lo Dev', build: 'from source' }),
    ).toMatchObject({
      applicationName: 'Lo Dev',
      version: 'from source',
    });
  });

  it('on macOS shows only the version when there is no build to name', () => {
    expect(aboutOptions({ ...about, platform: 'darwin', build: undefined })).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0',
      copyright: COPYRIGHT,
      credits: FREE_SOFTWARE,
    });
  });

  it('on Linux, which has no credits, puts the build in the version and the license after the copyright', () => {
    expect(
      aboutOptions({ ...about, platform: 'linux', icon: '/opt/Lo/resources/icon.png' }),
    ).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0 (0123456)',
      copyright: `${COPYRIGHT}\n${FREE_SOFTWARE}`,
      website: 'https://github.com/withlo/lo',
      iconPath: '/opt/Lo/resources/icon.png',
    });
    expect(aboutOptions({ ...about, platform: 'linux', build: undefined })).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0',
      copyright: `${COPYRIGHT}\n${FREE_SOFTWARE}`,
      website: 'https://github.com/withlo/lo',
    });
  });
});

describe("Lo's license", () => {
  const app = join(import.meta.dirname, '..', '..', '..', '..');

  it('says what the notices GPL-3.0 asks for: the license, no warranty, and where the source is', () => {
    expect(FREE_SOFTWARE).toMatch(/GNU General Public License v3\.0/);
    expect(FREE_SOFTWARE).toMatch(/no warranty/);
    expect(FREE_SOFTWARE).toMatch(/github\.com\/withlo\/lo/);
  });

  it('is the license in package.json, and the copyright is the one the builder gives Info.plist', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ license: 'GPL-3.0-only' });
    const builder = readFileSync(join(app, 'build', 'electron-builder.yml'), 'utf8');
    expect(/^copyright: (.+)$/m.exec(builder)?.[1]).toBe(COPYRIGHT);
  });
});
