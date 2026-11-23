import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';
import { gitTrouble } from '../../ipc/git.ts';

export { gitTrouble, type GitTrouble } from '../../ipc/git.ts';

export const theme = z.enum(['dark', 'light']);
export type Theme = z.output<typeof theme>;

/**
 * Whether Lo has a git it can run, so the window can say when it hasn't: `checking` until Lo has
 * looked, which it does once the window is up; `found`, with its version; or why not.
 */
export const gitInfo = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('checking') }),
  z.strictObject({ status: z.literal('found'), version: z.string() }),
  ...gitTrouble.options,
]);
export type GitInfo = z.output<typeof gitInfo>;

/** What `app.info` answers, which main checks against this before it answers. */
export const appInfo = z.strictObject({
  /** Lo's version. */
  version: z.string(),
  /** The system Lo runs on, as Node names it: `darwin` or `linux`. */
  platform: z.string(),
  /** The current theme, which `app.theme` then keeps up to date. */
  theme,
  /** Whether Lo has a git it can run, which `app.git` then keeps up to date. */
  git: gitInfo,
  /** Whether Lo runs as it ships, rather than built from source, as for its tests. */
  packaged: z.boolean(),
  /**
   * The first digits of the commit this build is of, which Settings shows beside the version.
   * Absent when none could be found, as for a copy of the source with no history.
   */
  commit: z.string().min(1).optional(),
  /**
   * The nonce in the page's content security policy, new each time the page loads, which lets in
   * the style elements that carry it: the code views hand it to theirs.
   */
  nonce: z.string().min(1),
  /**
   * How long the window holds back what a pull request's tab shows first, as it opens, in
   * milliseconds, when a test asked for another bound than its own, which only a build run from
   * source takes. Absent otherwise.
   */
  holdLimit: z.number().int().nonnegative().optional(),
});
export type AppInfo = z.output<typeof appInfo>;

/** A step of the window's zoom: in, out, or back to its actual size. */
export const zoomStep = z.enum(['in', 'out', 'reset']);
export type ZoomStep = z.output<typeof zoomStep>;

export const contract = defineContract('app', {
  requests: {
    info: { input: z.undefined(), reply: reply<AppInfo>() },
    // What the app menu's roles do on macOS, for Linux, which has no app menu.
    /** Shows the system's About panel. */
    about: { input: z.undefined(), reply: reply<void>() },
    /** Quits Lo. */
    quit: { input: z.undefined(), reply: reply<void>() },
    /** Zooms the window's page a step in or out, or back to its actual size. */
    zoom: { input: z.strictObject({ step: zoomStep }), reply: reply<void>() },
    /** Takes the window into full screen, or out of it. */
    fullScreen: { input: z.undefined(), reply: reply<void>() },
    /**
     * Opens the file of licenses, Lo's own and those of everything it ships, in the system's app
     * for text. It fails with `unopened` and the reason when the file isn't there or can't be
     * opened.
     */
    licenses: { input: z.undefined(), reply: reply<void>() },
  },
  topics: {
    /** The system's appearance, each time it changes. */
    theme,
    /** What Lo finds each time it looks for git. */
    git: gitInfo,
  },
});
