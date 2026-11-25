// Dismissing the stacks' offers: the offer over the stack's tree to convert it to a GitHub stack,
// and the message that offers to hide the changes of the layer below. Each one's Dismiss opens its
// menu, a right-click target of its own (`notice`) that names the tab it's in, whose rows dismiss
// it there, for this stack or layer, which main keeps through restarts, or for all stacks, which
// turns its setting off until Settings turns it on. From the palette, they act on the tab on screen.

import type { Handler, NoticeTarget, NoTarget } from '@lo/ui/commands';

import { fail, saidBy } from '../../../window/commands/notices.tsx';
import type { Setting } from '../../settings/contract.ts';
import { changeSetting, settingNow } from '../../settings/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Notice } from '../contract.ts';
import { offerConvert, offerStart } from '../settings.ts';
import { stacks } from './layers.ts';
import { main } from './main.ts';
import { offerFor } from './offers.ts';
import { pullOnScreen } from './walk.ts';

/** The offer over the stack's tree to convert it to a GitHub stack, as its menu names it. */
const CONVERT = 'stacks.convert';

/** The message that offers to hide the changes of the layer below, as its menu names it. */
const START = 'stacks.start';

/** The menu of the offer over tab `tab`'s stack's tree to convert it to a GitHub stack. */
export function convertNotice(tab: PullTab): NoticeTarget {
  return { kind: 'notice', notice: CONVERT, tab: tab.id };
}

/** The menu of the message in tab `tab` that offers to hide the changes of the layer below. */
export function startNotice(tab: PullTab): NoticeTarget {
  return { kind: 'notice', notice: START, tab: tab.id, pull: tab.number };
}

type Target = NoticeTarget | NoTarget;

/** Whether `target` is the menu of `notice`, or the palette or a key, which act on the tab on screen. */
function isFor(notice: string, target: Target): boolean {
  return target.kind === 'none' || target.notice === notice;
}

/**
 * The tab `target` acts in, by its view's id, and its layer's number where it says: the tab the
 * offer is in, whichever is on screen now, or for the palette, the one on screen.
 */
function tabOf(target: Target): { id: string; number: number | undefined } | undefined {
  if (target.kind === 'notice') return { id: target.tab, number: target.pull };
  const tab = pullOnScreen();
  return typeof tab === 'string' ? undefined : { id: tab.id, number: tab.number };
}

/** Whether `target`'s tab offers `notice` now: `true`, or an empty reason, which lists nothing. */
function offering(notice: Notice, target: Target): true | string {
  const tab = tabOf(target);
  if (!tab) return '';
  if (notice === 'start') return offerFor(tab.id) === null ? '' : true;
  const view = stacks.get(tab.id);
  return view?.kind === 'stack' && view.callout !== null ? true : '';
}

/** Dismisses `notice` for the stack or the layer of `target`'s tab, as main keeps it. */
async function dismiss(notice: Notice, target: Target): Promise<void> {
  const tab = tabOf(target);
  if (!tab) return;
  try {
    await main().dismiss({ id: tab.id, notice });
  } catch (error) {
    fail('Couldn’t dismiss the offer', saidBy(error));
  }
}

/** Dismisses `notice` for this stack or layer: from its menu, or the palette while it shows. */
function dismissHere(of: string, notice: Notice): Handler<Target> {
  return {
    run: (target) => dismiss(notice, target),
    enabled: (target) => offering(notice, target),
    listed: (target) => isFor(of, target),
  };
}

/**
 * Settings' switch for whether `notice` is offered, which its menu's "Dismiss for all stacks" turns
 * off; the palette turns it either way.
 */
function offerSwitch(of: string, setting: Setting<boolean>): Handler<Target> {
  return {
    run: async (target) => {
      await changeSetting(setting, target.kind === 'notice' ? false : !settingNow(setting));
    },
    checked: () => settingNow(setting),
    listed: (target) => isFor(of, target),
  };
}

export const dismissConvert = dismissHere(CONVERT, 'convert');
export const offerConvertSwitch = offerSwitch(CONVERT, offerConvert);
export const dismissStart: Handler<Target> = {
  ...dismissHere(START, 'start'),
  // The layer it's dismissed for, by its number.
  named: (target) => {
    const number = tabOf(target)?.number;
    return number === undefined ? undefined : `Dismiss for #${String(number)}`;
  },
};
export const offerStartSwitch = offerSwitch(START, offerStart);
