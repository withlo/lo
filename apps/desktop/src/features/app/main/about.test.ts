import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { commandsOf } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import keys from '../keys.ts';
import {
  aboutOptions,
  buildOf,
  COPYRIGHT,
  FREE_SOFTWARE,
  howToRead,
  notice,
  shortHash,
} from './about.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

describe('shortHash', () => {
  it('is the first seven digits of a commit, and nothing for none', () => {
    expect(shortHash(COMMIT)).toBe('0123456');
    expect(shortHash('')).toBeUndefined();
  });
});

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
      credits: notice('darwin', 'Lo'),
    });
    expect(
      aboutOptions({ ...about, platform: 'darwin', name: 'Lo Dev', build: 'from source' }),
    ).toMatchObject({
      applicationName: 'Lo Dev',
      version: 'from source',
      credits: expect.stringContaining('in the Lo Dev menu'),
    });
  });

  it('on macOS shows only the version when there is no build to name', () => {
    expect(aboutOptions({ ...about, platform: 'darwin', build: undefined })).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0',
      copyright: COPYRIGHT,
      credits: notice('darwin', 'Lo'),
    });
  });

  it('on Linux, which has no credits, puts the build in the version and the license after the copyright', () => {
    expect(
      aboutOptions({ ...about, platform: 'linux', icon: '/opt/Lo/resources/icon.png' }),
    ).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0 (0123456)',
      copyright: `${COPYRIGHT}\n${notice('linux', 'Lo')}`,
      website: 'https://github.com/withlo/lo',
      iconPath: '/opt/Lo/resources/icon.png',
    });
    expect(aboutOptions({ ...about, platform: 'linux', build: undefined })).toEqual({
      applicationName: 'Lo',
      applicationVersion: '0.1.0',
      copyright: `${COPYRIGHT}\n${notice('linux', 'Lo')}`,
      website: 'https://github.com/withlo/lo',
    });
  });
});

const commands = commandsOf(keys);

/** The command with this id. */
const find = (id: string) => commands.find((command) => command.id === id);

describe("Lo's license", () => {
  const app = join(import.meta.dirname, '..', '..', '..', '..');

  describe('the notice, which GPL-3.0 section 0 asks the panel for', () => {
    it('says Lo is free software that you can redistribute and modify under version 3 of the GNU General Public License', () => {
      expect(FREE_SOFTWARE).toContain('Lo is free software.');
      expect(FREE_SOFTWARE).toMatch(
        /You can redistribute it and modify it under the terms of the GNU General Public License, version 3\./,
      );
    });

    it('says Lo comes with no warranty', () => {
      expect(FREE_SOFTWARE).toContain('Lo comes with no warranty.');
    });

    it('says where the source is', () => {
      expect(FREE_SOFTWARE).toContain('Its source is at github.com/withlo/lo.');
    });

    it('does not use "we" or an exclamation, as the interface does not', () => {
      expect(notice('darwin', 'Lo')).not.toMatch(/\bwe\b|!/i);
      expect(notice('linux', 'Lo')).not.toMatch(/\bwe\b|!/i);
    });

    it("says how to read the license by the command's own label, in the menu it is in on macOS", () => {
      const licenses = find('app.licenses');
      expect(licenses?.bar?.menu).toBe('App');
      expect(howToRead('darwin', 'Lo')).toBe(
        `To read the license, choose ${licenses?.label} in the Lo menu.`,
      );
      // The app menu is named for the app, as the system names it.
      expect(howToRead('darwin', 'Lo Dev')).toContain('in the Lo Dev menu');
    });

    it("says how to read the license by the command's own label, in the right-click menu on Linux, which has no menu bar", () => {
      const licenses = find('app.licenses');
      // The right-click menu of the window itself: on no target in particular.
      expect(licenses?.menu).toMatchObject({ on: 'none' });
      expect(howToRead('linux', 'Lo')).toBe(
        `To read the license, right-click and choose ${licenses?.label}.`,
      );
    });

    it('is in the panel whole on each system, once the copyright is', () => {
      const mac = aboutOptions({
        platform: 'darwin',
        name: 'Lo',
        version: '1',
        build: undefined,
        icon: undefined,
      });
      expect(mac.copyright).toBe(COPYRIGHT);
      expect(mac.credits).toBe(`${FREE_SOFTWARE} ${howToRead('darwin', 'Lo')}`);
      const linux = aboutOptions({
        platform: 'linux',
        name: 'Lo',
        version: '1',
        build: undefined,
        icon: undefined,
      });
      expect(linux.copyright).toBe(`${COPYRIGHT}\n${FREE_SOFTWARE} ${howToRead('linux', 'Lo')}`);
    });
  });

  it('is the license in package.json, and the copyright is the one the builder gives Info.plist', () => {
    const manifest: unknown = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ license: 'GPL-3.0-only' });
    const builder = readFileSync(join(app, 'build', 'electron-builder.yml'), 'utf8');
    expect(/^copyright: (.+)$/m.exec(builder)?.[1]).toBe(COPYRIGHT);
  });
});
