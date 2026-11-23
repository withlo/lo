// Where each view of a pull request's tab stands with trust, as main last said: kept with the
// view, and gone when its tab closes. What the Language servers item offers, and what the palette's
// trust commands may do, follow from it, as plain functions tested alone. The window only asks:
// main asks the reader in its own dialog before it trusts anything. While it does, the view's
// status says how far it has got, which the trust buttons show, and the window keeps why the last
// ask didn't trust a view, for the item's details to say in place. The offer is the item's, and
// opens by itself once for a repo: at the first `g d` in it.

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { explain } from '../../../window/explain.ts';
import type { SettingsState } from '../../settings/contract.ts';
import { activeTab, tabState } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import { readTrusted, trusted } from '../settings.ts';
import { main } from './main.ts';
import { offered, servers } from './servers.ts';

/** Where each view stands, once main has said. */
export const statuses = tabState<Status | null>(() => null);

/** Why asking to trust a view didn't trust it, as main said. */
export interface TrustFailure {
  /** Whether it was its pull request alone that was asked about. */
  readonly pull: boolean;
  /** Why, in a sentence, or nothing when the cause isn't known. */
  readonly message: string;
  /** A name in `message` that's code, such as `settings.json`, which shows as code where it can. */
  readonly code?: string | undefined;
  /**
   * Whether it's a refusal of main's own, whose reason has no full stop where it's said as one, in
   * the banner or a note; an error's body line adds it.
   */
  readonly refusal?: boolean | undefined;
  /** What GitHub, the settings file or the system said, as it came, for Details. */
  readonly details?: string | undefined;
  /** Whether what the settings file holds kept Lo from saving it, which editing the file fixes. */
  readonly file: boolean;
}

/**
 * Why the last ask to trust each view didn't, until it's asked again, or the view is trusted, or,
 * for what the settings file held, the settings change, as once the file's fixed.
 */
export const failures = tabState<TrustFailure | null>(() => null);

/** The views whose last ask failed for what the settings file held. */
const fileFailed = new Set<string>();

/** Keeps why asking to trust `view` failed, or with nothing, that it's past. */
function setFailure(view: string, failure: TrustFailure | null): void {
  if (failure?.file) fileFailed.add(view);
  else fileFailed.delete(view);
  if (failures.get(view) !== failure) failures.set(view, failure);
}

/**
 * Hears that the settings changed: what the file held that kept Lo from trusting a view may be
 * fixed, so what it said of that goes, and the item offers to trust it again. Not while `state`
 * still has a problem that keeps Lo from saving what's trusted: main says what it read as it
 * refuses, and that can reach the window after the refusal does.
 */
export function settingsChanged(state: SettingsState): void {
  if (blocksTrust(state)) return;
  for (const view of fileFailed) {
    if (failures.get(view)?.file) failures.set(view, null);
  }
  fileFailed.clear();
}

/**
 * Whether what `state` says is wrong in the settings file keeps Lo from saving what's trusted: the
 * whole file can't be read, or `code.trusted` is in it twice or isn't a list. Entries of it that Lo
 * ignores don't.
 */
function blocksTrust(state: SettingsState): boolean {
  const list = state.values[trusted.key];
  const ignored = new Set(Array.isArray(list) ? readTrusted(list).problems : []);
  return state.problems.some(
    ({ key, message }) => key === undefined || (key === trusted.key && !ignored.has(message)),
  );
}

/** Takes what main said of a view. */
export function takeStatus(status: Status): void {
  if (JSON.stringify(statuses.get(status.view)) !== JSON.stringify(status)) {
    statuses.set(status.view, status);
  }
  if (status.trust.kind !== 'trusted') return;
  // Trusted after all, as by a file fixed by hand: what failed before is past.
  if (failures.get(status.view) !== null) setFailure(status.view, null);
  // The offer's work is done, so a later Stop trusting finds it closed.
  if (offered.get(status.view) !== 'closed') offered.set(status.view, 'closed');
}

/**
 * What a trust button says from its press until the reader has answered main's dialog: main reads
 * what it would trust, then asks.
 */
export const TRUST_STARTS = 'Waiting…';

/**
 * What a trust button says once the reader said "Trust" in main's dialog, while main saves it. It's
 * the widest thing the button says while busy, so a button that holds its width holds this one's.
 */
export const TRUSTING = 'Trusting…';

/**
 * What a trust button says while main trusts its view, or nothing while it doesn't. Nothing says
 * the repository is being trusted until the reader said "Trust" in main's dialog.
 */
export function busyLabel(status: Status): string | undefined {
  const { trusting } = status;
  switch (trusting) {
    case 'reading':
    case 'asking':
      return TRUST_STARTS;
    case 'saving':
      return TRUSTING;
    case undefined:
      return undefined;
    default:
      trusting satisfies never;
      return TRUSTING;
  }
}

/**
 * Why trusting failed, as main sent it: a kind, as the error's code, with what GitHub, the
 * settings file or the system said as its message. The reason is a sentence of the window's, or
 * nothing for a cause it doesn't know; what was said goes behind Details.
 */
export function trustFailureWords(error: unknown): {
  message: string;
  code?: string;
  refusal?: boolean;
  details?: string;
} {
  if (!(error instanceof IpcError)) return { message: '' };
  const said = error.message === '' ? undefined : error.message;
  switch (error.code) {
    case 'renamed':
      return { message: `It’s now named ${error.message}.` };
    case 'notFork':
      return { message: 'This pull request isn’t from a fork.' };
    case 'forkGone':
      return { message: 'The fork no longer exists.' };
    case 'settingsFile':
      return { message: `${SETTINGS_FILE} has an error.`, code: SETTINGS_FILE, details: said };
    case 'unsaved':
      return { message: `${SETTINGS_FILE} couldn’t be saved.`, code: SETTINGS_FILE, details: said };
    case 'internal':
      return { message: '' };
    default:
      // A refusal of main's own, such as the question already asked about another view, says
      // itself; the rest, whose cause isn't known, have their text behind Details.
      return error.code === 'asking'
        ? { message: `Answer the question about ${error.message} first`, refusal: true }
        : { message: '', details: said };
  }
}

/** The settings file, by its name, which shows as code. */
const SETTINGS_FILE = 'settings.json';

/** What a failure to trust `status`'s view says first: what didn't happen, as a title. */
export function failureTitle(status: Status, failure: TrustFailure): string {
  return failure.pull ? 'Couldn’t trust the pull request' : `Couldn’t trust ${status.repo}`;
}

const asked = new Set<string>();

/** Asks main where a view stands, once, for a view drawn before main said anything of it. */
export function catchUp(view: string): void {
  if (statuses.get(view) !== null) return;
  if (asked.has(view)) return;
  asked.add(view);
  main()
    .state({ view })
    .then((status) => {
      if (status && statuses.get(view) === null) statuses.set(view, status);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask whether a repo is trusted:", error))
    .finally(() => asked.delete(view));
}

/** What the Language servers item offers a view nothing trusts: one line, and one button. */
export interface TrustOffer {
  /** "Language servers are off for fieldwork/atlas-api". */
  readonly line: string;
  /** Whether it offers to trust the pull request alone, from its fork, or the repo; or nothing. */
  readonly pull?: boolean | undefined;
}

/**
 * What the Language servers item offers a view, if it's off because nothing trusts it: not without
 * git, nor while Lo is still working it out, nor when the trust it has couldn't be checked, where
 * the offer could be for what's there already. A fork GitHub no longer has can't be trusted.
 */
export function offerOf(status: Status | null): TrustOffer | undefined {
  if (!status) return undefined;
  const { trust, head, repo } = status;
  if (trust.kind !== 'untrusted' || trust.why === 'unread') return undefined;
  switch (head?.kind) {
    case 'fork':
      return { line: `Language servers are off for the fork ${head.repo}`, pull: true };
    case 'gone':
      return { line: 'Language servers are off for a fork that no longer exists' };
    case 'base':
    case undefined:
      return { line: `Language servers are off for ${repo}`, pull: false };
    default:
      head satisfies never;
      return undefined;
  }
}

/**
 * Opens the Language servers item's offer on view `view`, once for its repository: where nothing
 * trusts it and it can be trusted, the first time the reader asks for what a language server
 * would answer. Main keeps that it was offered, for every tab of the repository. Not while the
 * item isn't there, as where Lo has no language server for what the view shows.
 */
export function offerOnce(view: string): void {
  const status = statuses.get(view);
  if (!status || status.dismissed || status.trusting !== undefined) return;
  if (servers.get(view)?.off !== true) return;
  const offer = offerOf(status);
  if (offer?.pull === undefined) return;
  offered.set(view, 'offered');
  statuses.set(view, { ...status, dismissed: true });
  main()
    .dismiss({ view })
    .catch((error: unknown) => console.error("Lo couldn't keep that it offered trust:", error));
}

/**
 * Asks main to ask the reader whether to trust `status`'s repository, or with `pull`, its PR. While
 * main does, the view's status says how far it has got, and a second ask does nothing. Why it
 * failed, main asking about another view meanwhile included, is kept for the status item's details
 * to say; asked from where they don't show (`elsewhere`), as from the palette, it's said in a note
 * too.
 */
export async function askToTrust(
  status: Status,
  pull: boolean,
  { elsewhere = false }: { elsewhere?: boolean } = {},
): Promise<void> {
  const { view } = status;
  if (statuses.get(view)?.trusting !== undefined) return;
  setFailure(view, null);
  const failed = (failure: TrustFailure) => {
    setFailure(view, failure);
    const now = statuses.get(view) ?? status;
    if (elsewhere) notify(failureTitle(now, failure), failure.message);
  };
  try {
    const answer = await main().trust({ view, repo: status.repo, pull: pull ? status.pull : null });
    // What the pull request joins couldn't be read from GitHub: why, by its cause.
    if (typeof answer === 'object') {
      failed({ pull, message: explain(answer.cause) ?? '', details: answer.details, file: false });
    }
  } catch (error) {
    // Asked again while main asks, as by a key held down on the banner: main asks already.
    if (error instanceof IpcError && error.code === 'busy') return;
    // Asking about another view: main says which, and brings its dialog forward.
    if (!(error instanceof IpcError && error.code === 'asking')) {
      console.error("Lo couldn't trust a repo:", error);
    }
    failed({
      pull,
      ...trustFailureWords(error),
      file: error instanceof IpcError && error.code === 'settingsFile',
    });
  }
}

/**
 * Why the palette's trust commands can't act on `status` now, or that they can: not while main is
 * trusting it already.
 */
export function askable(status: Status | string, pull: boolean): true | string {
  if (typeof status !== 'string' && status.trusting !== undefined) {
    return 'Answer the open question first';
  }
  return trustable(status, pull);
}

/** Stops trusting what trusts `status`'s view. */
export async function stopTrusting(status: Status): Promise<void> {
  try {
    await main().untrust({ view: status.view });
  } catch (error) {
    console.error("Lo couldn't stop trusting a repo:", error);
    notify(`Couldn’t stop trusting ${status.repo}`, '`settings.json` couldn’t be saved.');
  }
}

/** The view on screen's status, or why there's none to act on. */
export function onScreen(): Status | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  return statuses.get(tab.id) ?? 'Checking whether this repo is trusted';
}

/** Why the trust commands can't act on `status`, or that they can: `true`. */
export function trustable(status: Status | string, pull: boolean): true | string {
  if (typeof status === 'string') return status;
  const { trust, head } = status;
  switch (trust.kind) {
    case 'noGit':
      return 'Git wasn’t found';
    case 'trusted':
      return trust.by === 'repo'
        ? `${status.repo} is already trusted`
        : 'This pull request is already trusted';
    case 'checking':
    case 'waiting':
      return 'Checking whether this repo is trusted';
    case 'untrusted':
      break;
    default:
      trust satisfies never;
      return 'Checking whether this repo is trusted';
  }
  if (head?.kind === 'gone') return 'The fork no longer exists';
  const fork = head?.kind === 'fork';
  if (pull && !fork) return 'This pull request isn’t from a fork';
  if (!pull && fork) return 'This pull request is from a fork';
  return true;
}

/** Why "Stop trusting this repo" can't act on `status`, or that it can: `true`. */
export function untrustable(status: Status | string): true | string {
  if (typeof status === 'string') return status;
  return status.trust.kind === 'trusted' ? true : 'This repo isn’t trusted';
}
