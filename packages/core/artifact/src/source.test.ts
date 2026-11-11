import { describe, expect, test } from 'vitest';

import { found, HEADER, overview, timed } from '../test/support.ts';
import { LIMITS, parseArtifact } from './index.ts';
import { utf8Length } from './source.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** An overview of exactly `size` bytes of UTF-8. */
function sized(size: number, filler = 'x'): string {
  const start = overview('');
  return start + filler.repeat(Math.floor((size - encode(start).length) / encode(filler).length));
}

describe('the file', () => {
  test('bytes and text read the same', () => {
    const text = overview('Ünïcödé, 🧪 and [a](code:src/ä.ts#L1).\n');
    expect(parseArtifact(encode(text))).toEqual(parseArtifact(text));
  });

  test('its size is in bytes of UTF-8, a byte-order mark aside', () => {
    const text = overview('é🧪\n');
    expect(parseArtifact(text).size).toBe(encode(text).length);
    expect(parseArtifact(`\uFEFF${text}`).size).toBe(encode(text).length);
    expect(parseArtifact(encode(`\uFEFF${text}`)).size).toBe(encode(text).length);
  });

  test('up to 256 KiB is read, and a byte more is too large', () => {
    const at = sized(LIMITS.size);
    expect(encode(at).length).toBe(LIMITS.size);
    expect(parseArtifact(at).findings).toEqual([]);
    expect(parseArtifact(encode(at)).findings).toEqual([]);
    const past = `${at}x`;
    expect(found(parseArtifact(past))).toEqual(['too-large']);
    expect(found(parseArtifact(encode(past)))).toEqual(['too-large']);
    // Counted in bytes, not characters: a quarter as many four-byte characters is as large.
    const wide = sized(LIMITS.size + 4, '🧪');
    expect(found(parseArtifact(wide))).toEqual(['too-large']);
  });

  test('a file too large is refused without reading its text', () => {
    const huge = `${HEADER}\n${'\n> '.repeat(10_000_000)}`;
    const { made, elapsed } = timed(() => parseArtifact(huge));
    expect(found(made)).toEqual(['too-large']);
    expect(made.tree.blocks).toEqual([]);
    expect(made.header?.pr).toBe(4797);
    expect(elapsed).toBeLessThan(500);
    const bytes = new Uint8Array(64 * 1024 * 1024).fill(0x61);
    const read = timed(() => parseArtifact(bytes));
    expect(found(read.made)).toEqual(['too-large', 'header-missing@1']);
    expect(read.elapsed).toBeLessThan(500);
  });

  test('bytes that are not UTF-8 are refused, at the line they are on', () => {
    const start = encode(overview('Fine.\n\nAlso fine.\n'));
    const cases: [string, number[]][] = [
      ['a stray continuation byte', [0x80]],
      ['an overlong slash', [0xc0, 0xaf]],
      ['an overlong NUL', [0xe0, 0x80, 0x80]],
      ['a surrogate', [0xed, 0xa0, 0x80]],
      ['past U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
      ['a cut-off character', [0xe2, 0x82]],
      ['an invalid byte', [0xff]],
    ];
    for (const [what, bad] of cases) {
      const bytes = new Uint8Array([...start, ...encode('Bad: '), ...bad, ...encode('\nAfter.\n')]);
      expect(found(parseArtifact(bytes)), `with ${what}`).toEqual(['encoding@14']);
    }
    // In the header too.
    const header = new Uint8Array([...encode('---\nformat: 1\npr: '), 0xff, ...encode('\n---\n')]);
    expect(found(parseArtifact(header))).toEqual([
      'commit-missing@1',
      'pr-invalid@3',
      'encoding@3',
    ]);
  });

  test('text with a lone surrogate is refused, at its line', () => {
    expect(found(parseArtifact(overview('One.\n\nTwo \ud800.\n')))).toEqual(['encoding@13']);
    expect(found(parseArtifact(overview('One.\r\n\r\nTwo \udfff.\n')))).toEqual(['encoding@13']);
    // A pair is a character.
    expect(parseArtifact(overview('Two 🧪.\n')).findings).toEqual([]);
  });

  test('a NUL in the text is shown as U+FFFD, as Markdown reads it', () => {
    const parsed = parseArtifact(overview('A\0B\n'));
    expect(parsed.findings).toEqual([]);
    expect(JSON.stringify(parsed.tree)).toContain('A\uFFFDB');
  });

  test('a long string is measured only until it is past the limit', () => {
    const huge = 'x'.repeat(100_000_000);
    // Read once first: a repeated string is built as it's first read, which takes time in
    // proportion to it whoever reads it.
    expect(huge.at(-1)).toBe('x');
    const { made, elapsed } = timed(() => utf8Length(huge, LIMITS.size + 1));
    expect(made).toBe(LIMITS.size + 1);
    expect(elapsed).toBeLessThan(50);
    expect(utf8Length('aé€🧪\ud800')).toBe(1 + 2 + 3 + 4 + 3);
  });
});
