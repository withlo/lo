// The system's About panel: Lo's name, version, build, copyright and license. Section 0 of GPL-3.0
// asks a program with an interface to show its appropriate legal notices: its copyright, that it
// has no warranty, that you may redistribute it under the license, and how to view the license.
// This panel is where Lo does, and its "Open licenses" command is how you view it, from the
// right-click menu of the window on both systems, and Settings › About. Nothing here calls
// Electron, so it runs under unit tests.

import type { AboutPanelOptionsOptions } from 'electron';

/** Lo's copyright, as the builder's `copyright` says it for the app's Info.plist. */
export const COPYRIGHT = 'Copyright © 2026 Mike Scornavacca';

/**
 * What Lo's license lets you do and what it doesn't promise, and where the source is: that Lo is
 * free software you can redistribute and modify under the GNU General Public License, version 3,
 * and that it has no warranty. `licenses.txt` opens with it too.
 */
export const FREE_SOFTWARE =
  'Lo is free software. You can redistribute it and modify it under the terms of the GNU General Public License, version 3. Lo comes with no warranty. Its source is at github.com/withlo/lo.';

/**
 * How to read the license, by the command that opens it, as it's found on both systems: in the
 * right-click menu of the window.
 */
export const HOW_TO_READ = 'To read the license, right-click and choose Open licenses.';

/** What the panel says of Lo's license: {@link FREE_SOFTWARE}, then how to read the license. */
export const NOTICE = `${FREE_SOFTWARE} ${HOW_TO_READ}`;

/** Where Lo's source is, for the panel's link on Linux. */
const WEBSITE = 'https://github.com/withlo/lo';

/** How many digits of a commit's hash the panel shows. */
const SHORT_HASH = 7;

/** The first digits of a commit's hash, which is how a build is named. Absent for no commit. */
export function shortHash(commit: string): string | undefined {
  return commit === '' ? undefined : commit.slice(0, SHORT_HASH);
}

/**
 * What names the build in the panel: the first digits of the commit a packaged Lo was built from,
 * and `from source` for one run from source, which has no release to name. Absent for a packaged
 * Lo that was built where no commit could be found.
 */
export function buildOf(options: { packaged: boolean; commit: string }): string | undefined {
  return options.packaged ? shortHash(options.commit) : 'from source';
}

export interface About {
  readonly platform: NodeJS.Platform;
  /** The app's name, `Lo`, or `Lo Dev` for a build run from source. */
  readonly name: string;
  readonly version: string;
  /** What {@link buildOf} says. */
  readonly build: string | undefined;
  /** The path of the app's icon as a PNG, which only Linux's panel shows. */
  readonly icon: string | undefined;
}

/**
 * What the panel says on `platform`. macOS shows the version with the build in parentheses and has
 * a place for credits, so the license goes there; Linux shows one version and no credits, so the
 * build goes in the version and the license follows the copyright.
 */
export function aboutOptions(about: About): AboutPanelOptionsOptions {
  if (about.platform === 'darwin') {
    return {
      applicationName: about.name,
      applicationVersion: about.version,
      ...(about.build === undefined ? {} : { version: about.build }),
      copyright: COPYRIGHT,
      credits: NOTICE,
    };
  }
  return {
    applicationName: about.name,
    applicationVersion:
      about.build === undefined ? about.version : `${about.version} (${about.build})`,
    copyright: `${COPYRIGHT}\n${NOTICE}`,
    website: WEBSITE,
    ...(about.icon === undefined ? {} : { iconPath: about.icon }),
  };
}
