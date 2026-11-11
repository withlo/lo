// The window's tabs: the kinds of tab, what the window may ask main to do with them, and what main
// tells the window each time they change. Main keeps the tabs, so a link from another app opens one
// as surely as a key does, and they come back after Lo restarts.

import { parsePullLink } from '@lo/review';
import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** A pull request's state, as its tab shows it. */
export const pullState = z.enum(['open', 'draft', 'merged', 'closed']);
export type PullState = z.output<typeof pullState>;

/** A tab's id, which main gives it as it opens. */
export const tabId = z.string().min(1).max(64);

/**
 * A pull request on github.com, named as the link it was opened from names it: an owner and a
 * repository GitHub allows (they name a folder in Lo's cache, so nothing else gets through), and a
 * number GitHub can hold.
 */
const pullRequest = {
  owner: z.string().min(1).max(39),
  repo: z.string().min(1).max(100),
  number: z.number().int().min(1),
};

/** Whether a pull request's owner, repository and number are as a link to it would read them. */
function isPullRequest({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  try {
    const read = parsePullLink(`https://github.com/${owner}/${repo}/pull/${number}`);
    return read.owner === owner && read.repo === repo && read.number === number;
  } catch {
    return false;
  }
}

/**
 * A tab as the strip shows it. Its kind says what it holds:
 *
 * - `pull`, a pull request (or a whole stack), with its title and state once GitHub has given
 *   them. They're kept, so a tab that hasn't been shown since Lo started still says what it holds.
 * - `recent`, the pull requests opened recently. It stands in for an empty strip: it's there only
 *   while no other tab is, and it can't be closed.
 * - `settings`, Lo's settings, open in one tab at most.
 */
export const tab = z.discriminatedUnion('kind', [
  z.strictObject({
    id: tabId,
    kind: z.literal('pull'),
    ...pullRequest,
    title: z.string().optional(),
    state: pullState.optional(),
  }),
  z.strictObject({ id: tabId, kind: z.literal('recent') }),
  z.strictObject({ id: tabId, kind: z.literal('settings') }),
]);
export type Tab = z.output<typeof tab>;

/** Every kind of tab. */
export type Kind = Tab['kind'];

/** The tabs in the strip's order, and the one on screen. There's always at least one. */
export const tabs = z.strictObject({ tabs: z.array(tab).min(1), active: tabId });
export type Tabs = z.output<typeof tabs>;

/** What a tab opens on: a pull request, or Settings. Recent opens by itself. */
export const opening = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('pull'), ...pullRequest })
    .refine(isPullRequest, 'Not a pull request on github.com.'),
  z.strictObject({ kind: z.literal('settings') }),
]);
export type Opening = z.output<typeof opening>;

/**
 * Which tab to show: one by its id, by its place in the strip (from 1), the last, or the one
 * after or before the tab on screen, round the ends.
 */
export const choice = z.union([
  z.strictObject({ id: tabId }),
  z.strictObject({ position: z.number().int().min(1).max(1_000_000) }),
  z.strictObject({ last: z.literal(true) }),
  z.strictObject({ step: z.union([z.literal(1), z.literal(-1)]) }),
]);
export type Choice = z.output<typeof choice>;

export const contract = defineContract('tab', {
  requests: {
    list: { input: z.undefined(), reply: reply<Tabs>() },
    /**
     * Opens a tab and shows it, and replies with its id. A pull request already open, by any name
     * it's known by, or Settings when it's open, shows the tab it's in.
     */
    open: { input: opening, reply: reply<string>() },
    /** Closes a tab, or without an id, the one on screen. Recent can't be closed. */
    close: { input: z.strictObject({ id: tabId.optional() }), reply: reply<void>() },
    select: { input: choice, reply: reply<void>() },
    /** Moves a tab to another place in the strip, from 0. */
    move: {
      input: z.strictObject({ id: tabId, to: z.number().int().min(0).max(1_000_000) }),
      reply: reply<void>(),
    },
  },
  topics: {
    /** The tabs, each time they change. */
    tabs,
  },
});
