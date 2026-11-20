import { describe, expect, it } from 'vitest';

import { bundleOf, howItUpdates, type Place } from './how.ts';

const HOME = '/Users/sam';

/** A packaged Lo on a Mac, run from `app`, on a disk where `existing` exists and `readOnly` can't be written. */
function mac(
  app: string,
  options: { existing?: readonly string[]; readOnly?: readonly string[] } = {},
): Place {
  return {
    platform: 'darwin',
    packaged: true,
    executable: `${app}/Contents/MacOS/Lo`,
    home: HOME,
    exists: (path) => (options.existing ?? []).includes(path),
    writable: (path) => !(options.readOnly ?? []).includes(path),
  };
}

describe('on a Mac', () => {
  it('installs updates itself from an Applications folder it can write', () => {
    expect(howItUpdates(mac('/Applications/Lo.app'))).toBe('install');
    expect(howItUpdates(mac(`${HOME}/Applications/Lo.app`))).toBe('install');
    expect(howItUpdates(mac('/Applications/Review/Lo.app'))).toBe('install');
  });

  it('must be moved to Applications first when run from the disk image', () => {
    expect(howItUpdates(mac('/Volumes/Lo 0.1.0-arm64/Lo.app'))).toBe('move');
  });

  it('must be moved first when macOS translocated it, as it does a download run where it is', () => {
    expect(
      howItUpdates(mac('/private/var/folders/7x/k2_3/T/AppTranslocation/4C1F-9A2B/d/Lo.app')),
    ).toBe('move');
  });

  it('must be moved first from any other folder', () => {
    expect(howItUpdates(mac(`${HOME}/Downloads/Lo.app`))).toBe('move');
    expect(howItUpdates(mac('/Applications.old/Lo.app'))).toBe('move');
    expect(howItUpdates(mac(`${HOME}/Desktop/Applications/Lo.app`))).toBe('move');
  });

  it('sends the reader to the release page from an Applications folder it can’t write', () => {
    expect(howItUpdates(mac('/Applications/Lo.app', { readOnly: ['/Applications'] }))).toBe('page');
    expect(howItUpdates(mac('/Applications/Lo.app', { readOnly: ['/Applications/Lo.app'] }))).toBe(
      'page',
    );
  });

  it('leaves a Homebrew install to Homebrew, on Apple silicon and on Intel', () => {
    for (const caskroom of ['/opt/homebrew/Caskroom/lo', '/usr/local/Caskroom/lo']) {
      expect(howItUpdates(mac('/Applications/Lo.app', { existing: [caskroom] }))).toBe('brew');
      expect(howItUpdates(mac(`${HOME}/Applications/Lo.app`, { existing: [caskroom] }))).toBe(
        'brew',
      );
    }
  });

  it('isn’t Homebrew’s from outside Applications, even where Homebrew has a Lo', () => {
    const existing = ['/opt/homebrew/Caskroom/lo'];
    expect(howItUpdates(mac('/Volumes/Lo/Lo.app', { existing }))).toBe('move');
  });

  it('never updates a build run from source, which runs on Electron’s own app', () => {
    const fromSource = {
      ...mac('/Users/sam/lo/node_modules/electron/dist/Electron.app'),
      packaged: false,
    };
    expect(howItUpdates(fromSource)).toBe('page');
  });

  it('sends the reader to the page when it can’t tell which app it runs from', () => {
    expect(howItUpdates({ ...mac('/Applications/Lo.app'), executable: '/usr/local/bin/lo' })).toBe(
      'page',
    );
  });
});

it('sends the reader to the release page on Linux, whatever the package', () => {
  for (const executable of ['/opt/Lo/lo', '/usr/lib/lo/lo']) {
    const place = { ...mac('/Applications/Lo.app'), platform: 'linux' as const, executable };
    expect(howItUpdates(place)).toBe('page');
  }
});

it('finds the app a program runs from', () => {
  expect(bundleOf('/Applications/Lo.app/Contents/MacOS/Lo')).toBe('/Applications/Lo.app');
  expect(bundleOf('/Applications/Lo.app/Contents/MacOS/../MacOS/Lo')).toBe('/Applications/Lo.app');
  expect(bundleOf('/Applications/Lo.app/Contents/Frameworks/Lo Helper')).toBeUndefined();
  expect(bundleOf('Lo.app/Contents/MacOS/Lo')).toBeUndefined();
});
