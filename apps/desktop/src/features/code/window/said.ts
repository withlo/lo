// What code features say in a pull request's tab's status bar, quietly and once: that a key found
// nothing, as "No definition of `parse` found", or why it can't answer yet. A message stays a few
// seconds, or until the next one, and goes with its tab.

import { NOTICE_TIME } from '../../../window/commands/notices.tsx';
import { tabState } from '../../tab/window/shared.ts';

/** What each view's status bar says, with a count so the same words said again are a new message. */
export const said = tabState<{ readonly text: string; readonly count: number } | undefined>(
  () => undefined,
);

let count = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Says `text` in view `tab`'s status bar, in place of what it said, for a few seconds. */
export function say(tab: string, text: string): void {
  count += 1;
  const message = { text, count };
  said.set(tab, message);
  clearTimeout(timers.get(tab));
  timers.set(
    tab,
    setTimeout(() => {
      timers.delete(tab);
      if (said.get(tab) === message) said.set(tab, undefined);
    }, NOTICE_TIME),
  );
}

/** Takes back what view `tab`'s status bar says, as when what it said no longer holds. */
export function unsay(tab: string): void {
  clearTimeout(timers.get(tab));
  timers.delete(tab);
  if (said.get(tab) !== undefined) said.set(tab, undefined);
}
