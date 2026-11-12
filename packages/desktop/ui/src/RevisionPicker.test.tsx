// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { RevisionPicker, type RevisionPickerRow } from './RevisionPicker.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

/** Renders `node` into a fresh `.lo-app` element, and returns the page: the picker portals to it. */
function render(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return document.body;
}

const rows: RevisionPickerRow[] = [
  {
    key: 'r5',
    label: 'r5',
    line: 'Pushed',
    meta: 'ravi-k · 40 min ago · 7f3e9b1',
    tags: [{ label: 'Newest', kind: 'newest' }],
  },
  {
    key: 'r4',
    label: 'r4',
    line: 'Force-pushed · rebased onto main',
    forced: true,
    meta: 'ravi-k · 6 hours ago · d52a0f8',
    tags: [{ label: 'Last seen here', kind: 'seen' }],
  },
  {
    key: 'r3',
    label: 'r3',
    line: 'Pushed',
    meta: 'ravi-k · 1 day ago · a91c4e2',
    tags: [{ label: 'Overview', kind: 'overview' }],
  },
  {
    key: 'r1',
    label: 'r1',
    line: 'No longer available',
    meta: 'ravi-k · 3 days ago',
    disabled: true,
  },
  { key: 'base', label: 'base', line: 'main', meta: 'at 4c2e1aa', base: true },
];

function picker(
  onRowClick = vi.fn<(key: string) => void>(),
  onShortcut = vi.fn<(id: string) => void>(),
  onCompare = vi.fn<() => void>(),
) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const page = render(
    <RevisionPicker
      open
      onOpenChange={() => undefined}
      anchor={anchor}
      scope="revisions"
      heading={<span>Comparing r3 → r5</span>}
      openKeys={['g', 'v']}
      rows={rows}
      focused="r4"
      ends={{ from: 'r3', to: 'r5' }}
      onRowClick={onRowClick}
      shortcuts={[
        { id: 'seen', label: 'Since last seen · r4 → r5', keys: ['s'] },
        { id: 'whole', label: 'Whole PR · base → r5', keys: ['w'], pressed: true },
      ]}
      onShortcut={onShortcut}
      compare={{ label: 'Compare r3 → r5', keys: ['⏎'] }}
      onCompare={onCompare}
      moveKeys={['j']}
      endKeys={['␣']}
      note="Revisions are compared once the local copy is ready."
    />,
  );
  return { page, onRowClick, onShortcut, onCompare };
}

describe('RevisionPicker', () => {
  it('lists the revisions newest first, the ends and what lies between them marked', () => {
    const { page } = picker();
    const list = page.querySelector('[role="listbox"]');
    expect(list?.getAttribute('data-lo-scope')).toBe('revisions');
    const options = [...page.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.getAttribute('data-key'))).toEqual([
      'r5',
      'r4',
      'r3',
      'r1',
      'base',
    ]);
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'true',
      'false',
      'false',
    ]);
    // The keyboard is on r4, between the ends.
    expect(list?.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    expect(options[1]?.className).toContain('bg-current');
    expect(options[3]?.getAttribute('aria-disabled')).toBe('true');
    expect(page.textContent).toContain('Last seen here');
    expect(page.textContent).toContain('Revisions are compared once the local copy is ready.');
    // The revision the overview describes, with the overview's mark.
    expect(options[2]?.textContent).toContain('Overview');
    expect(options[2]?.querySelector('.lo-ovmark')?.getAttribute('aria-hidden')).toBe('true');
    expect(page.querySelectorAll('.lo-ovmark')).toHaveLength(1);
  });

  it('says what a click asks for: an end, a shortcut, or to compare', () => {
    const { page, onRowClick, onShortcut, onCompare } = picker();
    act(() => page.querySelector<HTMLElement>('[data-key="r1"]')?.click());
    expect(onRowClick).toHaveBeenCalledWith('r1');
    const buttons = [...page.querySelectorAll('button')];
    act(() => buttons.find((button) => button.textContent?.startsWith('Since last seen'))?.click());
    expect(onShortcut).toHaveBeenCalledWith('seen');
    expect(
      buttons
        .find((button) => button.textContent?.startsWith('Whole PR'))
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    act(() => buttons.find((button) => button.textContent?.startsWith('Compare r3'))?.click());
    expect(onCompare).toHaveBeenCalled();
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const { page } = picker();
    const classes = [
      ...new Set(
        [...page.querySelectorAll('[class]')].flatMap((element) =>
          (element.getAttribute('class') ?? '').split(/\s+/),
        ),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
