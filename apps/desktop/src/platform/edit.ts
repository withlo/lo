// The system's Edit menu, for a right-click in a text field: what a person expects of any text box.
// Lo's own right-click menus skip text fields, which this stands in for.

import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

/** How many spelling suggestions the menu offers. */
const SUGGESTIONS = 5;

/**
 * The Edit menu for a text field: spelling suggestions first, when the word under the pointer is
 * misspelled, then cut, copy, paste and select all, which the system's roles enable or grey by
 * what is selected and on the clipboard. `replace` puts a suggestion in the word's place.
 */
export function editMenu(
  params: Pick<ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions'>,
  replace: (word: string) => void,
): MenuItemConstructorOptions[] {
  const suggestions: MenuItemConstructorOptions[] =
    params.misspelledWord === ''
      ? []
      : [
          ...(params.dictionarySuggestions.length > 0
            ? params.dictionarySuggestions.slice(0, SUGGESTIONS).map((word) => ({
                label: word,
                click: () => replace(word),
              }))
            : [{ label: 'No suggestions', enabled: false }]),
          { type: 'separator' },
        ];
  return [
    ...suggestions,
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { type: 'separator' },
    { role: 'selectAll' },
  ];
}
