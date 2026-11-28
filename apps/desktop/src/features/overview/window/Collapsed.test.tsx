// @vitest-environment jsdom
// Settings' Collapsed sections row: every repo's list and each repo's own, and what its field and
// buttons write.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type { SettingsState } from '../../settings/contract.ts';
import { rows } from '../../settings/window/shared.ts';
import { showSettings } from '../../settings/window/store.ts';
import type { ScopedValue } from '../settings.ts';
import CollapsedRow from './Collapsed.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** Settings as main says them, with `overview.collapsed` set to `value`. */
function shown(value: ScopedValue): void {
  const state: SettingsState = {
    file: '~/.config/lo/settings.json',
    values: { 'overview.collapsed': value },
    inFile: ['overview.collapsed'],
    problems: [],
  };
  showSettings(state);
}

/** The row, drawn in Settings' slot, with what it asks main to write. */
function drawn(value: ScopedValue) {
  shown(value);
  const bridge = installBridge({ 'settings.set': () => undefined });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Slots views={[CollapsedRow]}>
        <Slot slot={rows} props={{}} />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  const writes = () =>
    bridge.calls.filter(([channel]) => channel === 'settings.set').map(([, input]) => input);
  return { container, writes };
}

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Types into `input` as a person does. */
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function enter(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/** Lets what waits on main's answer settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

/** Each scope's head and entries, as the row reads. */
function scopes(container: HTMLElement): string[][] {
  return [...container.querySelectorAll('[data-scope]')].map((scope) => [
    scope.querySelector('span')?.textContent ?? '',
    ...[...scope.querySelectorAll('[role="listitem"]')].map((entry) => entry.textContent ?? ''),
  ]);
}

describe('the Collapsed sections row', () => {
  it('lists every repo’s headings, then each repo’s own by name, each heading once', () => {
    const { container } = drawn({
      'rozed-dev/lo': ['Rollout', 'Testing'],
      '*': ['Testing', 'testing'],
      'fieldwork/atlas-api': [],
    });
    expect(container.textContent).toContain('Collapsed sections');
    expect(container.textContent).toContain(
      'Overview sections that start collapsed, by heading. The tl;dr always shows.',
    );
    expect(scopes(container)).toEqual([
      ['Every repo', 'TestingRemove'],
      ['fieldwork/atlas-api · replaces every repo’s list'],
      [
        'rozed-dev/lo · replaces every repo’s list',
        'RolloutCollapse in every repoRemove',
        // Not in every list: atlas-api's own hasn't it.
        'TestingCollapse in every repoRemove',
      ],
    ]);
    expect(container.textContent).toContain('None in this repo');
  });

  it('says there are none with nothing listed', () => {
    const { container } = drawn({});
    expect(container.textContent).toContain('No collapsed sections');
  });

  it('adds a heading typed in its field to every repo’s list, with Add or ⏎', async () => {
    const { container, writes } = drawn({ '*': ['Testing'] });
    const field = container.querySelector<HTMLInputElement>('input')!;
    expect(field.placeholder).toBe('Heading');
    type(field, '  How   it works ');
    enter(field);
    await settle();
    expect(writes()).toEqual([
      { key: 'overview.collapsed', value: { '*': ['Testing', 'How it works'] } },
    ]);
    expect(field.value).toBe('');
    type(field, 'Rollout');
    const add = [...container.querySelectorAll('button')].find(
      (each) => each.textContent === 'Add',
    );
    click(add);
    await settle();
    expect(writes()).toHaveLength(2);
  });

  it('refuses the tl;dr, saying why under its line, and writes nothing for a heading listed', async () => {
    const { container, writes } = drawn({ '*': ['Testing'] });
    const field = container.querySelector<HTMLInputElement>('input')!;
    type(field, 'TL;DR');
    enter(field);
    await settle();
    expect(writes()).toEqual([]);
    const note = container.querySelector('[role="alert"]');
    expect(note?.textContent).toBe('The tl;dr can’t collapse.');
    expect(field.getAttribute('aria-describedby')).toBe(note?.id);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    // Typing again clears it.
    type(field, 'testing');
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toBe('');
    enter(field);
    await settle();
    expect(writes()).toEqual([]);
  });

  it('removes an entry, puts a repo’s in every list, and resets a repo', async () => {
    const { container, writes } = drawn({ '*': ['Testing'], 'rozed-dev/lo': ['Rollout'] });
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find(
        (each) => each.getAttribute('aria-label') === name,
      );
    click(button('Remove Testing'));
    click(button('Collapse Rollout in every repo'));
    click(button('Reset rozed-dev/lo'));
    await settle();
    expect(writes()).toEqual([
      { key: 'overview.collapsed', value: { '*': [], 'rozed-dev/lo': ['Rollout'] } },
      {
        key: 'overview.collapsed',
        value: { '*': ['Testing', 'Rollout'], 'rozed-dev/lo': ['Rollout'] },
      },
      { key: 'overview.collapsed', value: { '*': ['Testing'] } },
    ]);
  });
});
