// The comments' settings: the keys code and comments are edited with, whether Vim's are on, which
// the window follows (`./window/vim.ts`) and "Vim keys" in the command palette switches; and how
// review threads show in code (`./window/mode.ts`).

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
  named: 'Vim keys',
  description: 'Modal editing in code views and comment boxes.',
});

/**
 * How a review thread shows in code: `beside` its lines, a mark in the gutter that opens over the
 * code, so no line moves; or `between` them, the whole thread under its line, as GitHub draws it.
 */
export const threads = defineSetting(
  'comments.threads',
  z.enum(['beside', 'between']),
  'between',
  'beside or between',
  {
    group: 'pullRequests',
    label: 'Threads in code',
    named: 'how threads show in code',
    description: 'A mark that opens over the code, or the whole thread under its line.',
    options: { beside: 'Beside lines', between: 'Between lines' },
  },
);
