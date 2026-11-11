import { describe, expect, test } from 'vitest';

import { collect, errors, found, overview, PREAMBLE_LINES } from '../test/support.ts';
import { problems } from '../test/walker.ts';
import {
  LIMITS,
  parseArtifact,
  readCode,
  readFigure,
  readPath,
  readTerm,
  termKey,
} from './index.ts';

const LINE = PREAMBLE_LINES + 1;

describe('paths', () => {
  test('a plain path from the repository root is kept exactly as written', () => {
    const kept = [
      'src/cache.ts',
      'a',
      '.github/workflows/ci.yml',
      'docs/read me.md',
      // Percent escapes are never decoded: this is a folder named "%2e%2e".
      '%2e%2e/etc/passwd',
      // Nor is Unicode normalized: NFD stays NFD, and names only the file written so.
      'cafe\u0301.ts',
      'café.ts',
      // A colon is an ordinary character in a path.
      'javascript:alert(1)',
      'C:',
      '.gitignore',
      'a/.github/b',
      '...',
    ];
    expect(kept.map((path) => readPath(path))).toEqual(kept.map((value) => ({ ok: true, value })));
  });

  test.each([
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['up a folder', '../secret'],
    ['up inside', 'src/../../secret'],
    ['up after figures', 'figures/../artifact.md'],
    ['a dot', './src/a.ts'],
    ['an empty part', 'src//a.ts'],
    ['a trailing slash', 'src/'],
    ['into .git', '.git/config'],
    ['into .git, in capitals', '.GIT/config'],
    ['into a nested .git', 'vendor/.Git/HEAD'],
    ['a backslash', 'C:\\Windows\\system32'],
    ['a backslash up', '..\\secret'],
    ['a NUL', 'src/a\0.ts'],
    ['a newline', 'src/a\n.ts'],
    ['an escape', 'src/\x1b[31ma.ts'],
    ['DEL', 'src/a\x7f.ts'],
    ['a C1 control', 'src/a\x85.ts'],
  ])('a path %s is refused', (_what, path) => {
    const read = readPath(path);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.code).toBe('target-path');
      // What it quotes can't move a terminal's cursor.
      expect(read.message).not.toMatch(/\p{Cc}/u);
    }
  });
});

describe('lines', () => {
  test('one line, or a range, counting from 1', () => {
    expect(readCode('a.ts#L12', 'range')).toEqual({
      ok: true,
      value: { kind: 'code', path: 'a.ts', lines: { start: 12, end: 12 } },
    });
    expect(readCode('a.ts#L12-L44', 'range')).toEqual({
      ok: true,
      value: { kind: 'code', path: 'a.ts', lines: { start: 12, end: 44 } },
    });
    expect(readCode('a.ts#L5-L5', 'range').ok).toBe(true);
    expect(readCode('a.ts#L999999999', 'range').ok).toBe(true);
  });

  test('the last # starts the lines', () => {
    expect(readCode('src/c#/a.cs#L3', 'range')).toEqual({
      ok: true,
      value: { kind: 'code', path: 'src/c#/a.cs', lines: { start: 3, end: 3 } },
    });
  });

  test.each([
    ['line 0', 'a.ts#L0'],
    ['a range from 0', 'a.ts#L0-L3'],
    ['a range backwards', 'a.ts#L5-L3'],
    ['thirty digits', `a.ts#L${'9'.repeat(30)}`],
    ['ten digits', 'a.ts#L1000000000'],
    ['a leading zero', 'a.ts#L012'],
    ['no L', 'a.ts#12'],
    ['a lower-case l', 'a.ts#l12'],
    ['GitHub columns', 'a.ts#L12C3'],
    ['a range without its second L', 'a.ts#L12-44'],
    ['a negative line', 'a.ts#L-3'],
    ['an empty fragment', 'a.ts#'],
    ['a name', 'a.ts#main'],
    ['spaces', 'a.ts#L1 - L2'],
  ])('%s is refused', (_what, target) => {
    const read = readCode(target, 'any');
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.code).toBe('target-lines');
  });

  test('a block shows at most 200 lines, and a link may name more, or the whole file', () => {
    expect(readCode('a.ts#L1-L200', 'range').ok).toBe(true);
    expect(readCode('a.ts#L1-L201', 'range')).toMatchObject({ ok: false, code: 'target-lines' });
    expect(readCode('a.ts#L1-L201', 'any').ok).toBe(true);
    expect(readCode('a.ts', 'range')).toMatchObject({ ok: false, code: 'target-lines' });
    expect(readCode('a.ts', 'any')).toEqual({ ok: true, value: { kind: 'code', path: 'a.ts' } });
  });

  test('a target is at most 1,024 bytes', () => {
    const at = `${'a'.repeat(LIMITS.argument - 4)}#L1`;
    expect(new TextEncoder().encode(at).length).toBe(LIMITS.argument - 1);
    expect(readCode(at, 'range').ok).toBe(true);
    expect(readCode(`é${at}`, 'range').ok).toBe(false);
    expect(readCode(`${'a/'.repeat(40_000)}a#L1`, 'range').ok).toBe(false);
  });
});

describe('terms', () => {
  test('a term goes by its name in lower case, with each run of spaces as one', () => {
    expect(termKey('  Hash \t\n Map ')).toBe('hash map');
    expect(readTerm('Bucket')).toEqual({ ok: true, value: { kind: 'term', key: 'bucket' } });
    expect(readTerm('__proto__')).toEqual({ ok: true, value: { kind: 'term', key: '__proto__' } });
  });

  test.each([
    ['empty', ''],
    ['only spaces', ' \t '],
    ['a control character', 'a\x1bb'],
    ['too long', 'a'.repeat(LIMITS.argument + 1)],
  ])('a term %s is refused', (_what, name) => {
    expect(readTerm(name)).toMatchObject({ ok: false, code: 'target-term' });
  });
});

describe('figures', () => {
  test('a figure sits directly in figures/, with a known ending', () => {
    for (const path of [
      'figures/flow.svg',
      'figures/a.b.png',
      'figures/shot 1.jpeg',
      'figures/x.webp',
    ]) {
      expect(readFigure(path), path).toEqual({ ok: true, value: path });
    }
  });

  test.each([
    ['outside figures/', 'flow.svg'],
    ['in a folder in figures/', 'figures/a/flow.svg'],
    ['with no ending', 'figures/flow'],
    ['with only an ending', 'figures/.svg'],
    ['of another type', 'figures/flow.pdf'],
    ['in capitals', 'figures/flow.SVG'],
    ['leaving figures/', 'figures/../artifact.md'],
    ['absolute', '/figures/flow.svg'],
    ['the folder', 'figures/'],
  ])('a figure %s is refused', (_what, path) => {
    expect(readFigure(path)).toMatchObject({ ok: false, code: 'figure-path' });
  });
});

describe('links', () => {
  test('code and term links are the format’s targets', () => {
    const parsed = parseArtifact(
      overview(
        [
          'See [the cache](code:src/cache.ts#L3-L9), [all of it](code:src/cache.ts),',
          '[read me](<code:docs/read me.md>) and [a bucket](term:Bucket).',
          '',
          '## Glossary',
          '',
          '- **Bucket**: what a tenant spends.',
          '',
        ].join('\n'),
      ),
    );
    expect(parsed.findings).toEqual([]);
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'code', path: 'src/cache.ts', lines: { start: 3, end: 9 } },
      { kind: 'code', path: 'src/cache.ts' },
      { kind: 'code', path: 'docs/read me.md' },
      { kind: 'term', key: 'bucket' },
    ]);
    expect(parsed.references).toEqual([
      {
        target: { kind: 'code', path: 'src/cache.ts', lines: { start: 3, end: 9 } },
        line: LINE,
        from: 'link',
      },
      { target: { kind: 'code', path: 'src/cache.ts' }, line: LINE, from: 'link' },
      { target: { kind: 'code', path: 'docs/read me.md' }, line: LINE + 1, from: 'link' },
    ]);
    expect(problems(parsed.tree, { counts: true })).toEqual([]);
  });

  test('a link to an invalid target is an error, at its own line, and shows as its text', () => {
    const parsed = parseArtifact(
      overview(
        [
          'First [up](code:../secret),',
          'then [git](code:.git/config), [zero](code:a.ts#L0)',
          'and [nothing](term:).',
          '',
          'A `multi',
          'line` span, then [abs](code:/etc/passwd).',
          '',
        ].join('\n'),
      ),
    );
    expect(found(parsed)).toEqual([
      `target-path@${LINE}`,
      `target-path@${LINE + 1}`,
      `target-lines@${LINE + 1}`,
      `target-term@${LINE + 2}`,
      // A code span's newline isn't kept, so the line is the span's start.
      `target-path@${LINE + 4}`,
    ]);
    expect(collect(parsed, 'link')).toEqual([]);
    expect(parsed.references).toEqual([]);
    expect(problems(parsed.tree)).toEqual([]);
  });

  test('escapes and entities are read before the target is', () => {
    const parsed = parseArtifact(
      overview('[a](code:&#46;&#46;/x) [b](code:\\.\\./y) [c](code:%2e%2e/z)\n'),
    );
    expect(found(parsed)).toEqual([`target-path@${LINE}`, `target-path@${LINE}`]);
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'code', path: '%2e%2e/z' },
    ]);
  });

  test.each([
    ['javascript:alert(1)'],
    ['JAVASCRIPT:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['lo-app://window/index.html'],
    ['file:///etc/passwd'],
    ['vbscript:x'],
    ['src/cache.ts'],
    ['Code:src/a.ts'],
    ['//evil.example/'],
  ])('a link to %s shows as its text, with a warning', (href) => {
    const parsed = parseArtifact(overview(`[it](${href})\n`));
    expect(found(parsed)).toEqual([`dead-link@${LINE}`]);
    expect(collect(parsed, 'link')).toEqual([]);
    expect(errors(parsed)).toEqual([]);
  });

  test('code:javascript: is a path, never an address', () => {
    const parsed = parseArtifact(overview('[it](code:javascript:alert(1))\n'));
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'code', path: 'javascript:alert(1)' },
    ]);
  });

  test('an autolink and a reference link are links like any other', () => {
    const parsed = parseArtifact(
      overview('<code:src/a.ts#L2> and [b][ref].\n\n[ref]: code:src/b.ts\n'),
    );
    expect(parsed.references.map(({ target }) => target.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('a section link goes to a heading that is there', () => {
    const parsed = parseArtifact(
      overview('## How it works\n\nSee [above](#how-it-works) and [gone](#nowhere).\n'),
    );
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'anchor', name: 'how-it-works' },
    ]);
    expect(found(parsed)).toEqual([`dead-link@${LINE + 2}`]);
  });

  test('a term written with spaces or in capitals is the same term', () => {
    const parsed = parseArtifact(
      overview(
        '[a](<term:Hash  Map>) [b](term:HASH%20MAP)\n\n## Glossary\n\n- **hash map**: a map.\n',
      ),
    );
    expect(collect(parsed, 'link').map(({ target }) => target)).toEqual([
      { kind: 'term', key: 'hash map' },
      // Never percent-decoded: this is another term, which isn't defined.
      { kind: 'term', key: 'hash%20map' },
    ]);
    expect(found(parsed)).toEqual([`term-undefined@${LINE}`]);
  });
});
