// @vitest-environment jsdom
// The references panel's head and list: the word, how many of it there are, where each is with the
// word marked, the one on screen and the one the keyboard is on, and what shows when there are none.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render, rerender } from '../test/dom.ts';
import {
  around,
  ReferencesHead,
  ReferencesList,
  type ReferencesGroup,
  type ReferenceRow,
} from './References.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const WORD = 'RateLimitedError';

/** A reference to `WORD` in `text`, on `line`, the first time it appears. */
function row(key: string, line: number, text: string): ReferenceRow {
  const from = text.indexOf(WORD);
  return { key, line, text, match: { from, to: from + WORD.length } };
}

const GROUPS: ReferencesGroup[] = [
  {
    key: 'errors',
    path: 'graphql/errors.ts',
    rows: [
      row('errors-12', 12, 'export class RateLimitedError extends GraphQLError {'),
      row('errors-48', 48, '    if (error instanceof RateLimitedError) {'),
    ],
  },
  {
    key: 'rate-limit',
    path: 'graphql/plugins/rate-limit.ts',
    rows: [
      row('rl-3', 3, 'import { RateLimitedError } from "../errors";'),
      row('rl-36', 36, '          throw new RateLimitedError({ reason: "QUERY_TOO_EXPENSIVE" });'),
    ],
  },
  { key: 'none', path: 'docs/empty.md', rows: [] },
];

function options(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
}

describe('ReferencesHead', () => {
  it('says the word, how many references it has in how many files, and where they came from', () => {
    const host = render(
      <ReferencesHead
        name={WORD}
        count={14}
        files={6}
        source={{ kind: 'server', name: 'TypeScript' }}
        at="r5"
      />,
    );
    expect(host.textContent).toBe('RateLimitedError14 in 6 files · TypeScript, at r5');
  });

  it('counts one of each in the singular, and names the syntax index as it does elsewhere', () => {
    const host = render(
      <ReferencesHead name={WORD} count={1} files={1} source={{ kind: 'syntax' }} />,
    );
    expect(host.textContent).toBe('RateLimitedError1 in 1 file · Syntax index');
  });
});

describe('format characters', () => {
  it('shows them in a word a server named, and the revision, as code points', () => {
    const host = render(
      <ReferencesHead
        name={'evil\u202Elive'}
        count={2}
        files={1}
        source={{ kind: 'server', name: 'Type\u200BScript' }}
        at={'r\u202E5'}
      />,
    );
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/\p{Cf}/u);
    expect(text).toBe('evilU+202Elive2 in 1 file · TypeU+200BScript, at rU+202E5');
    expect(host.firstElementChild?.firstElementChild?.getAttribute('title')).toBe(
      'evil\u2039U+202E\u203Alive',
    );
  });

  it('shows them in a row’s text, and keeps the word marked where it is', () => {
    const text = 'x\u200By = RateLimitedError;\u2060';
    const host = render(
      <ReferencesList
        groups={[{ key: 'a', path: 'src/evil\u202Egnp.ts', rows: [row('a-1', 1, text)] }]}
      />,
    );
    const shown = options(host)[0]!;
    expect(shown.textContent).toBe('1xU+200By = RateLimitedError;U+2060');
    expect(shown.querySelector('mark')?.textContent).toBe(WORD);
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'src/evil\u2039U+202E\u203Agnp.ts',
    );
    expect(host.textContent).not.toMatch(/\p{Cf}/u);
    // Inside the word too: a name with a hidden character in it is another name.
    const inside = render(
      <ReferencesList
        groups={[
          {
            key: 'b',
            path: 'a.ts',
            rows: [{ key: 'b-1', line: 1, text: 'foo\u200Bbar', match: { from: 0, to: 7 } }],
          },
        ]}
      />,
    );
    expect(inside.querySelector('mark')?.textContent).toBe('fooU+200Bbar');
  });

  it('counts a row’s offsets as the text had them, and keeps a format character in its indentation', () => {
    expect(around(row('a', 1, '\u202E\u202E  x RateLimitedError y'))).toEqual({
      before: '\u202E\u202E  x ',
      word: WORD,
      after: ' y',
    });
    // The byte order mark is a character of the line, not space before it.
    expect(around(row('b', 1, '\uFEFF  RateLimitedError'))).toEqual({
      before: '\uFEFF  ',
      word: WORD,
      after: '',
    });
  });
});

describe('around', () => {
  it('splits a line around its word, and drops the indentation before it', () => {
    expect(around(row('a', 1, '    throw new RateLimitedError();'))).toEqual({
      before: 'throw new ',
      word: WORD,
      after: '();',
    });
  });

  it('starts a line a little before a word the row would cut off, and says so', () => {
    const text = `const padding = "${'x'.repeat(60)}"; throw new ${WORD}();`;
    const split = around(row('a', 1, text));
    expect(split.word).toBe(WORD);
    expect(split.after).toBe('();');
    expect(split.before.startsWith('…')).toBe(true);
    // A little context, not the whole line before it.
    expect(split.before.length).toBeLessThan(30);
    expect(split.before.endsWith('throw new ')).toBe(true);
  });

  it('starts where a word starts, not in the middle of one', () => {
    expect(around(row('a', 1, 'if (error instanceof RateLimitedError) {'))).toEqual({
      before: '…instanceof ',
      word: WORD,
      after: ') {',
    });
  });

  it('leaves a word near the start where it is', () => {
    const split = around(row('a', 1, `throw new ${WORD}("a string that runs on and on and on");`));
    expect(split.before).toBe('throw new ');
  });

  it('holds a match that runs past its text, or backwards, to what the text has', () => {
    expect(around({ text: 'abc', match: { from: 1, to: 99 } })).toEqual({
      before: 'a',
      word: 'bc',
      after: '',
    });
    expect(around({ text: 'abc', match: { from: 9, to: 12 } })).toEqual({
      before: 'abc',
      word: '',
      after: '',
    });
    expect(around({ text: 'abc', match: { from: 2, to: 1 } }).word).toBe('');
  });
});

/** The list as the panel shows it, with the message it keeps when it has no reference to list. */
function panel(groups: ReferencesGroup[]) {
  return (
    <ReferencesList
      groups={groups}
      focused="rl-3"
      empty="No references of RateLimitedError found."
    />
  );
}

describe('ReferencesList', () => {
  it('groups the references by file with each file’s count, a file with none leaving no group', () => {
    const host = render(<ReferencesList groups={GROUPS} />);
    const groups = [...host.querySelectorAll('[role="group"]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'graphql/errors.ts',
      'graphql/plugins/rate-limit.ts',
    ]);
    expect(
      groups.map((group) => group.querySelector('[role="presentation"]')?.textContent),
    ).toEqual(['graphql/errors.ts2', 'graphql/plugins/rate-limit.ts2']);
    expect(options(host).map((each) => each.dataset['key'])).toEqual([
      'errors-12',
      'errors-48',
      'rl-3',
      'rl-36',
    ]);
  });

  it('shows each reference’s line and text, with the word marked and the indentation gone', () => {
    const host = render(<ReferencesList groups={GROUPS} />);
    const [first, second, , fourth] = options(host);
    expect(first?.textContent).toBe('12export class RateLimitedError extends GraphQLError {');
    // A word that a row would cut off starts the row a little before it.
    expect(second?.textContent).toBe('48…instanceof RateLimitedError) {');
    expect(fourth?.textContent?.startsWith('36throw new RateLimitedError(')).toBe(true);
    for (const each of options(host)) {
      expect(each.querySelector('mark')?.textContent).toBe(WORD);
    }
  });

  it('marks the reference on screen and the one the keyboard is on, apart', () => {
    const host = render(<ReferencesList groups={GROUPS} current="rl-3" focused="rl-36" />);
    const rows = options(host);
    expect(rows.map((each) => each.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'true',
      null,
    ]);
    expect(rows.map((each) => each.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'false',
      'true',
    ]);
    const list = host.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('References');
    expect(list?.getAttribute('aria-activedescendant')).toBe(rows[3]?.id);
    expect(rows[2]?.className).toContain('bg-current-strong');
    expect(rows[3]?.className).toContain('group-focus-visible/list:shadow-ring-inset');
    expect(new Set(rows.map((each) => each.id)).size).toBe(4);
  });

  it('names no active descendant when the keyboard is on nothing it lists', () => {
    const host = render(<ReferencesList groups={GROUPS} focused="gone" />);
    expect(host.querySelector('[role="listbox"]')?.hasAttribute('aria-activedescendant')).toBe(
      false,
    );
  });

  it('goes to a reference when its row is clicked', () => {
    const onGo = vi.fn<(key: string) => void>();
    const host = render(<ReferencesList groups={GROUPS} onGo={onGo} />);
    click(options(host)[1]!);
    expect(onGo).toHaveBeenCalledWith('errors-48');
  });

  it('is one tab stop, the list, with the caller’s scope and its ref', () => {
    let held: HTMLDivElement | null = null;
    const host = render(
      <ReferencesList
        groups={GROUPS}
        listRef={(element) => {
          held = element;
        }}
        data-lo-scope="references"
      />,
    );
    const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(held).toBe(list);
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.getAttribute('data-lo-scope')).toBe('references');
    expect(options(host).every((each) => !each.hasAttribute('tabindex'))).toBe(true);
  });

  it('keeps its focusable element, with the message in it, when no reference is left to list', () => {
    const host = render(panel(GROUPS));
    const before = host.querySelector<HTMLElement>('[role="listbox"]')!;
    focus(before);
    expect(document.activeElement).toBe(before);

    rerender(host, panel([]));
    const after = host.querySelector<HTMLElement>('[aria-label="References"]')!;
    expect(after).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(after.getAttribute('role')).toBe('group');
    expect(after.textContent).toBe('No references of RateLimitedError found.');
    expect(after.hasAttribute('aria-activedescendant')).toBe(false);
    expect(host.querySelector('[role="option"]')).toBeNull();

    rerender(host, panel(GROUPS));
    expect(host.querySelector('[aria-label="References"]')).toBe(before);
    expect(before.getAttribute('role')).toBe('listbox');
    expect(document.activeElement).toBe(before);
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <ReferencesHead
          name={WORD}
          count={4}
          files={2}
          source={{ kind: 'server', name: 'TypeScript' }}
          at="r5"
        />
        <ReferencesList groups={GROUPS} current="rl-3" focused="rl-36" />
      </>,
    );
    expect(await missingRules(host, ['group-focus-visible/list:shadow-ring-inset'])).toEqual([]);
  });
});
