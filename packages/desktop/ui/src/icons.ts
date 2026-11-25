// The Lucide icons Lo uses, under Lucide's own names (lucide.dev/icons), and the only file that
// imports `lucide`. To use another icon, add it here. Each is a list of shapes on Lucide's 24 grid,
// stroke only with round caps and joins; `Icon` draws one, and `iconElement` in a code view's DOM.

import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronUp,
  Command,
  CornerDownLeft,
  Delete,
  Ellipsis,
  Option,
  X,
  type IconNode,
} from 'lucide';

/** Each icon's shapes, by its Lucide name. */
export const ICONS = {
  'arrow-big-up': ArrowBigUp,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-left-right': ArrowLeftRight,
  'arrow-right': ArrowRight,
  'arrow-right-to-line': ArrowRightToLine,
  'arrow-up': ArrowUp,
  'arrow-up-right': ArrowUpRight,
  check: Check,
  'chevron-up': ChevronUp,
  command: Command,
  'corner-down-left': CornerDownLeft,
  delete: Delete,
  ellipsis: Ellipsis,
  option: Option,
  x: X,
} as const satisfies Readonly<Record<string, IconNode>>;

/** The name of an icon Lo uses, as Lucide names it. */
export type IconName = keyof typeof ICONS;
