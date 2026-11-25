// Dismissing the stacks' offers: the offer over the stack's tree to convert it to a GitHub stack,
// and the message that offers to hide the changes of the layer below. Each one's Dismiss opens its
// menu, a right-click target of its own (`notice`), whose rows dismiss it for this stack or layer,
// which main keeps through restarts, or for all stacks, which turns its setting off until Settings
// turns it on. From the palette, they act on the tab on screen.

import type { Handler, NoticeTarget, NoTarget } from '@lo/ui/commands';

import { fail, saidBy } from '../../../window/commands/notices.tsx';
import type { Setting } from '../../settings/contract.ts';
import { changeSetting, settingNow } from '../../settings/window/shared.ts';
import type { Notice } from '../contract.ts';
import { offerConvert, offerStart } from '../settings.ts';
import { stacks } from './layers.ts';
import { main } from './main.ts';
import { offerFor } from './offers.ts';
import { pullOnScreen } from './walk.ts';

/** The menu of the offer over the stack's tree to convert it to a GitHub stack. */
export const CONVERT_NOTICE: NoticeTarget = { kind: 'notice', notice: 'stacks.convert' };

/** The menu of the message that offers to hide the changes of the layer below. */
export const START_NOTICE: NoticeTarget = { kind: 'notice', notice: 'stacks.start' };

type Target = NoticeTarget | NoTarget;

/** Whether `target` is `notice`'s menu, or the palette or a key, which act on the tab on screen. */
function isFor(notice: NoticeTarget, target: Target): boolean {
  return target.kind === 'none' || target.notice === notice.notice;
}

/** Whether the tab on screen offers `notice` now: `true`, or an empty reason, which lists nothing. */
function offering(notice: Notice): true | string {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return '';
  if (notice === 'start') return offerFor(tab.id) === null ? '' : true;
  const view = stacks.get(tab.id);
  return view?.kind === 'stack' && view.callout !== null ? true : '';
}

/** Dismisses `notice` for the stack or the layer on screen, as main keeps it. */
async function dismiss(notice: Notice): Promise<void> {
  const tab = pullOnScreen();
  if (typeof tab === 'string') return;
  try {
    await main().dismiss({ id: tab.id, notice });
  } catch (error) {
    fail('Couldn’t dismiss the offer', saidBy(error));
  }
}

/** Dismisses `notice` for this stack or layer: from its menu, or the palette while it shows. */
function dismissHere(of: NoticeTarget, notice: Notice): Handler<Target> {
  return {
    run: () => dismiss(notice),
    enabled: () => offering(notice),
    listed: (target) => isFor(of, target),
  };
}

/**
 * Settings' switch for whether `notice` is offered, which its menu's "Dismiss for all stacks" turns
 * off; the palette turns it either way.
 */
function offerSwitch(of: NoticeTarget, setting: Setting<boolean>): Handler<Target> {
  return {
    run: async (target) => {
      await changeSetting(setting, target.kind === 'notice' ? false : !settingNow(setting));
    },
    checked: () => settingNow(setting),
    listed: (target) => isFor(of, target),
  };
}

export const dismissConvert = dismissHere(CONVERT_NOTICE, 'convert');
export const offerConvertSwitch = offerSwitch(CONVERT_NOTICE, offerConvert);
export const dismissStart: Handler<Target> = {
  ...dismissHere(START_NOTICE, 'start'),
  // The layer it's dismissed for, by its number.
  named: () => {
    const tab = pullOnScreen();
    return typeof tab === 'string' ? undefined : `Dismiss for #${String(tab.number)}`;
  },
};
export const offerStartSwitch = offerSwitch(START_NOTICE, offerStart);
