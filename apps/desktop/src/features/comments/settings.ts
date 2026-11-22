// The setting for the keys code and comments are edited with: whether Vim's are on. The window
// follows it (`./window/vim.ts`), and "Vim keys" in the command palette switches it.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Whether code views and comment boxes run Vim's keys. Off, as Lo starts, they have a plain caret:
 * click, arrows, Shift to select, and typing in a box as soon as it has focus. Lo's own single
 * keys work either way.
 */
export const vim = defineSetting('editor.vim', z.boolean(), false, 'true or false', {
  group: 'keyboard',
  label: 'Vim keys',
  description: 'Modal editing in code views and comment boxes.',
});
