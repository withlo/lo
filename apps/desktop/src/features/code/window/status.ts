// Where each view of a pull request's tab stands with trust, as main last said: kept with the
// view, and gone when its tab closes. What the banner says, and what the palette's trust commands
// may do, follow from it, as plain functions tested alone. The window only asks: main asks the
// reader in its own dialog before it trusts anything. While it does, the view's status says how far
// it has got, which the trust buttons show, and the window keeps why the last ask didn't trust a
// view, for the banner and the status item's details to say in place.

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { activeTab, tabState, type BannerSwitch } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import { main } from './main.ts';

/** Where each view stands, once main has said. */
export const statuses = tabState<Status | null>(() => null);

/** Why asking to trust a view didn't trust it, as main said. */
export interface TrustFailure {
  /** Whether it was its pull request alone that was asked about. */
  readonly pull: boolean;
  /** Why, in a sentence or two. */
  readonly message: string;
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
 * fixed, so what it said of that goes, and the banner offers to trust it again.
 */
export function settingsChanged(): void {
  for (const view of fileFailed) {
    if (failures.get(view)?.file) failures.set(view, null);
  }
  fileFailed.clear();
}

/** Takes what main said of a view. */
export function takeStatus(status: Status): void {
  if (JSON.stringify(statuses.get(status.view)) !== JSON.stringify(status)) {
    statuses.set(status.view, status);
  }
  // Trusted after all, as by a file fixed by hand: what failed before is past.
  if (status.trust.kind === 'trusted' && failures.get(status.view) !== null) {
    setFailure(status.view, null);
  }
}

/**
 * What a trust button says from its press until the reader has answered main's dialog: main reads
 * what it would trust, then asks.
 */
export const TRUST_STARTS = 'Waiting…';

/**
 * What a trust button says while main trusts its view, or nothing while it doesn't. Nothing says
 * the trust is being saved until the reader said "Trust" in main's dialog. With its ring, each is
 * narrower than the shortest label, "Trust repo…", so the button is one width from before its
 * press until it's done: a word any wider, "Checking…" or "Trusting…", would widen it.
 */
export function busyLabel(status: Status): string | undefined {
  const { trusting } = status;
  switch (trusting) {
    case 'reading':
    case 'asking':
      return TRUST_STARTS;
    case 'saving':
      return 'Saving…';
    case undefined:
      return undefined;
    default:
      trusting satisfies never;
      return 'Saving…';
  }
}

/** What a failure to trust `status`'s view says first: what didn't happen, as a title. */
export function failureTitle(status: Status, failure: TrustFailure): string {
  return failure.pull ? 'Couldn’t trust the pull request' : `Couldn’t trust ${status.repo}`;
}

const asked = new Set<string>();

/** Asks main where a view stands, once, for a view drawn before main said anything of it. */
function catchUp(view: string): void {
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

/**
 * What the banner says of a view, with what it offers: one fact in a line, one button, and a
 * dismiss. A second line only once trusting failed, for why.
 */
export interface TrustBannerText {
  /** `danger` once trusting it failed. */
  readonly tone: 'warn' | 'danger';
  readonly title: string;
  readonly detail?: string | undefined;
  /**
   * The button that asks main to ask the reader, if trusting can help, with what Lo is doing
   * while it does.
   */
  readonly action?:
    | { readonly label: string; readonly pull: boolean; readonly busy?: string | undefined }
    | undefined;
  /** Whether it offers to open the settings file, for what it holds that kept Lo from trusting. */
  readonly openFile?: boolean | undefined;
}

/**
 * The banner a view shows, if any: on a view language servers are off for because nothing trusts
 * it, until the reader dismisses it for its repository. Not without git, which has its own, nor
 * while Lo is still working it out, nor when the trust it has couldn't be checked: then the
 * banner would offer what may be there already. While main trusts it, its button says how far
 * that has got; once that failed (`failure`), it says why, and offers to try again.
 */
export function bannerOf(
  status: Status | null,
  failure: TrustFailure | null = null,
): TrustBannerText | undefined {
  const offered = offerOf(status);
  if (!status || !offered) return undefined;
  const busy = busyLabel(status);
  const action =
    busy === undefined ? offered.action : offered.action && { ...offered.action, busy };
  if (!failure) return { tone: 'warn', ...offered, action };
  return {
    tone: 'danger',
    title: failureTitle(status, failure),
    detail: failure.message,
    action,
    openFile: failure.file,
  };
}

/** What the banner says of a view before the reader asks anything, if it shows. */
function offerOf(status: Status | null): Omit<TrustBannerText, 'tone'> | undefined {
  if (!status || status.dismissed) return undefined;
  const { trust, head, repo } = status;
  if (trust.kind !== 'untrusted' || trust.why === 'unread') return undefined;
  switch (head?.kind) {
    case 'fork':
      return {
        title: `Language servers are off for the fork ${head.repo}`,
        action: { label: 'Trust pull request…', pull: true },
      };
    case 'gone':
      return { title: 'Language servers are off for a fork that no longer exists' };
    case 'base':
    case undefined:
      return {
        title: `Language servers are off for ${repo}`,
        action: { label: 'Trust repo…', pull: false },
      };
    default:
      head satisfies never;
      return undefined;
  }
}

/**
 * Whether each view's banner has been drawn: `on` while it's on screen, which holds its place in
 * the tab until it has closed, and `off` once it has gone.
 */
export const drawn = tabState<'never' | 'on' | 'off'>(() => 'never');

/**
 * Whether a view's banner shows: while there's something to offer, and then until the banner has
 * closed, so it leaves as it came. A view drawn before main said anything asks as it comes on
 * screen.
 */
export const trustSwitch: BannerSwitch = {
  shows: (tab) => bannerOf(statuses.get(tab.id)) !== undefined || drawn.get(tab.id) === 'on',
  subscribe(tab, listener) {
    if (statuses.get(tab.id) === null) catchUp(tab.id);
    const stops = [statuses.subscribe(listener), drawn.subscribe(listener)];
    return () => {
      for (const stop of stops) stop();
    };
  },
};

/**
 * Asks main to ask the reader whether to trust `status`'s repository, or with `pull`, its PR. While
 * main does, the view's status says how far it has got, and a second ask does nothing. Why it
 * failed, main asking about another view meanwhile included, is kept for the banner and the status
 * item's details to say; asked from where neither shows (`elsewhere`), as from the palette with the
 * banner dismissed, it's said in a note too.
 */
export async function askToTrust(
  status: Status,
  pull: boolean,
  { elsewhere = false }: { elsewhere?: boolean } = {},
): Promise<void> {
  const { view } = status;
  if (statuses.get(view)?.trusting !== undefined) return;
  setFailure(view, null);
  try {
    await main().trust({ view, repo: status.repo, pull: pull ? status.pull : null });
  } catch (error) {
    // Asked again while main asks, as by a key held down on the banner: main asks already.
    if (error instanceof IpcError && error.code === 'busy') return;
    // Asking about another view: main says which, and brings its dialog forward.
    if (!(error instanceof IpcError && error.code === 'asking')) {
      console.error("Lo couldn't trust a repo:", error);
    }
    const failure: TrustFailure = {
      pull,
      message:
        error instanceof IpcError && error.code !== 'internal' ? error.message : 'Try again.',
      file: error instanceof IpcError && error.code === 'settingsFile',
    };
    setFailure(view, failure);
    const now = statuses.get(view) ?? status;
    if (elsewhere && !bannerOf(now)) {
      notify(failureTitle(now, failure), failure.message);
    }
  }
}

/**
 * Why the palette's trust commands can't act on `status` now, or that they can: not while main is
 * trusting it already.
 */
export function askable(status: Status | string, pull: boolean): true | string {
  if (typeof status !== 'string' && status.trusting !== undefined) {
    return 'Lo is asking whether to trust this repo already.';
  }
  return trustable(status, pull);
}

/** Stops trusting what trusts `status`'s view. */
export async function stopTrusting(status: Status): Promise<void> {
  try {
    await main().untrust({ view: status.view });
  } catch (error) {
    console.error("Lo couldn't stop trusting a repo:", error);
    notify('Stop trusting this repo', "Lo couldn't change the settings file.");
  }
}

/** Dismisses the banner for `status`'s repository. */
export async function dismissBanner(status: Status): Promise<void> {
  // Gone at once; main keeps it for every tab of the repository, and says so.
  statuses.set(status.view, { ...status, dismissed: true });
  setFailure(status.view, null);
  try {
    await main().dismiss({ view: status.view });
  } catch (error) {
    console.error("Lo couldn't dismiss the banner:", error);
  }
}

/** The view on screen's status, or why there's none to act on. */
export function onScreen(): Status | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return "There's no pull request on screen.";
  return statuses.get(tab.id) ?? 'Lo is still working out whether this repo is trusted.';
}

/** Why the trust commands can't act on `status`, or that they can: `true`. */
export function trustable(status: Status | string, pull: boolean): true | string {
  if (typeof status === 'string') return status;
  const { trust, head } = status;
  switch (trust.kind) {
    case 'noGit':
      return 'Code features need git.';
    case 'trusted':
      return trust.by === 'repo'
        ? `Lo trusts ${status.repo} already.`
        : 'Lo trusts this PR already.';
    case 'checking':
    case 'waiting':
      return 'Lo is still working out whether this repo is trusted.';
    case 'untrusted':
      break;
    default:
      trust satisfies never;
      return 'Lo is still working out whether this repo is trusted.';
  }
  if (head?.kind === 'gone') return 'GitHub no longer has the fork this PR comes from.';
  const fork = head?.kind === 'fork';
  if (pull && !fork) return "This PR's branch is in the repo itself: trust the repo instead.";
  if (!pull && fork) return 'This PR comes from a fork: trust this PR instead.';
  return true;
}

/** Why "Stop trusting this repo" can't act on `status`, or that it can: `true`. */
export function untrustable(status: Status | string): true | string {
  if (typeof status === 'string') return status;
  return status.trust.kind === 'trusted' ? true : "Lo doesn't trust this repo.";
}
