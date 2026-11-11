/**
 * Overviews written to make the parse slow, deep or wrong: each is read within a few hundred
 * milliseconds at most, into a tree the walker passes, with findings that say what's wrong and
 * can't move a terminal's cursor.
 */

import { describe, expect, test } from 'vitest';

import { LIMITS, parseArtifact, type ParsedArtifact } from '../src/index.ts';
import { errors, found, overview, PREAMBLE_LINES, timed } from './support.ts';
import { problems } from './walker.ts';

const LINE = PREAMBLE_LINES + 1;

/**
 * How long any one may take, in milliseconds. Each takes under 100 ms on a laptop; a CI runner
 * is some five times slower, and three times that is the margin.
 */
const BUDGET = 1_500;

/** `text` parsed within budget, with what the parse must hold to whatever it's given. */
function hostile(text: string | Uint8Array): ParsedArtifact {
  const { made, elapsed } = timed(() => parseArtifact(text));
  expect(elapsed, `took ${elapsed} ms`).toBeLessThan(BUDGET);
  expect(problems(made.tree)).toEqual([]);
  expect(made.findings.length).toBeLessThanOrEqual(LIMITS.findings);
  for (const { message } of made.findings) {
    expect(message).not.toMatch(/[\p{Cc}\p{Cf}\u2028\u2029]/u);
  }
  expect(made.findings.map(({ code }) => code)).not.toContain('unreadable');
  return made;
}

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** As much of `piece`, over and over, as fits between `start` and `end` at the size limit. */
function filled(piece: string, start = overview(''), end = ''): string {
  const room = LIMITS.size - bytes(start) - bytes(end);
  return start + piece.repeat(Math.floor(room / bytes(piece))) + end;
}

describe('blocks', () => {
  test('10,000 blocks nested in each other', () => {
    const made = hostile(overview(`${':::fold F\n'.repeat(10_000)}x\n${':::\n'.repeat(10_000)}`));
    expect(errors(made)).toEqual(['too-deep', 'block-nesting']);
  });

  test('100,000 lines of colons are too large; as many as fit are read', () => {
    expect(found(hostile(overview(':::\n'.repeat(100_000))))).toEqual(['too-large']);
    const made = hostile(filled(':::\n'));
    expect(made.findings).toHaveLength(LIMITS.findings);
    expect(new Set(errors(made))).toEqual(new Set(['block-unopened']));
  });

  test('as many blocks as fit, never closed', () => {
    const made = hostile(filled(':::fold F\n'));
    expect(new Set(errors(made))).toEqual(new Set(['block-unclosed']));
  });

  test('as many blocks as fit, opened and closed in turn', () => {
    const made = hostile(filled(':::code a.ts#L1\n:::\n'));
    expect(new Set(errors(made))).toEqual(new Set(['target-count']));
  });

  test('as many blocks as fit, each in a list item of the one before', () => {
    let text = overview('');
    for (let depth = 0; text.length < LIMITS.size - 4_000; depth++) {
      text += `${'  '.repeat(depth)}- :::fold F\n`;
    }
    const made = hostile(text);
    expect(errors(made)).toContain('block-unclosed');
  });

  test('a walkthrough of as many steps as fit', () => {
    const made = hostile(
      filled(':::step a.ts#L1\nS.\n:::\n', overview(':::walkthrough W\n'), ':::\n'),
    );
    expect(new Set(errors(made))).toEqual(new Set(['walkthrough-steps', 'target-count']));
  });

  test('tabs of as many tabs as fit, and steps with no walkthrough', () => {
    const made = hostile(
      filled(':::tab T\nS.\n:::\n:::step a.ts#L1\nS.\n:::\n', overview(':::tabs\n'), ':::\n'),
    );
    // A step that's out of place is no target.
    expect(new Set(errors(made))).toEqual(
      new Set(['block-content', 'tabs-tabs', 'block-misplaced']),
    );
  });

  test('a 64 KiB argument, and a 200 KiB kind', () => {
    const argument = hostile(overview(`:::code ${'a'.repeat(65_536)}#L1\n:::\n`));
    expect(found(argument)).toEqual([`block-argument@${LINE}`]);
    const kind = hostile(overview(`:::${'k'.repeat(200_000)}\n:::\n`));
    expect(found(kind)).toEqual([`block-unknown@${LINE}`]);
    expect(kind.findings[0]?.message.length).toBeLessThan(100);
  });

  test('a fence of 200,000 colons', () => {
    const made = hostile(overview(`${':'.repeat(200_000)}\n`));
    expect(found(made)).toEqual([`block-unopened@${LINE}`]);
  });

  test('a figure of as many parts as fit', () => {
    const made = hostile(
      filled('- [p](#tldr)\n', overview(':::figure figures/a.svg\nA.\n\n'), ':::\n'),
    );
    // Every part but the first is linked twice, which fills the findings.
    expect(new Set(errors(made))).toEqual(new Set(['figure-part']));
  });
});

describe('Markdown', () => {
  test('as deep as fits, in quotes, lists and emphasis', () => {
    for (const piece of ['> ', '- + ', '1. ', '> - ']) {
      const made = hostile(filled(piece, overview(''), 'x\n'));
      expect(errors(made), `in ${piece}`).toEqual(['too-deep']);
    }
    hostile(filled('*a '));
    hostile(filled('**_'));
    hostile(filled('['));
    hostile(filled('[a]('));
    hostile(filled('<code:'));
  });

  test('as many links as fit, every kind', () => {
    for (const link of [
      '[a](code:a.ts#L1) ',
      '[a](term:a) ',
      '[a](#tldr) ',
      '[a](code:../a) ',
      '[a](javascript:a) ',
      '![a](https://example.com/a.png) ',
    ]) {
      const made = hostile(filled(link));
      expect(made.findings.length, `with ${link}`).toBeGreaterThan(0);
    }
  });

  test('a glossary of as many terms as fit', () => {
    const made = hostile(filled('- **t**: d\n', overview('## Glossary\n\n')));
    expect(new Set(errors(made))).toEqual(new Set(['term-twice']));
  });

  test('10,000 terms that aren’t defined', () => {
    const uses = Array.from({ length: 10_000 }, (_, n) => `[${n}](term:t${n})`).join(' ');
    const made = hostile(overview(`${uses}\n`));
    expect(new Set(errors(made))).toEqual(new Set(['term-undefined', 'target-count']));
  });

  test('raw HTML, as much as fits', () => {
    const made = hostile(filled('<div><script>alert(1)</script></div>\n\n'));
    expect(new Set(made.findings.map(({ code }) => code))).toEqual(new Set(['raw-html']));
  });
});

describe('odd text', () => {
  test('control, invisible and right-to-left characters are quoted harmlessly', () => {
    const made = hostile(
      overview(
        [
          ':::\u202Ecode a.ts#L1',
          ':::',
          ':::code \x1b]0;pwned\x07#L1',
          ':::',
          // Control characters end a link's address, unless it's inside < and >.
          '[a](<code:\u200B/\x1b[2J>)',
          '[b](<term:\u202E\x07>)',
          '[c](code:\x1b[2J)',
          '',
        ].join('\n'),
      ),
    );
    expect(errors(made)).toEqual(['block-unknown', 'target-path', 'target-path', 'target-term']);
  });

  test('a separator, a combining mark and a byte-order mark in the middle are text', () => {
    const made = hostile(overview('A\u2028B a\u0301 \uFEFFc [d](code:cafe\u0301.ts)\n'));
    expect(made.findings).toEqual([]);
    expect(made.references[0]?.target.path).toBe('cafe\u0301.ts');
  });

  test('every byte from 0 to 255, in the header, a fence, a block and a link', () => {
    const written = overview(':::code a.ts#L1\n:::\n[x](code:b.ts)\n');
    const places = [
      3,
      10,
      written.indexOf(':::'),
      written.indexOf('a.ts'),
      written.indexOf('b.ts'),
    ];
    let read = 0;
    for (let byte = 0; byte < 256; byte++) {
      for (const place of places) {
        const changed = new TextEncoder().encode(written);
        changed[place] = byte;
        hostile(changed);
        read += 1;
      }
    }
    expect(read).toBe(256 * places.length);
  });

  test('a header made of 4 KiB of one line, or of 1,000 keys', () => {
    expect(errors(hostile(`---\n${'k'.repeat(4_096)}: v\n---\n`))).toContain('header-unclosed');
    const made = hostile(`---\n${'format: 1\n'.repeat(1_000)}---\n`);
    expect(errors(made)).toContain('header-unclosed');
  });
});
