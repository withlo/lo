// @vitest-environment jsdom
// The peek's frame: its head, the list of answers with where each came from, the one shown, the
// code it holds, and the keys it points to. It draws no keys of its own, so these check what it says
// and what it asks for.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render, rerender } from '../test/dom.ts';
import { Peek, PeekHead, type PeekCandidate, type PeekKeys } from './Peek.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const CANDIDATES: PeekCandidate[] = [
  {
    key: 'estimate',
    path: 'graphql/cost/estimate.ts',
    line: 18,
    source: { kind: 'server', name: 'TypeScript' },
  },
  {
    key: 'cost',
    path: 'ratelimit/src/cost.ts',
    line: 41,
    source: { kind: 'server', name: 'TypeScript' },
    note: 'overload',
  },
  {
    key: 'helpers',
    path: 'test/helpers/cost.ts',
    line: 7,
    source: { kind: 'server', name: 'TypeScript' },
    note: 'overload',
  },
];

/** What the syntax index answers when no server did: the asking file's import, then its own finds. */
const SYNTAX: PeekCandidate[] = [
  {
    key: 'import',
    path: 'graphql/cost/estimate.ts',
    line: 3,
    source: { kind: 'syntax' },
    from: 'zod',
  },
  {
    key: 'same',
    path: 'test/helpers/cost.ts',
    line: 7,
    source: { kind: 'syntax' },
    note: 'same name',
  },
  { key: 'outside', outside: true, source: { kind: 'syntax' } },
];

const KEYS: PeekKeys = {
  move: ['j', 'k'],
  go: ['⏎'],
  references: ['g', 'r'],
  back: ['⌃o'],
  close: ['Esc'],
};

function options(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** CSS on one line, its runs of space as one space. */
function squash(css: string): string {
  return css.replace(/\s+/g, ' ');
}

describe('Peek', () => {
  it('says what was asked and how many answers there are, at the revision they were read', () => {
    const host = render(
      <Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" at="r5" keys={KEYS}>
        <pre>code</pre>
      </Peek>,
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Definitions of estimateCost');
    expect(dialog?.textContent).toContain('estimateCost · 3 definitions');
    expect(dialog?.textContent).toContain('at r5');
    // The code is the child's, in its own place between the list and the foot.
    expect(host.querySelector('pre')?.textContent).toBe('code');
  });

  it('lists each answer with its path, its line and where it came from', () => {
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" />);
    const rows = options(host);
    expect(rows.map((row) => row.dataset['key'])).toEqual(['estimate', 'cost', 'helpers']);
    expect(rows[0]?.textContent).toBe('graphql/cost/estimate.ts18TypeScript');
    expect(rows[1]?.textContent).toBe('ratelimit/src/cost.ts41TypeScript · overload');
    expect(rows[2]?.textContent).toBe('test/helpers/cost.ts7TypeScript · overload');
    // The file's name stands out from the folders before it.
    expect(rows[0]?.querySelector('b, .font-semibold')?.textContent).toBe('estimate.ts');
  });

  it('shows the answer picked, and says so as the list’s active descendant', () => {
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="cost" />);
    const rows = options(host);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    const list = host.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('Candidates');
    expect(list?.getAttribute('aria-activedescendant')).toBe(rows[1]?.id);
    expect(rows[1]?.className).toContain('bg-current-strong');
    expect(rows[0]?.className).not.toContain('bg-current-strong');
    // Every option has an id of its own, for the active descendant to name.
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.every((row) => row.id !== '')).toBe(true);

    // The pick moves, and the active descendant with it.
    rerender(
      host,
      <Peek name="estimateCost" candidates={CANDIDATES} selected="helpers">
        <pre>other</pre>
      </Peek>,
    );
    expect(host.querySelector('[role="listbox"]')?.getAttribute('aria-activedescendant')).toBe(
      options(host)[2]?.id,
    );
    expect(host.querySelector('pre')?.textContent).toBe('other');
  });

  it('is one tab stop, the list, and hands it to the caller to focus', () => {
    let held: HTMLDivElement | null = null;
    const host = render(
      <Peek
        name="estimateCost"
        candidates={CANDIDATES}
        selected="estimate"
        listRef={(element) => {
          held = element;
        }}
        data-lo-scope="peek"
      />,
    );
    const list = host.querySelector<HTMLElement>('[role="listbox"]')!;
    expect(held).toBe(list);
    expect(list.getAttribute('tabindex')).toBe('0');
    focus(list);
    expect(document.activeElement).toBe(list);
    // Its keys' scope is on the frame, which holds the list, so the registry finds it from there.
    expect(list.closest('[data-lo-scope]')?.getAttribute('data-lo-scope')).toBe('peek');
    // Nothing but the list and the buttons is tabbable: the options are its descendants.
    expect(options(host).every((row) => !row.hasAttribute('tabindex'))).toBe(true);
  });

  it('shows one answer on its own row, with no candidates to pick between', () => {
    const [only] = CANDIDATES;
    const host = render(
      <Peek name="estimateCost" candidates={[only!]} selected="estimate" keys={KEYS} />,
    );
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('estimateCost · 1 definition');
    expect(dialog?.textContent).not.toContain('definitions');
    expect(host.querySelector('.peek')?.classList.contains('peek-single')).toBe(true);
    expect(options(host)).toHaveLength(1);
    // There's nothing for `j` and `k` to pick, so the foot doesn't offer them.
    expect(dialog?.textContent).not.toContain('Candidate');
    expect(dialog?.textContent).toContain('References');
  });

  it('points to the keys it was given, and to none it wasn’t', () => {
    const host = render(
      <Peek
        name="estimateCost"
        candidates={CANDIDATES}
        selected="estimate"
        meta="src/graphql/cost/estimate.ts · r5 · added in this PR"
        keys={KEYS}
      />,
    );
    const text = host.textContent ?? '';
    expect(text).toContain('src/graphql/cost/estimate.ts · r5 · added in this PR');
    const hints = [...host.querySelectorAll('kbd')].map((key) => key.textContent);
    expect(hints).toEqual(['⏎', 'j', 'k', 'g', 'r', '⌃o']);
    expect(text).toContain('Open the whole file');
    for (const word of ['Candidate', 'References', 'Back']) expect(text).toContain(word);
    const close = [...host.querySelectorAll('button')].at(-1);
    expect(close?.getAttribute('aria-label')).toBe('Close (Esc)');

    const bare = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" />);
    expect(bare.querySelectorAll('kbd')).toHaveLength(0);
    expect(bare.textContent).not.toContain('Candidate');
    expect([...bare.querySelectorAll('button')].at(-1)?.getAttribute('aria-label')).toBe('Close');
  });

  it('asks for what a click on its parts means, and nothing it wasn’t asked to do', () => {
    const onPick = vi.fn<(key: string) => void>();
    const onGo = vi.fn<() => void>();
    const onClose = vi.fn<() => void>();
    const host = render(
      <Peek
        name="estimateCost"
        candidates={CANDIDATES}
        selected="estimate"
        keys={KEYS}
        goLabel="Show in the diff"
        onPick={onPick}
        onGo={onGo}
        onClose={onClose}
      />,
    );
    click(options(host)[2]!);
    expect(onPick).toHaveBeenCalledWith('helpers');
    const buttons = [...host.querySelectorAll('button')];
    const go = buttons.find((button) => button.textContent?.startsWith('Show in the diff'));
    expect(go).toBeDefined();
    click(go!);
    expect(onGo).toHaveBeenCalledTimes(1);
    click(buttons.at(-1)!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('names the syntax index’s answers the same wherever they sit, and says what a server was not asked', () => {
    const host = render(<Peek name="estimateCost" candidates={SYNTAX} selected="import" />);
    const rows = options(host);
    expect(rows[0]?.textContent).toBe(
      "graphql/cost/estimate.ts3Syntax index · From zod, which Lo doesn't install",
    );
    expect(rows[1]?.textContent).toBe('test/helpers/cost.ts7Syntax index · same name');
  });

  it('shows an answer outside the repository as that, with no path, nothing to go to and no code', () => {
    const onGo = vi.fn<() => void>();
    const host = render(
      <Peek name="estimateCost" candidates={SYNTAX} selected="outside" keys={KEYS} onGo={onGo} />,
    );
    const outside = options(host)[2]!;
    expect(outside.textContent).toBe('Outside this repositorySyntax index');
    // No path or line to read, and `aria-selected` says it is the one on.
    expect(outside.getAttribute('aria-selected')).toBe('true');
    expect(outside.querySelector('.font-semibold')).toBeNull();
    // Lo reads nothing there, so the peek says so where the code would be.
    expect(host.textContent).toContain("Lo doesn't read files outside this repository.");
    const go = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Open the whole file'),
    )!;
    expect(go.disabled).toBe(true);
    click(go);
    expect(onGo).not.toHaveBeenCalled();
    // Another answer shown, and the button is back.
    rerender(host, <Peek name="estimateCost" candidates={SYNTAX} selected="import" keys={KEYS} />);
    expect(
      [...host.querySelectorAll('button')].find((button) =>
        button.textContent?.startsWith('Open the whole file'),
      )?.disabled,
    ).toBe(false);
    expect(host.textContent).not.toContain("Lo doesn't read files");
  });

  it('shows each format character in what a server or a repository wrote as its code point', () => {
    const host = render(
      <Peek
        name={'evil\u202Elive'}
        candidates={[
          {
            key: 'a',
            path: 'src/evil\u202Egnp.ts',
            line: 1,
            source: { kind: 'server', name: 'Type\u200BScript' },
            note: 'o\u2066verload',
          },
        ]}
        selected="a"
        at={'r\u202E5'}
        meta={'src/evil\u202Egnp.ts · r5'}
      />,
    );
    const text = host.textContent ?? '';
    // None is left to be invisible, and none is swapped for a stand-in that stands for all.
    expect(text).not.toMatch(/\p{Cf}/u);
    expect(text).not.toContain('\uFFFD');
    expect(text).toContain('evilU+202Elive');
    expect(text).toContain('src/evilU+202Egnp.ts1');
    expect(text).toContain('TypeU+200BScript · oU+2066verload');
    expect(text).toContain('at rU+202E5');
    const titles = [...host.querySelectorAll('[title^="U+"]')].map((mark) =>
      mark.getAttribute('title'),
    );
    expect(titles).toContain('U+202E right-to-left override');
    expect(titles).toContain('U+200B zero width space');
    // A label has no room for a badge, and spells it out.
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Definitions of evil\u2039U+202E\u203Alive',
    );
  });

  it('keeps a long note in the answers column whole, on more lines, with no sideways scroll to it', () => {
    const host = render(<Peek name="estimateCost" candidates={SYNTAX} selected="import" />);
    const note = options(host)[0]!.lastElementChild!.firstElementChild!;
    // It isn't cut with an ellipsis or held on one line, where the column is too narrow for it.
    expect(note.className).not.toContain('whitespace-nowrap');
    expect(note.className).toContain('flex');
    expect(note.lastElementChild?.className).toContain('wrap-anywhere');
    expect(note.lastElementChild?.className).not.toContain('truncate');
  });

  it('draws with no answer picked, and no active descendant', () => {
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected={undefined} />);
    expect(host.querySelector('[role="listbox"]')?.hasAttribute('aria-activedescendant')).toBe(
      false,
    );
    expect(options(host).every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('keeps a long list no taller than the code beside it, and its names from running over', async () => {
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" />);
    const list = host.querySelector('[role="listbox"]')!;
    expect(list.classList.contains('peek-list')).toBe(true);
    expect(list.classList.contains('overflow-auto')).toBe(true);
    const css = squash(await buildCss(['peek-list', 'peek', 'peek-single']));
    expect(css).toContain(
      '.peek-list { max-height: calc(15 * var(--lo-code-line)); @container (width < 36rem) { max-height: calc(8 * var(--lo-code-line)); } }',
    );
    expect(declarations(css, 'peek-single')).toBe('grid-template-columns: minmax(0, 1fr);');
  });

  it('gives its answers column up to the code when the peek itself is narrow', async () => {
    // The peek is the container its parts answer to, so a narrow place stacks them, not a window.
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" />);
    const frame = host.querySelector('[role="dialog"]')!;
    expect(frame.classList.contains('@container')).toBe(true);
    const grid = frame.firstElementChild!;
    expect(grid.classList.contains('peek')).toBe(true);
    // Its parts are inside the grid, which is inside the container: a container can't query itself.
    expect(grid.querySelector('.peek-go')).not.toBeNull();
    expect(grid.querySelector('.peek-close')).not.toBeNull();
    expect(host.querySelector('[role="listbox"]')?.classList.contains('peek-rule')).toBe(true);
    const css = squash(await buildCss(['peek', 'peek-rule', 'peek-go', 'peek-close']));
    expect(css).toContain(
      '.peek { display: grid; grid-template-columns: 250px minmax(0, 1fr); @container (width < 36rem) { grid-template-columns: minmax(0, 1fr); } }',
    );
    expect(css).toContain(
      '.peek-rule { border-inline-end: 1px solid var(--lo-border-subtle); @container (width < 36rem) { border-inline-end: 0; border-block-end: 1px solid var(--lo-border-subtle); } }',
    );
    expect(css).toContain('.peek-go { order: 3; margin-inline-start: auto; }');
    expect(css).toContain('.peek-close { order: 2; }');
    // One answer has the line of its own under its head, as the list's rule would be.
    const single = render(
      <Peek name="estimateCost" candidates={[CANDIDATES[0]!]} selected="estimate" />,
    );
    expect(single.querySelector('[role="listbox"]')?.classList.contains('peek-rule')).toBe(false);
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" keys={KEYS}>
        <pre>code</pre>
      </Peek>,
    );
    expect(await missingRules(host, ['group-focus-visible/list:shadow-ring-inset'])).toEqual([]);
    const single = render(
      <Peek name="estimateCost" candidates={[CANDIDATES[0]!]} selected="estimate" />,
    );
    expect(await missingRules(single)).toEqual([]);
    const syntax = render(<Peek name="estimateCost" candidates={SYNTAX} selected="outside" />);
    expect(await missingRules(syntax)).toEqual([]);
  });
});

describe('PeekHead', () => {
  it('says where the answers came from when no list does, with what sets them apart', async () => {
    const host = render(
      <div>
        <PeekHead
          name="Line"
          count={1}
          at="r2"
          goes
          source={{ kind: 'syntax' }}
          note="TypeScript is starting."
        />
      </div>,
    );
    expect(host.textContent).toContain(
      'Line · 1 definitionat r2·Syntax index · TypeScript is starting.',
    );
    const server = render(
      <div>
        <PeekHead name="Line" count={1} goes source={{ kind: 'server', name: 'TypeScript' }} />
      </div>,
    );
    expect(server.textContent).toContain('Line · 1 definition·TypeScript');
    expect(await missingRules(host)).toEqual([]);
  });

  it('says nothing of where they came from when it isn’t given, as beside a list', () => {
    const host = render(
      <div>
        <PeekHead name="Line" count={3} goes />
      </div>,
    );
    expect(host.textContent).not.toContain('·TypeScript');
    expect(host.textContent).not.toContain('Syntax index');
  });
});
