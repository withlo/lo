// Code other features draw: `yy` reads its lines from what draws each span's file, and from nothing
// once that lets it go.

import { describe, expect, it } from 'vitest';

import { addCodeElsewhere, drawnElsewhere, linesElsewhere } from './elsewhere.ts';

const text: Readonly<Record<string, readonly string[]>> = { a: ['one', 'two', 'three'] };

describe('code drawn elsewhere', () => {
  it('reads each span from what draws its file, in order', () => {
    const stop = addCodeElsewhere({
      has: (file) => file in text,
      lines: (span) => text[span.file]!.slice(span.from - 1, span.to),
    });
    expect(drawnElsewhere('a')).toBe(true);
    expect(drawnElsewhere('b')).toBe(false);
    expect(
      linesElsewhere([
        { file: 'a', side: 'new', from: 2, to: 3 },
        { file: 'a', side: 'new', from: 1, to: 1 },
      ]),
    ).toEqual(['two', 'three', 'one']);
    // A span whose file nothing else draws is the diff's.
    expect(linesElsewhere([{ file: 'b', side: 'new', from: 1, to: 1 }])).toBeUndefined();
    stop();
    expect(drawnElsewhere('a')).toBe(false);
    expect(linesElsewhere([{ file: 'a', side: 'new', from: 1, to: 1 }])).toBeUndefined();
  });
});
