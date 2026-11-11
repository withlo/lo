import { describe, expect, test } from 'vitest';

import { COMMIT, found, HEADER } from '../test/support.ts';
import { parseArtifact } from './index.ts';

const BODY = '\n## tl;dr\n\nIt changes things.\n';

/** An overview whose header holds `lines`. */
function headed(...lines: string[]): string {
  return `---\n${lines.join('\n')}\n---\n${BODY}`;
}

const SHA256 = 'c'.repeat(64);

describe('the header', () => {
  test('holds the format, the pull request and the commit, in any order', () => {
    const parsed = parseArtifact(headed(`commit: ${COMMIT}`, 'pr: 4797', 'format: 1'));
    expect(parsed.header).toEqual({ format: 1, pr: 4797, commit: COMMIT });
    expect(parsed.format).toBe(1);
    expect(parsed.findings).toEqual([]);
  });

  test('takes a SHA-256 commit, and spaces around a value', () => {
    const parsed = parseArtifact(headed('format:1', 'pr:   12  ', `commit:\t${SHA256} `));
    expect(parsed.header).toEqual({ format: 1, pr: 12, commit: SHA256 });
  });

  test('is blanked, so the lines after it keep their numbers', () => {
    const parsed = parseArtifact(`${HEADER}\n## tl;dr\n\nSee [x](code:a.ts#L1).\n`);
    expect(parsed.references.map(({ line }) => line)).toEqual([9]);
    // Its lines are never Markdown: no rule from its `---`, no paragraph from its keys.
    expect(parsed.tree.blocks.map(({ kind }) => kind)).toEqual(['heading', 'paragraph']);
  });

  test('a byte-order mark and CRLF line endings change nothing', () => {
    const crlf = `\uFEFF${HEADER}${BODY}`.replaceAll('\n', '\r\n');
    const parsed = parseArtifact(crlf);
    expect(parsed.header).toEqual({ format: 1, pr: 4797, commit: COMMIT });
    expect(parsed.findings).toEqual([]);
    const bytes = new TextEncoder().encode(crlf);
    expect(bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(parseArtifact(bytes)).toEqual(parsed);
    // Lone carriage returns end lines too, as Markdown reads them.
    expect(parseArtifact(`${HEADER}${BODY}`.replaceAll('\n', '\r')).findings).toEqual([]);
  });

  test('a header that is missing, or never closes, is reported', () => {
    expect(found(parseArtifact(BODY.trimStart()))).toEqual(['header-missing@1']);
    expect(found(parseArtifact(` ${HEADER}${BODY}`))).toEqual([
      'header-missing@1',
      // What looked like a header is read as the text: a rule, then a heading.
      'tldr-first@1',
    ]);
    const unclosed = parseArtifact(`---\nformat: 1\npr: 4797\ncommit: ${COMMIT}\n${BODY}`);
    expect(found(unclosed)).toEqual(['header-unclosed@1']);
    // Where it ends is unknown, so nothing after it is read.
    expect(unclosed.tree.blocks).toEqual([]);
    expect(unclosed.header).toBeUndefined();
  });

  test('a closing line far past the start is no closing line', () => {
    const far = `---\nformat: 1\n${'x: y\n'.repeat(1_000)}---\n${BODY}`;
    expect(found(parseArtifact(far))).toEqual(['header-unclosed@1']);
  });

  test('missing or doubled keys are reported, each where it is', () => {
    expect(found(parseArtifact(headed('pr: 4797', `commit: ${COMMIT}`)))).toEqual([
      'format-missing@1',
    ]);
    expect(found(parseArtifact(headed('format: 1', `commit: ${COMMIT}`)))).toEqual([
      'pr-missing@1',
    ]);
    expect(found(parseArtifact(headed('format: 1', 'pr: 4797')))).toEqual(['commit-missing@1']);
    expect(
      found(parseArtifact(headed('format: 1', 'pr: 4797', 'pr: 4797', `commit: ${COMMIT}`))),
    ).toEqual(['header-twice@4']);
    expect(found(parseArtifact(`---\n---\n${BODY}`))).toEqual([
      'format-missing@1',
      'pr-missing@1',
      'commit-missing@1',
    ]);
  });

  test('anything else in it is reported', () => {
    const parsed = parseArtifact(
      headed('format: 1', '', 'pr: 4797', 'title: Mine', `commit: ${COMMIT}`, '# note', 'PR: 1'),
    );
    expect(found(parsed)).toEqual([
      'header-line@3',
      'header-key@5',
      'header-line@7',
      'header-line@8',
    ]);
    expect(parsed.header).toBeUndefined();
  });

  test.each([
    ['a leading zero', '01'],
    ['a decimal point', '1.0'],
    ['a sign', '-1'],
    ['a plus', '+1'],
    ['thirty digits', '1'.repeat(30)],
    ['zero', '0'],
    ['a word', 'one'],
    ['a YAML anchor', '&a 1'],
    ['a YAML alias', '*a'],
    ['a YAML tag', '!!int 1'],
    ['quotes', '"1"'],
    ['nothing', ''],
  ])('a format with %s is invalid', (_what, value) => {
    expect(
      found(parseArtifact(headed(`format: ${value}`, 'pr: 4797', `commit: ${COMMIT}`))),
    ).toEqual(['format-invalid@2']);
  });

  test.each([
    ['a leading zero', '04797'],
    ['a sign', '-4797'],
    ['a fraction', '4797.5'],
    ['eleven digits', '12345678901'],
    ['more than GitHub gives', '2147483648'],
    ['a hash', '#4797'],
    ['a YAML tag', '!!int 4797'],
  ])('a pr with %s is invalid', (_what, value) => {
    expect(found(parseArtifact(headed('format: 1', `pr: ${value}`, `commit: ${COMMIT}`)))).toEqual([
      'pr-invalid@3',
    ]);
  });

  test.each([
    ['a short id', COMMIT.slice(0, 12)],
    ['39 digits', COMMIT.slice(1)],
    ['41 digits', `${COMMIT}0`],
    ['capitals', COMMIT.toUpperCase()],
    ['a leading -', `-${COMMIT.slice(1)}`],
    ['an option', '--upload-pack=touch'],
    ['a ref', 'refs/heads/main'],
    ['a revision', 'HEAD~1'],
    ['a YAML anchor', `&a ${COMMIT}`],
    ['a NUL', `${COMMIT.slice(1)}\0`],
  ])('a commit with %s is invalid', (_what, value) => {
    expect(found(parseArtifact(headed('format: 1', 'pr: 4797', `commit: ${value}`)))).toEqual([
      'commit-invalid@4',
    ]);
  });

  test('the largest pull request number GitHub gives is taken', () => {
    const parsed = parseArtifact(headed('format: 1', 'pr: 2147483647', `commit: ${COMMIT}`));
    expect(parsed.header?.pr).toBe(2_147_483_647);
  });
});

describe('versions', () => {
  test('a newer format is all that is read', () => {
    const parsed = parseArtifact(`---\nformat: 2\nsomething: new\n---\n:::chart x\n`);
    expect(parsed.format).toBe(2);
    expect(parsed.header).toBeUndefined();
    expect(parsed.tree.blocks).toEqual([]);
    expect(found(parsed)).toEqual(['format-newer@2']);
    expect(parsed.findings[0]?.message).toBe(
      "It's written in format 2, and this version of Lo reads format 1.",
    );
  });

  test('a newer format wins over the size limit, which a newer format may change', () => {
    const parsed = parseArtifact(`---\nformat: 3\n---\n${'x'.repeat(300_000)}`);
    expect(found(parsed)).toEqual(['format-newer@2']);
  });

  test('a format given twice is invalid, whatever the numbers', () => {
    const parsed = parseArtifact(headed('format: 2', 'format: 1', 'pr: 4797', `commit: ${COMMIT}`));
    expect(found(parsed)).toEqual(['header-twice@3']);
    expect(parsed.format).toBe(2);
  });

  test('the largest format number is read without losing a digit', () => {
    expect(parseArtifact(headed('format: 999999999')).format).toBe(999_999_999);
  });
});
