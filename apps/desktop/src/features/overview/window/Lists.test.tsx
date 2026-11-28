// @vitest-environment jsdom
// Settings' Collapsed sections and Ignored terms rows: every repo's list and each repo's own, and
// what their fields and buttons write.
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { rows } from '../../settings/window/shared.ts';
import type { ScopedValue } from '../settings.ts';
import {
  CollapsedAdd as Add,
  CollapsedLists as Lists,
  CollapsedRow,
  IgnoredLists,
  IgnoredRow,
} from './Lists.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** Draws `element` in a container of its own, taken away as the test ends. */
function draw(element: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

/**
 * The row, drawn in Settings' slot, with what it asks main to write. Main hasn't said what the file
 * holds, so the row shows the setting's default: no collapsed sections.
 */
function drawn(row = CollapsedRow) {
  const bridge = installBridge({ 'settings.set': () => undefined });
  const container = draw(
    <Slots views={[row]}>
      <Slot slot={rows} props={{}} />
    </Slots>,
  );
  const writes = () =>
    bridge.calls.filter(([channel]) => channel === 'settings.set').map(([, input]) => input);
  return { container, writes };
}

/** One of the row's controls, given `value`, with the values it changes the setting to. */
function control(
  Control: typeof Lists | typeof Add,
  value: ScopedValue,
): { container: HTMLElement; changes: ScopedValue[] } {
  const changes: ScopedValue[] = [];
  const container = draw(
    <div role="group">
      <Control
        value={value}
        change={(next) => changes.push(next)}
        note={() => undefined}
        noteId={undefined}
      />
    </div>,
  );
  return { container, changes };
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
  it('says what it holds, and that there are none with nothing listed', () => {
    const { container } = drawn();
    expect(container.textContent).toContain('Collapsed sections');
    expect(container.textContent).toContain(
      'Overview sections that start collapsed, by heading. The tl;dr always shows.',
    );
    expect(container.textContent).toContain('No collapsed sections');
  });

  it('adds a heading typed in its field to every repo’s list, with Add or ⏎', async () => {
    const { container, writes } = drawn();
    const field = container.querySelector<HTMLInputElement>('input')!;
    expect(field.placeholder).toBe('Heading');
    type(field, '  How   it works ');
    enter(field);
    await settle();
    expect(writes()).toEqual([{ key: 'overview.collapsed', value: { '*': ['How it works'] } }]);
    expect(field.value).toBe('');
    type(field, 'Rollout');
    const add = [...container.querySelectorAll('button')].find(
      (each) => each.textContent === 'Add',
    );
    click(add);
    await settle();
    expect(writes()).toHaveLength(2);
  });

  it('refuses the tl;dr, saying why under its line', async () => {
    const { container, writes } = drawn();
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
    type(field, 'Testing');
    expect(container.querySelector('[role="alert"]')?.textContent ?? '').toBe('');
  });

  it('writes nothing for a heading every repo’s list has', () => {
    const { container, changes } = control(Add, { '*': ['Testing'] });
    const field = container.querySelector<HTMLInputElement>('input')!;
    type(field, 'testing');
    enter(field);
    expect(changes).toEqual([]);
    expect(field.value).toBe('');
  });

  it('lists every repo’s headings, then each repo’s own by name, each heading once', () => {
    const { container } = control(Lists, {
      'rozed-dev/lo': ['Rollout', 'Testing'],
      '*': ['Testing', 'testing'],
      'fieldwork/atlas-api': [],
    });
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

  it('removes an entry, puts a repo’s in every list, and resets a repo', () => {
    const { container, changes } = control(Lists, {
      '*': ['Testing'],
      'rozed-dev/lo': ['Rollout'],
    });
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find(
        (each) => each.getAttribute('aria-label') === name,
      );
    click(button('Remove Testing'));
    click(button('Collapse Rollout in every repo'));
    click(button('Reset rozed-dev/lo'));
    expect(changes).toEqual([
      { '*': [], 'rozed-dev/lo': ['Rollout'] },
      { '*': ['Testing', 'Rollout'], 'rozed-dev/lo': ['Rollout'] },
      { '*': ['Testing'] },
    ]);
  });
});

describe('the Ignored terms row', () => {
  it('says what it holds, and that there are none with nothing listed', () => {
    const { container } = drawn(IgnoredRow);
    expect(container.textContent).toContain('Ignored terms');
    expect(container.textContent).toContain(
      'Glossary terms that show as plain text, without their definitions.',
    );
    expect(container.textContent).toContain('No ignored terms');
  });

  it('adds a term typed in its field to every repo’s list, the tl;dr among them', async () => {
    const { container, writes } = drawn(IgnoredRow);
    const field = container.querySelector<HTMLInputElement>('input')!;
    expect(field.placeholder).toBe('Term');
    expect(field.getAttribute('aria-label')).toBe('Term to ignore');
    type(field, ' token   bucket ');
    enter(field);
    await settle();
    type(field, 'tl;dr');
    enter(field);
    await settle();
    expect(writes()).toEqual([
      { key: 'overview.ignored', value: { '*': ['token bucket'] } },
      { key: 'overview.ignored', value: { '*': ['tl;dr'] } },
    ]);
  });

  it('lists every repo’s terms, then each repo’s own, with Stop ignoring and Ignore in every repo', () => {
    const { container, changes } = control(IgnoredLists, {
      '*': ['bucket'],
      'rozed-dev/lo': ['bucket', 'lease'],
    });
    expect(scopes(container)).toEqual([
      ['Every repo', 'bucketStop ignoring'],
      [
        'rozed-dev/lo · replaces every repo’s list',
        'bucketStop ignoring',
        'leaseIgnore in every repoStop ignoring',
      ],
    ]);
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find(
        (each) => each.getAttribute('aria-label') === name,
      );
    click(button('Stop ignoring bucket'));
    click(button('Ignore lease in every repo'));
    expect(changes).toEqual([
      { 'rozed-dev/lo': ['bucket', 'lease'], '*': [] },
      { '*': ['bucket', 'lease'], 'rozed-dev/lo': ['bucket', 'lease'] },
    ]);
  });
});
