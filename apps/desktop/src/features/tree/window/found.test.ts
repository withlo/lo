import { describe, expect, it } from 'vitest';

import { FIND_LIMIT, type Changed, type Found, type TreePath } from '../contract.ts';
import {
  changesByKey,
  countText,
  enterAction,
  FOLDER_SHOWN,
  groupsOf,
  itemsOf,
  NAME_SHOWN,
  placeOf,
  plain,
  shorten,
  type Answer,
} from './found.ts';
import { keyOf } from './paths.ts';

const path = (text: string): TreePath => ({ text });

const found = (text: string, changed: boolean, matched: number[] = []): Found => ({
  path: path(text),
  changed,
  matched,
});

const answer = (files: Found[], total = files.length, query = 'x'): Answer => ({
  query,
  at: 'a'.repeat(40),
  found: files,
  total,
});

const change = (text: string, how: Changed['change']): Changed => ({
  path: path(text),
  change: how,
  previous: null,
  generated: null,
});

describe('shortening a path', () => {
  it('leaves a short text alone', () => {
    expect(shorten({ text: 'format.ts', marks: [0, 1] }, 20)).toEqual({
      text: 'format.ts',
      marks: [0, 1],
    });
  });

  it('cuts out the middle, keeps the marks at its ends and moves the later ones up', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const shown = shorten({ text, marks: [0, 2, 12, 24, 25] }, 10);
    // Three characters, an ellipsis, and the last six.
    expect(shown.text).toBe('abc…uvwxyz');
    expect(shown.text).toHaveLength(10);
    // The middle's mark goes; the end's move to where those letters now are.
    expect(shown.marks).toEqual([0, 2, 8, 9]);
    expect(shown.marks.map((mark) => shown.text[mark])).toEqual(['a', 'c', 'y', 'z']);
  });

  it('never cuts a character between its halves', () => {
    const shown = shorten({ text: `ab${'😀'.repeat(20)}`, marks: [] }, 10);
    expect(shown.text).toMatch(/^ab…?/u);
    expect(shown.text).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });

  it('takes out the characters that turn text around, and the marks on them', () => {
    const shown = plain({ text: 'a‮b⁦c', marks: [0, 1, 2, 3, 4] });
    expect(shown.text).toBe('abc');
    expect(shown.marks).toEqual([0, 1, 2]);
  });

  it('splits a path into its name and its folder, marking each', () => {
    const place = placeOf('packages/ratelimit/src/limits.ts', [23, 24, 25, 26, 27, 28, 9, 10]);
    expect(place.name).toEqual({ text: 'limits.ts', marks: [0, 1, 2, 3, 4, 5] });
    expect(place.folder).toEqual({ text: 'packages/ratelimit/src', marks: [9, 10] });
    expect(place.title).toBeUndefined();
  });

  it('shows a file in the root by its name alone', () => {
    const place = placeOf('README.md', [0]);
    expect(place.name).toEqual({ text: 'README.md', marks: [0] });
    expect(place.folder).toEqual({ text: '', marks: [] });
  });

  it('shows a path of any length shortened in the middle, whole in its tooltip, never dropped', () => {
    const folder = `${'deep/'.repeat(1_000)}end`;
    const name = `${'n'.repeat(5_000)}.ts`;
    const text = `${folder}/${name}`;
    const place = placeOf(text, [0, text.length - 1]);
    expect(place.name.text).toHaveLength(NAME_SHOWN);
    expect(place.name.text).toContain('…');
    expect(place.name.text.endsWith('.ts')).toBe(true);
    expect(place.folder.text).toHaveLength(FOLDER_SHOWN);
    expect(place.folder.text.endsWith('end')).toBe(true);
    // The folder's first letter and the name's last are marked, where they now are.
    expect(place.folder.marks).toEqual([0]);
    expect(place.name.marks).toEqual([NAME_SHOWN - 1]);
    expect(place.title?.length).toBeLessThan(text.length);
    expect(place.title).toContain('…');
  });
});

describe('the files the finder lists', () => {
  const changes = changesByKey([
    change('src/parser.ts', 'renamed'),
    change('src/legacy.ts', 'deleted'),
  ]);

  it('keeps the order main gave, the changed files first, with how each changed', () => {
    const items = itemsOf(
      answer([
        found('src/parser.ts', true, [4]),
        found('src/legacy.ts', true),
        found('README.md', false),
      ]),
      changes,
      new Map([['src/parser.ts', 'viewed' as const]]),
      false,
    );
    expect(items.map((item) => [item.id, item.changed, item.change, item.viewed])).toEqual([
      ['src/parser.ts', true, 'renamed', 'viewed'],
      ['src/legacy.ts', true, 'deleted', undefined],
      ['README.md', false, undefined, undefined],
    ]);
    expect(items[0]?.matched).toEqual([4]);
  });

  it('lists only the changed files when asked, which the answer holds first and whole', () => {
    const items = itemsOf(
      answer([found('src/parser.ts', true), found('README.md', false)]),
      changes,
      new Map(),
      true,
    );
    expect(items.map((item) => item.id)).toEqual(['src/parser.ts']);
  });

  it('lists nothing before main has answered', () => {
    expect(itemsOf(undefined, changes, new Map(), false)).toEqual([]);
  });

  it('knows a file by its key, never by a long path', () => {
    const long = `${'long/'.repeat(300)}file.ts`;
    const withDigest: TreePath = { text: long, digest: 'ab'.repeat(32) };
    const items = itemsOf(
      answer([{ path: withDigest, changed: true, matched: [] }]),
      changesByKey([{ ...change(long, 'added'), path: withDigest }]),
      new Map(),
      false,
    );
    expect(items[0]?.id).toBe(keyOf(withDigest));
    expect(items[0]?.id).toBe(`\0#${'ab'.repeat(32)}`);
    expect(items[0]?.change).toBe('added');
  });

  it('groups the changed files before the others, each counted', () => {
    const items = itemsOf(
      answer([found('a.ts', true), found('b.ts', true), found('c.ts', false)]),
      new Map(),
      new Map(),
      false,
    );
    expect(groupsOf(items, 'e2e').map((group) => [group.label, group.items.length])).toEqual([
      ['Changed in this pull request · 2', 2],
      ['Everywhere else in e2e · 1', 1],
    ]);
    expect(groupsOf([], 'e2e')).toEqual([]);
  });
});

describe('what the foot says', () => {
  it('says what ⏎ does on the highlighted file', () => {
    const [changed, other] = itemsOf(
      answer([found('a.ts', true), found('b.ts', false)]),
      new Map(),
      new Map(),
      false,
    );
    expect(enterAction(changed)).toBe('Show in the diff');
    expect(enterAction(other)).toBe('Show the whole file');
    expect(enterAction(undefined)).toBeUndefined();
  });

  it('counts the files listed of the repository’s, of the matches or of the changed files', () => {
    const some = answer([found('a.ts', true), found('b.ts', false)]);
    expect(countText(undefined, 0, 3_880, 5, false)).toBe('');
    expect(countText(some, 2, 3_880, 5, false)).toBe('2 of 3,880 files');
    expect(countText(some, 2, undefined, 5, false)).toBe('2 files');
    expect(countText(answer([found('a.ts', true)]), 1, undefined, 5, false)).toBe('1 file');
    expect(countText(some, 1, 3_880, 5, true)).toBe('1 of 5 changed files');
    expect(countText(some, 1, 3_880, undefined, true)).toBe('1 changed');
    const many = answer(
      Array.from({ length: FIND_LIMIT }, (_, at) => found(`f${at}.ts`, false)),
      1_234,
    );
    expect(countText(many, FIND_LIMIT, 3_880, 5, false)).toBe('100 of 1,234 matches');
    expect(countText({ ...many, query: '' }, FIND_LIMIT, 3_880, 5, false)).toBe(
      '100 of 1,234 files',
    );
  });
});
