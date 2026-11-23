// Updates: whether a newer Lo is out on GitHub Releases, and, on a Mac that can replace its own
// app, installing it when the reader says so. Main checks the releases of withlo/lo, 30 s after the
// window is up and every 6 hours while `updates.check` is on, and whenever the window asks; it
// sends where things stand on `state`. Nothing downloads until the window asks to `install`, and
// Lo restarts only when it asks to `restart`: a downloaded update otherwise installs as Lo quits.
//
// How this copy of Lo takes a newer version is decided as Lo starts, and again for each offer and
// before Lo moves itself or downloads one, since the reader may move Lo while it runs. It's sent
// with the offer (`how`): Lo installs it itself, it must first be moved to Applications, Homebrew
// updates it, or the reader downloads it from the release's page. Lo never shows the release notes,
// only their first line, as plain text; the release's page is built by Lo from its version.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** The longest version Lo takes, in characters. Lo's own are far shorter. */
const VERSION_LIMIT = 64;

/**
 * A version as Lo is released: SemVer 2.0.0, with a prerelease part or none, and no build metadata,
 * since a release's tag is `v` and its version.
 */
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?$/;

/** Whether `text` is a version Lo is released as: `0.2.0` or `0.2.0-rc.1`, say. */
export function isVersion(text: string): boolean {
  return text.length <= VERSION_LIMIT && SEMVER.test(text);
}

/** A version of Lo, as {@link isVersion} checks one. */
export const version = z.string().refine(isVersion, 'isn’t a version Lo is released as');

/** Where Lo's releases are. */
export const RELEASES = 'https://github.com/withlo/lo/releases';

/**
 * The page of the release of `version`, on GitHub: built from the version alone, which must be
 * one Lo is released as, never taken from what the releases' feed says.
 */
export function releasePage(release: string): string {
  if (!isVersion(release)) {
    throw new Error(`${JSON.stringify(release)} isn’t a version Lo is released as.`);
  }
  return `${RELEASES}/tag/v${release}`;
}

/** The command that updates Lo when Homebrew installed it, by the tap's full name. */
export const BREW_UPGRADE = 'brew upgrade --cask withlo/tap/lo';

/**
 * How this copy of Lo takes a newer version, from where it runs:
 * - `install`: Lo downloads and installs it, on a Mac, from an Applications folder it can write;
 * - `move`: on a Mac, Lo can't replace itself where it is, as on the disk image, until it's moved
 *   to Applications (`move`);
 * - `brew`: Homebrew installed it, so Homebrew updates it ({@link BREW_UPGRADE});
 * - `page`: the reader downloads it from the release's page, as on Linux, or where Lo can't write.
 */
export const how = z.enum(['install', 'move', 'brew', 'page']);
export type How = z.output<typeof how>;

/** The most characters of the release notes' first line Lo shows, as a person counts them. */
export const LINE_LIMIT = 140;

/** How many characters `text` has as a person counts them: emoji and accents as one. */
export function characters(text: string): number {
  return [...new Intl.Segmenter().segment(text)].length;
}

/** A count of bytes. */
const bytes = z.number().int().nonnegative();

/**
 * Why a check or a download failed, as a kind the window words: no connection (`offline`), GitHub
 * didn't answer in time (`timeout`) or answered with an error (`github`), the newest release has no
 * download for this computer (`noDownload`), the download was damaged (`damaged`) or stopped
 * (`stopped`), the update isn't signed as this Lo is (`unsigned`), Lo is quitting (`quitting`),
 * this copy of Lo doesn't check, being built from source (`source`) or packaged but no release
 * (`unreleased`), or something else (`unknown`).
 */
export const failure = z.enum([
  'offline',
  'timeout',
  'github',
  'noDownload',
  'damaged',
  'stopped',
  'unsigned',
  'quitting',
  'source',
  'unreleased',
  'unknown',
]);
export type Failure = z.output<typeof failure>;

/** What went wrong, as it came, such as GitHub's status or the network's error: for Details. */
const details = z.string().min(1).max(400);

/** A failure and what came with it. */
const failed = z.strictObject({ why: failure, details: details.optional() });
export type Failed = z.output<typeof failed>;

/**
 * A newer Lo, on offer: its `version`; the first `line` of its release notes, as plain text, cut to
 * {@link LINE_LIMIT} characters, or nothing when they're empty; `how` this copy takes it; its
 * release's `page`, which "What's new" and "Download" open; and, when the last download of it
 * failed, why (`failed`), until `install` tries again.
 */
const available = z
  .strictObject({
    status: z.literal('available'),
    version,
    line: z.string().refine((line) => characters(line) <= LINE_LIMIT, 'is too long'),
    how,
    page: z.string(),
    failed: failed.optional(),
  })
  .refine((offer) => isVersion(offer.version) && offer.page === releasePage(offer.version), {
    message: 'isn’t the page of the release of its version',
    path: ['page'],
  });

/**
 * The update downloading: its `version`, and how many bytes have come of the `total`, which is 0
 * until GitHub says.
 */
const downloading = z.strictObject({
  status: z.literal('downloading'),
  version,
  received: bytes,
  total: bytes,
});

/** The update downloaded and checked: it installs as Lo quits, or now, with `restart`. */
const ready = z.strictObject({ status: z.literal('ready'), version });

/**
 * Where updates stand: `idle`, with nothing to offer (none is newer, the reader hid it with
 * `later`, or this copy of Lo doesn't check); `available`; `downloading`; or `ready`.
 */
export const updateState = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('idle') }),
  available,
  downloading,
  ready,
]);
export type UpdateState = z.output<typeof updateState>;

/**
 * What a check the window asked for found: `newest`, when this Lo, at `version`, is the newest;
 * `failed`, with why, when Lo couldn't check, or this copy of Lo doesn't; or else where updates
 * now stand, as `state` also says. A check asked for offers an update the reader hid with `later`
 * again.
 */
export const checkAnswer = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('newest'), version }),
  z.strictObject({ status: z.literal('failed'), why: failure, details: details.optional() }),
  available,
  downloading,
  ready,
]);
export type CheckAnswer = z.output<typeof checkAnswer>;

export const contract = defineContract('updates', {
  requests: {
    /** Where updates stand now. The `state` topic then keeps the window up to date. */
    read: { input: z.undefined(), reply: reply<UpdateState>() },
    /**
     * How this copy of Lo takes a newer version now, decided again, which an offer says too: for
     * what depends on it with no offer, such as whether Lo can be moved to Applications.
     */
    how: { input: z.undefined(), reply: reply<How>() },
    /**
     * Checks GitHub Releases for a newer Lo now, whether or not `updates.check` is on, and answers
     * what it found. A check already going is shared, one GitHub doesn't answer within a minute
     * fails, and none is made while an update downloads or waits to install.
     */
    check: { input: z.undefined(), reply: reply<CheckAnswer>() },
    /**
     * Downloads the update on offer, and installs it as Lo quits: only when its `how` is
     * `install`, and otherwise refused (`unavailable`). It answers once the download has started;
     * `state` says how it goes. One that fails goes back to `available`, with why, and this tries
     * it again.
     */
    install: { input: z.undefined(), reply: reply<void>() },
    /**
     * Quits Lo, as any quit does, then installs the update that's `ready` and starts Lo again.
     * Refused (`unavailable`) with none ready.
     */
    restart: { input: z.undefined(), reply: reply<void>() },
    /**
     * Hides the update on offer until Lo starts again: `state` goes back to `idle`, and checks Lo
     * makes by itself don't offer that version again. A newer one, or a check asked for, does.
     * Refused (`unavailable`) with none on offer.
     */
    later: { input: z.undefined(), reply: reply<void>() },
    /**
     * Moves Lo to the Applications folder, so it can update itself from there, and starts it
     * again from there: only when its `how` is `move`, and otherwise refused (`unavailable`). With
     * a Lo already there, Lo asks before it replaces it; told not to, it moves nothing. Fails
     * (`failed`) with why when the move does.
     */
    move: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {
    /** Where updates stand, each time it changes. */
    state: updateState,
  },
});
