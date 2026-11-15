// @vitest-environment jsdom
// Settings' list of what the reader trusts: a row for each repo or pull request from a fork, how
// long ago it was trusted, and the button that removes it.

import { useState } from 'react';
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

/** The list as Settings holds it: a row that is removed leaves, and the rest stay. */
function Held({ entries }: { entries: readonly TrustEntry[] }) {
  const [held, setHeld] = useState(entries);
  return (
    <TrustList
      entries={held}
      onRemove={(key) => setHeld((all) => all.filter((e) => e.key !== key))}
    />
  );
}

/** The "Remove" button of the row for `key`. */
function remove(host: HTMLElement, key: string): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>(`[role="listitem"][data-key="${key}"] button`)!;
}

const ENTRIES: TrustEntry[] = [
  { key: 'api', name: 'fieldwork/atlas-api', kind: 'repo', trusted: '12 days ago' },
  { key: 'web', name: 'fieldwork/atlas-web', kind: 'repo', trusted: '3 days ago' },
  { key: 'fork', name: 'sam-whit/atlas-api#4833', kind: 'fork', trusted: 'today' },
];

/** A list whose row goes only when `#land` is pressed, as when main answers after the press. */
function Later() {
  const [held, setHeld] = useState(ENTRIES);
  const [landed, setLanded] = useState(false);
  return (
    <>
      <button type="button" id="land" onClick={() => setLanded(true)}>
        Land
      </button>
      <button type="button" id="elsewhere">
        Elsewhere
      </button>
      <TrustList
        entries={landed ? held.filter((e) => e.key !== 'api') : held}
        onRemove={() => setHeld((all) => [...all])}
      />
    </>
  );
}

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

  it('says when nothing is trusted, and points to places that are always there', () => {
    const host = render(<TrustList entries={[]} />);
    // Not to the banner, which a reader has dismissed by now.
    expect(host.textContent).toBe(
      'Nothing is trusted yet. Trust a repo or a PR from the language servers item in the status bar, or from the command palette.',
    );
    expect(host.textContent).not.toContain('banner');
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('[role="list"]')).toBeNull();
    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Trusted repos and PRs',
    );
  });

  it('moves focus to the next row’s button when a row is removed', () => {
    const host = render(<Held entries={ENTRIES} />);
    focus(remove(host, 'api'));
    click(remove(host, 'api'));
    expect(remove(host, 'api')).toBeNull();
    expect(document.activeElement).toBe(remove(host, 'web'));
  });

  it('moves focus to the previous row’s button when the last row is removed', () => {
    const host = render(<Held entries={ENTRIES} />);
    focus(remove(host, 'fork'));
    click(remove(host, 'fork'));
    expect(document.activeElement).toBe(remove(host, 'web'));
  });

  it('moves focus to the list when the last row of all is removed, and it stays there', () => {
    const host = render(<Held entries={[ENTRIES[0]!]} />);
    focus(remove(host, 'api'));
    click(remove(host, 'api'));
    const list = host.querySelector<HTMLElement>('[aria-label="Trusted repos and PRs"]')!;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute('role')).toBe('group');
    // It is the same element before and after, so nothing it held is lost with the row.
    expect(host.textContent).toContain('Nothing is trusted yet.');
    // The list takes focus when it is told to, and is no stop for `Tab` of its own.
    expect(list.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves focus where the reader put it, when it has gone elsewhere before the row is gone', () => {
    // A caller that removes a row later than the press, as one waiting on main does.
    const host = render(<Later />);
    focus(remove(host, 'api'));
    click(remove(host, 'api'));
    const elsewhere = host.querySelector<HTMLButtonElement>('#elsewhere')!;
    focus(elsewhere);
    click(host.querySelector('#land')!);
    expect(remove(host, 'api')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('keeps focus on the button of a row that was not removed', () => {
    const host = render(<TrustList entries={ENTRIES} onRemove={() => undefined} />);
    focus(remove(host, 'web'));
    click(remove(host, 'web'));
    expect(document.activeElement).toBe(remove(host, 'web'));
  });

  it('shows the format characters in a name, and in the label of the button that names it', () => {
    const host = render(
      <TrustList
        entries={[{ key: 'x', name: 'evil\u202Elive/atlas', kind: 'repo', trusted: 'today' }]}
      />,
    );
    expect(host.textContent).toContain('evilU+202Elive/atlas');
    expect(host.textContent).not.toMatch(/\p{Cf}/u);
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Remove evil\u2039U+202E\u203Alive/atlas',
    );
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
