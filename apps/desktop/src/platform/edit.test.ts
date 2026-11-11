import { describe, expect, it } from 'vitest';

import { editMenu } from './edit.ts';

/** Each item as the menu shows it: its role or label, or a separator. */
function shown(items: ReturnType<typeof editMenu>): string[] {
  return items.map((item) => item.role ?? item.label ?? item.type ?? '?');
}

describe('the Edit menu for a text field', () => {
  it('is cut, copy, paste and select all, which the system enables by what’s selected', () => {
    const items = editMenu({ misspelledWord: '', dictionarySuggestions: [] }, () => {});
    expect(shown(items)).toEqual(['cut', 'copy', 'paste', 'separator', 'selectAll']);
  });

  it('starts with the suggestions for a misspelled word, and puts one in its place', () => {
    const replaced: string[] = [];
    const items = editMenu(
      {
        misspelledWord: 'tehn',
        dictionarySuggestions: ['then', 'ten', 'teen', 'tern', 'tin', 'tan'],
      },
      (word) => replaced.push(word),
    );
    expect(shown(items)).toEqual([
      'then',
      'ten',
      'teen',
      'tern',
      'tin',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ]);
    const click = items[1]?.click;
    if (click) Reflect.apply(click, undefined, []);
    expect(replaced).toEqual(['ten']);
  });

  it('says so when a misspelled word has no suggestion', () => {
    const items = editMenu({ misspelledWord: 'zzqx', dictionarySuggestions: [] }, () => {});
    expect(items[0]).toEqual({ label: 'No suggestions', enabled: false });
    expect(shown(items).slice(1, 3)).toEqual(['separator', 'cut']);
  });
});
