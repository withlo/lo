// The system's About panel: Lo's name, version, build, copyright and license. GPL-3.0 asks a
// program with an interface to show its copyright, say it has no warranty and say where its
// license is, and this panel is where Lo does (its "Show licenses" command opens the license
// files). Nothing here calls Electron, so it runs under unit tests.

import type { AboutPanelOptionsOptions } from 'electron';

/** Lo's copyright, as the builder's `copyright` says it for the app's Info.plist. */
export const COPYRIGHT = 'Copyright © 2026 Mike Scornavacca';

/** Lo's license, in a sentence. */
export const FREE_SOFTWARE =
  'Lo is free software under the GNU General Public License v3.0, with no warranty. Its source is at github.com/withlo/lo.';

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
      credits: FREE_SOFTWARE,
    };
  }
  return {
    applicationName: about.name,
    applicationVersion:
      about.build === undefined ? about.version : `${about.version} (${about.build})`,
    copyright: `${COPYRIGHT}\n${FREE_SOFTWARE}`,
    website: WEBSITE,
    ...(about.icon === undefined ? {} : { iconPath: about.icon }),
  };
}
