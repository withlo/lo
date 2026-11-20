// How this copy of Lo takes a newer version, decided once as Lo starts from where it runs. Only a
// packaged Lo on a Mac installs one itself, and only from an Applications folder it can write:
// Squirrel.Mac, which electron-updater hands the download to, replaces the app where it is. Run
// from the disk image, from where macOS translocated a download, or from any other folder, Lo
// must be moved to Applications first. Homebrew's installs update through Homebrew, since Lo
// replacing one would leave Homebrew's record of it wrong. Everywhere else, the reader downloads it
// from the release's page. Nothing here calls Electron, so it runs under unit tests.

import { dirname, join, posix } from 'node:path';

import type { How } from '../contract.ts';

/** Where Homebrew keeps what it knows of the `lo` cask: on Apple silicon, and on Intel. */
export const CASKROOMS = ['/opt/homebrew/Caskroom/lo', '/usr/local/Caskroom/lo'] as const;

/** Where this copy of Lo runs, and what it can see of the disk. */
export interface Place {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  /** The program running: `<app>/Contents/MacOS/<name>` in a packaged Lo on a Mac. */
  readonly executable: string;
  readonly home: string;
  exists(path: string): boolean;
  /** Whether Lo may write `path`: replace a file in a folder, or the app itself. */
  writable(path: string): boolean;
}

/** The app bundle `executable` runs from, `/Applications/Lo.app`, or nothing outside one. */
export function bundleOf(executable: string): string | undefined {
  const match = /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(posix.normalize(executable));
  return match?.[1];
}

/** Whether `bundle` is in the system's Applications folder or the reader's own, at any depth. */
export function inApplications(bundle: string, home: string): boolean {
  return ['/Applications', join(home, 'Applications')].some((folder) =>
    bundle.startsWith(`${folder}/`),
  );
}

/** How this copy of Lo takes a newer version: see `how` in the contract. */
export function howItUpdates(place: Place): How {
  if (place.platform !== 'darwin' || !place.packaged) return 'page';
  const bundle = bundleOf(place.executable);
  if (bundle === undefined) return 'page';
  const applications = inApplications(bundle, place.home);
  // Checked first: Homebrew puts the app in an Applications folder Lo can write.
  if (applications && CASKROOMS.some((caskroom) => place.exists(caskroom))) return 'brew';
  // The disk image, a translocated download and any other folder.
  if (!applications) return 'move';
  return place.writable(bundle) && place.writable(dirname(bundle)) ? 'install' : 'page';
}
