// The stacks' settings: whether Lo offers what it could do for a stack unasked, each turned off by
// "Dismiss for all stacks" on its Dismiss, and back on in Settings › Pull requests. Main reads them,
// and sends no offer while one is off.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/** Whether the stack's tree offers to convert a branch stack it could convert to a GitHub stack. */
export const offerConvert = defineSetting(
  'stacks.offerConvert',
  z.boolean(),
  true,
  'true or false',
  {
    group: 'pullRequests',
    label: 'Offer GitHub stacks',
    named: 'the offer of GitHub stacks',
    description: 'Over a branch stack’s tree, an offer to convert it to a GitHub stack.',
  },
);

/**
 * Whether a message offers to hide the changes of the layer below, when Lo finds where a layer's
 * diff starts only after the diff is drawn.
 */
export const offerStart = defineSetting('stacks.offerStart', z.boolean(), true, 'true or false', {
  group: 'pullRequests',
  label: 'Offer layer’s own changes',
  named: 'the offer of a layer’s own changes',
  description: 'When a layer’s diff also shows the layer below’s changes, an offer to hide them.',
});
