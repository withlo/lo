// What the updates feature says that depends on numbers or on main's kinds: how far a download has
// come, what names a build, and why a check or a download failed, as an error's parts.

import { bytes } from '@lo/ui';

import { explain } from '../../../window/explain.ts';
import type { Failure } from '../contract.ts';

/** What names a build beside its version: built from source, or the commit a packaged Lo was. */
export type Build =
  { readonly kind: 'source' } | { readonly kind: 'commit'; readonly commit: string };

/**
 * What names a build beside its version, as Settings says it: built from source, for a build run
 * from source, which has no release to name, else the commit a packaged Lo was built from. Nothing
 * for a packaged Lo built where no commit could be found.
 */
export function buildOf(info: {
  packaged: boolean;
  commit?: string | undefined;
}): Build | undefined {
  if (!info.packaged) return { kind: 'source' };
  return info.commit === undefined ? undefined : { kind: 'commit', commit: info.commit };
}

/** A build in words, as search finds it: `Built from source`, `Commit 0123456`. */
export function buildText(build: Build): string {
  return build.kind === 'source' ? 'Built from source' : `Commit ${build.commit}`;
}

/**
 * How much of a download has come, as a part of a whole: `38 / 112 MB`, with the unit said once
 * when both sizes share it, and `38 MB` while GitHub hasn't said how large it is, which a total of
 * 0 means. Nothing before anything has come: the label's `…` says it's starting.
 */
export function progressText(received: number, total: number): string | undefined {
  if (received <= 0) return undefined;
  const done = bytes(received);
  if (total <= 0) return done;
  const whole = bytes(total);
  const [number, unit] = done.split(' ');
  return unit === whole.split(' ')[1] ? `${number} / ${whole}` : `${done} / ${whole}`;
}

/** A download's label: `Downloading Lo 0.2.0…`, then with how far it has come in the `…`'s place. */
export function downloadingText(version: string, received: number, total: number): string {
  const far = progressText(received, total);
  return far === undefined ? `Downloading Lo ${version}…` : `Downloading Lo ${version} · ${far}`;
}

/**
 * Why a check or a download failed, as an error's reason: the guide's cause for GitHub's part,
 * else the update's own, and nothing where it isn't known.
 */
export function failureReason(why: Failure): string | undefined {
  switch (why) {
    case 'offline':
    case 'timeout':
    case 'github':
      return explain({ kind: why });
    case 'noDownload':
      return 'The update has no download for this computer.';
    case 'damaged':
      return 'The download was damaged.';
    case 'stopped':
      return 'The download stopped.';
    case 'unsigned':
      return 'The update’s signature doesn’t match.';
    case 'source':
      return 'This copy of Lo is built from source.';
    case 'unreleased':
      return 'This copy of Lo isn’t a release.';
    case 'quitting':
    case 'unknown':
      return undefined;
    default:
      throw new Error(`A failure Lo doesn’t know: ${JSON.stringify(why satisfies never)}`);
  }
}

/**
 * What a failure leaves the reader to do: try again, open Lo's page on GitHub, where a copy that
 * doesn't check can get a newer one, or nothing, where neither would help.
 */
export function failureWay(why: Failure): 'again' | 'github' | undefined {
  switch (why) {
    case 'source':
    case 'unreleased':
      return 'github';
    case 'noDownload':
    case 'unsigned':
    case 'quitting':
      return undefined;
    case 'offline':
    case 'timeout':
    case 'github':
    case 'damaged':
    case 'stopped':
    case 'unknown':
      return 'again';
    default:
      throw new Error(`A failure Lo doesn’t know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** Whether a check is blocked, not failed: this copy doesn't check, as a build from source. */
export function checkBlocked(why: Failure): boolean {
  return why === 'source' || why === 'unreleased';
}

/** A failed check's title: blocked, for a copy that doesn't check, or else failed. */
export function checkFailedTitle(why: Failure): string {
  return checkBlocked(why) ? 'Can’t check for updates' : 'Couldn’t check for updates';
}
