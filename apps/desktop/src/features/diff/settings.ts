// The diff's settings: how it's laid out, and whether it shows changes to whitespace alone. `gi`
// and `gw` change them from the diff, and they apply to every tab.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/** The diff's layout: the two sides next to each other, or one column of both. */
export const layout = defineSetting(
  'diff.layout',
  z.enum(['split', 'inline']),
  'split',
  'split or inline',
);

/**
 * Whether the diff shows changes to whitespace alone, or hides them as `git diff -w` does. GitHub's
 * diff, shown until the local copy is ready, shows them either way.
 */
export const whitespace = defineSetting(
  'diff.whitespace',
  z.enum(['show', 'hide']),
  'show',
  'show or hide',
);
