// The system's About panel: Lo's name, version, build, copyright and license. Section 0 of GPL-3.0
// asks a program with an interface to show its appropriate legal notices: its copyright, that it
// has no warranty, that you may redistribute it under the license, and how to view the license.
// This panel is where Lo does, and its "Show licenses" command is how you view it, from the app
// menu on macOS and the right-click menu on Linux. Nothing here calls Electron, so it runs under
// unit tests.

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
 * How to read the license, as the command that opens it is found on `platform`: `name`'s menu in
 * the menu bar on macOS, the right-click menu on Linux, which has no menu bar.
 */
export function howToRead(platform: NodeJS.Platform, name: string): string {
  return platform === 'darwin'
    ? `To read the license, choose Show licenses in the ${name} menu.`
    : 'To read the license, right-click and choose Show licenses.';
}

/** What the panel says of Lo's license: {@link FREE_SOFTWARE}, then how to read the license. */
export function notice(platform: NodeJS.Platform, name: string): string {
  return `${FREE_SOFTWARE} ${howToRead(platform, name)}`;
}

/** Where Lo's source is, for the panel's link on Linux. */
const WEBSITE = 'https://github.com/withlo/lo';

/** How many digits of a commit's hash the panel shows. */
const SHORT_HASH = 7;

/**
 * What names the build in the panel: the first digits of the commit a packaged Lo was built from,
 * and `from source` for one run from source, which has no release to name. Absent for a packaged
 * Lo that was built where no commit could be found.
 */
export function buildOf(options: { packaged: boolean; commit: string }): string | undefined {
  if (!options.packaged) return 'from source';
  return options.commit === '' ? undefined : options.commit.slice(0, SHORT_HASH);
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
      credits: notice(about.platform, about.name),
    };
  }
  return {
    applicationName: about.name,
    applicationVersion:
      about.build === undefined ? about.version : `${about.version} (${about.build})`,
    copyright: `${COPYRIGHT}\n${notice(about.platform, about.name)}`,
    website: WEBSITE,
    ...(about.icon === undefined ? {} : { iconPath: about.icon }),
  };
}
