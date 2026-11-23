// Finds Base UI popups drawn outside the shared pieces. A popup is anything that floats over the
// page: a dialog, a menu, a popover, a tooltip, a toast. How each comes and goes, where focus
// returns and what it's drawn on is written once, in the shared pieces of src/, so a file that
// reaches past them for Base UI's own parts gets none of it; check-popups.ts keeps that out.

import { parseSync } from 'oxc-parser';

/** Base UI's modules whose parts float over the page. */
export const POPUPS: readonly string[] = [
  'alert-dialog',
  'autocomplete',
  'combobox',
  'context-menu',
  'dialog',
  'drawer',
  'menu',
  'menubar',
  'navigation-menu',
  'popover',
  'preview-card',
  'select',
  'toast',
  'tooltip',
];

/** The shared pieces, by path under the folder checked: the only files that draw a popup. */
export const SHARED: readonly string[] = [
  'ContextMenu.tsx',
  'Dialog.tsx',
  'Palette.tsx',
  'Popover.tsx',
  'Toast.tsx',
  'Tooltip.tsx',
];

/**
 * Files that drew a popup of their own before the shared pieces could hold it. Each moves to a
 * shared piece and comes off this list; nothing is added to it.
 */
export const NOT_YET: readonly string[] = ['MergePanel.tsx', 'overview/Term.tsx'];

export interface PopupFinding {
  file: string;
  line: number;
  /** The module imported, such as `@base-ui/react/menu`. */
  module: string;
}

const base = '@base-ui/react';

/** Whether a module is Base UI's whole bundle, popups among them, or one of its popups. */
function isPopup(module: string): boolean {
  if (module === base) return true;
  return module.startsWith(`${base}/`) && POPUPS.includes(module.slice(base.length + 1));
}

/** The popups a file imports, by the line of each import, whatever kind of import it is. */
export function findPopups(file: string, source: string): PopupFinding[] {
  const { module } = parseSync(file, source);
  const requests = [
    ...module.staticImports.map((entry) => entry.moduleRequest),
    ...module.staticExports.flatMap((entry) =>
      entry.entries.flatMap(({ moduleRequest }) => moduleRequest ?? []),
    ),
  ];
  const dynamic = module.dynamicImports.flatMap((entry) => {
    const text = source.slice(entry.moduleRequest.start, entry.moduleRequest.end);
    const literal = /^(['"`])(.*)\1$/.exec(text);
    return literal?.[2] === undefined ? [] : [{ value: literal[2], start: entry.start }];
  });
  const line = (offset: number) => source.slice(0, offset).split('\n').length;
  return [...requests.map(({ value, start }) => ({ value, start })), ...dynamic]
    .filter(({ value }) => isPopup(value))
    .map(({ value, start }) => ({ file, line: line(start), module: value }));
}
