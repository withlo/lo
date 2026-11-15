// Where each view of a pull request's tab stands with trust, as main last said: kept with the
// view, and gone when its tab closes. What the banner says, and what the palette's trust commands
// may do, follow from it, as plain functions tested alone. The window only asks: main asks the
// reader in its own dialog before it trusts anything.

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import { activeTab, tabState, type BannerSwitch } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import { main } from './main.ts';

/** Where each view stands, once main has said. */
export const statuses = tabState<Status | null>(() => null);

/** Takes what main said of a view. */
export function takeStatus(status: Status): void {
  if (JSON.stringify(statuses.get(status.view)) !== JSON.stringify(status)) {
    statuses.set(status.view, status);
  }
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

/** What the banner says of a view, in the design's words, with what it offers. */
export interface TrustBannerText {
  readonly title: string;
  readonly detail: string;
  /** The button that asks main to ask the reader, if trusting can help. */
  readonly action?: { readonly label: string; readonly pull: boolean } | undefined;
}

/**
 * The banner a view shows, if any: on a view language servers are off for because nothing trusts
 * it, until the reader dismisses it for its repository. Not without git, which has its own, nor
 * while Lo is still working it out, nor when the trust it has couldn't be checked: then the
 * banner would offer what may be there already.
 */
export function bannerOf(status: Status | null): TrustBannerText | undefined {
  if (!status || status.dismissed) return undefined;
  const { trust, head, repo } = status;
  if (trust.kind !== 'untrusted' || trust.why === 'unread') return undefined;
  switch (head?.kind) {
    case 'fork':
      return {
        title: `This PR comes from a fork, ${head.repo}.`,
        detail: 'Its code runs only if you trust it.',
        action: { label: 'Trust this PR', pull: true },
      };
    case 'gone':
      return {
        title: 'This PR comes from a fork GitHub no longer has.',
        detail: "Lo can't tell whose code it is, so language servers stay off.",
      };
    case 'base':
    case undefined:
      return {
        title: `Language servers are off for ${repo}.`,
        detail: 'Lo runs them only on repos you trust.',
        action: { label: 'Trust this repo', pull: false },
      };
    default:
      head satisfies never;
      return undefined;
  }
}

/** Whether a view's banner shows. A view drawn before main said anything asks as it comes on screen. */
export const trustSwitch: BannerSwitch = {
  shows: (tab) => bannerOf(statuses.get(tab.id)) !== undefined,
  subscribe(tab, listener) {
    if (statuses.get(tab.id) === null) catchUp(tab.id);
    return statuses.subscribe(listener);
  },
};

/** Asks main to ask the reader whether to trust `status`'s repository, or with `pull`, its PR. */
export async function askToTrust(status: Status, pull: boolean): Promise<void> {
  try {
    await main().trust({ view: status.view, repo: status.repo, pull: pull ? status.pull : null });
  } catch (error) {
    // Asked again while main's dialog is open, as by a key held down on the banner: the dialog
    // already asks.
    if (error instanceof IpcError && error.code === 'busy') return;
    console.error("Lo couldn't ask whether to trust a repo:", error);
    notify(
      pull ? 'Trust this PR' : 'Trust this repo',
      error instanceof IpcError && error.code !== 'internal'
        ? error.message
        : "Lo couldn't ask whether to trust it.",
    );
  }
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
