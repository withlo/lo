// @vitest-environment jsdom
// Settings' list of what the reader trusts: a row for each repo or pull request from a fork, how
// long ago it was trusted, and the button that removes it.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, focus, render } from '../test/dom.ts';
import { TrustList, TrustRow, type TrustEntry } from './Trust.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
});

const ENTRIES: TrustEntry[] = [
  { key: 'api', name: 'fieldwork/atlas-api', kind: 'repo', trusted: '12 days ago' },
  { key: 'web', name: 'fieldwork/atlas-web', kind: 'repo', trusted: '3 days ago' },
  { key: 'fork', name: 'sam-whit/atlas-api#4833', kind: 'fork', trusted: 'today' },
];

describe('TrustList', () => {
  it('lists each thing trusted by its name, what it covers and since when', () => {
    const host = render(<TrustList entries={ENTRIES} />);
    const rows = [...host.querySelectorAll('[role="listitem"]')];
    expect(rows.map((row) => row.textContent)).toEqual([
      'fieldwork/atlas-apiRepo · trusted 12 days agoRemove',
      'fieldwork/atlas-webRepo · trusted 3 days agoRemove',
      'sam-whit/atlas-api#4833One PR from a fork · trusted todayRemove',
    ]);
    expect(host.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe(
      'Trusted repos and PRs',
    );
  });

  it('sets a name in the code font, since it is one', () => {
    const host = render(<TrustList entries={ENTRIES} />);
    const name = host.querySelector('[role="listitem"] span');
    expect(name?.textContent).toBe('fieldwork/atlas-api');
    expect(name?.className).toContain('code-small');
  });

  it('removes the row whose button was pressed, naming it by key', () => {
    const onRemove = vi.fn<(key: string) => void>();
    const host = render(<TrustList entries={ENTRIES} onRemove={onRemove} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons).toHaveLength(3);
    click(buttons[2]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('fork');
  });

  it('says which row each button removes, to a screen reader, without changing what it says', () => {
    const host = render(<TrustList entries={ENTRIES} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Remove', 'Remove', 'Remove']);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Remove fieldwork/atlas-api',
      'Remove fieldwork/atlas-web',
      'Remove sam-whit/atlas-api#4833',
    ]);
  });

  it('puts each button in the tab order, so every row can be removed by keyboard', () => {
    const host = render(<TrustList entries={ENTRIES} />);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.every((button) => button.tabIndex === 0)).toBe(true);
    focus(buttons[1]!);
    expect(document.activeElement).toBe(buttons[1]);
  });

  it('says when nothing is trusted, and where to trust something', () => {
    const host = render(<TrustList entries={[]} />);
    expect(host.textContent).toBe(
      'Nothing is trusted yet. Trust a repo or a PR from the banner on its tab.',
    );
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[role="list"]')).toBeNull();
  });

  it("only uses utilities that Lo's stylesheet has", async () => {
    const host = render(
      <>
        <TrustList entries={ENTRIES} />
        <TrustList entries={[]} />
        <TrustRow entry={ENTRIES[0]!} />
      </>,
    );
    expect(await missingRules(host)).toEqual([]);
  });
});
