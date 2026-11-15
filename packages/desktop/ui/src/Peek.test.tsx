// @vitest-environment jsdom
// The peek's frame: its head, the list of answers with where each came from, the one shown, the
// code it holds, and the keys it points to. It draws no keys of its own, so these check what it says
// and what it asks for.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, declarations } from '../scripts/stylesheet.ts';
import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render, rerender } from '../test/dom.ts';
import { Peek, type PeekCandidate, type PeekKeys } from './Peek.tsx';

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
    source: { kind: 'syntax' },
    note: 'same name',
  },
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

  it('lists each answer with its path, its line and where it came from, the server first', () => {
    const host = render(<Peek name="estimateCost" candidates={CANDIDATES} selected="estimate" />);
    const rows = options(host);
    expect(rows.map((row) => row.dataset['key'])).toEqual(['estimate', 'cost', 'helpers']);
    expect(rows[0]?.textContent).toBe('graphql/cost/estimate.ts18TypeScript');
    expect(rows[1]?.textContent).toBe('ratelimit/src/cost.ts41TypeScript · overload');
    // Lo's own reading of the syntax is named the same wherever it answers.
    expect(rows[2]?.textContent).toBe('test/helpers/cost.ts7Syntax index · same name');
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
    expect(dialog?.classList.contains('peek-single')).toBe(true);
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
    expect(bare.querySelector('button:last-of-type')?.getAttribute('aria-label')).toBe('Close');
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
    const css = await buildCss(['peek-list', 'peek', 'peek-single']);
    expect(declarations(css, 'peek-list')).toBe('max-height: calc(15 * var(--lo-code-line));');
    expect(declarations(css, 'peek-single')).toBe('grid-template-columns: minmax(0, 1fr);');
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
  });
});
