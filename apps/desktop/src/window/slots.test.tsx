// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import {
  defineSlot,
  defineView,
  failViewsLoudly,
  isSlot,
  Slot,
  Slots,
  useViews,
  type View,
} from './slots.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

// Two slots a made-up tab feature defines, and the views other features put in them.
const status = defineSlot<{ tab: string }>('tab.status');
const left = defineSlot('tab.left');

function Counter({ tab }: { tab: string }) {
  const [count] = useState(3);
  return <s>{`${tab}: ${count}`}</s>;
}

/** A view that always fails. */
function Broken(): never {
  throw new Error('the tree is missing');
}

/** Renders only the first of the status slot's views. */
function First() {
  const [first] = useViews(status);
  return first ? <first.render tab="#3" /> : null;
}

const views: View[] = [
  defineView(status, { id: 'diff.lines', order: 20, render: ({ tab }) => <i>lines of {tab}</i> }),
  defineView(left, { id: 'tree.files', order: 10, render: () => <nav>files</nav> }),
  defineView(status, { id: 'tree.position', order: 10, render: ({ tab }) => <b>{tab} at 1</b> }),
  defineView(status, { id: 'revisions.range', order: 10, render: () => <u>r1 → r2</u> }),
];

describe('Slot', () => {
  it('renders the views features put in it, in order, each with its props', () => {
    expect(
      renderToStaticMarkup(
        <Slots views={views}>
          <Slot slot={status} props={{ tab: '#12' }} />
        </Slots>,
      ),
    ).toBe('<u>r1 → r2</u><b>#12 at 1</b><i>lines of #12</i>');
  });

  it('renders nothing where no feature puts a view', () => {
    const empty = defineSlot('tab.banners');
    expect(
      renderToStaticMarkup(
        <Slots views={views}>
          <Slot slot={empty} props={{}} />
        </Slots>,
      ),
    ).toBe('');
    expect(renderToStaticMarkup(<Slot slot={left} props={{}} />)).toBe('');
  });

  it('shows a note in place of a view that throws, logs why, and keeps the others', () => {
    const error = errors();
    const withBroken = [
      ...views,
      defineView(status, { id: 'stacks.broken', order: 15, render: Broken }),
    ];
    const page = mount(
      <Slots views={withBroken}>
        <Slot slot={status} props={{ tab: '#12' }} />
      </Slots>,
    );
    // The views in order, with the note in the broken one's place.
    expect([...page.children].map((each) => each.tagName)).toEqual(['U', 'B', 'P', 'I']);
    const note = page.querySelector('[role="alert"]');
    expect(note?.getAttribute('data-lo-failed-view')).toBe('stacks.broken');
    expect(note?.textContent).toBe(
      "Lo couldn't show this part of the window. Restart Lo to try again.",
    );
    expect(error).toHaveBeenCalledWith(
      "Lo couldn't show the view stacks.broken:",
      expect.objectContaining({ message: 'the tree is missing' }),
    );
  });

  it('renders each view as a component of its own, with its own state', () => {
    const counted = [defineView(status, { id: 'stacks.count', order: 0, render: Counter })];
    expect(
      renderToStaticMarkup(
        <Slots views={counted}>
          <Slot slot={status} props={{ tab: '#7' }} />
        </Slots>,
      ),
    ).toBe('<s>#7: 3</s>');
  });
});

/** Renders `element` into the page, returning its container, until the test ends. */
function mount(element: React.ReactNode): HTMLElement {
  const page = document.body.appendChild(document.createElement('div'));
  const root = createRoot(page);
  onTestFinished(() => {
    act(() => root.unmount());
    page.remove();
  });
  act(() => root.render(element));
  return page;
}

/** Silences and records what's logged as an error, until the test ends. */
function errors() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  onTestFinished(() => error.mockRestore());
  return error;
}

/** A slot whose only view fails, and a feature's screen that shows its first view itself. */
const middle = defineSlot<{ tab: string }>('tab.middle');
const failing = [defineView(middle, { id: 'diff.diff', order: 0, render: Broken })];

function Middle() {
  const [first] = useViews(middle);
  return first ? <first.render tab="#3" /> : null;
}

describe('a view that fails', () => {
  it('shows its note when its owner renders it through useViews too', () => {
    const error = errors();
    const page = mount(
      <Slots views={failing}>
        <Middle />
      </Slots>,
    );
    expect(page.querySelector('[role="alert"]')?.getAttribute('data-lo-failed-view')).toBe(
      'diff.diff',
    );
    expect(error).toHaveBeenCalledWith(
      "Lo couldn't show the view diff.diff:",
      expect.objectContaining({ message: 'the tree is missing' }),
    );
  });

  it('stops the window too in a build run from source, once it has logged why', () => {
    const error = errors();
    failViewsLoudly();
    onTestFinished(() => failViewsLoudly(false));
    const page = document.body.appendChild(document.createElement('div'));
    const root = createRoot(page);
    onTestFinished(() => page.remove());
    expect(() =>
      act(() =>
        root.render(
          <Slots views={failing}>
            <Middle />
          </Slots>,
        ),
      ),
    ).toThrow('the tree is missing');
    expect(error).toHaveBeenCalledWith("Lo couldn't show the view diff.diff:", expect.any(Error));
    expect(page.innerHTML).toBe('');
  });
});

describe('useViews', () => {
  it('lists the views in a slot, in order, for an owner that lays them out itself', () => {
    expect(
      renderToStaticMarkup(
        <Slots views={views}>
          <First />
        </Slots>,
      ),
    ).toBe('<u>r1 → r2</u>');
  });
});

describe('defineSlot', () => {
  it('marks what it makes, so the slots a feature shares can be found', () => {
    expect(isSlot(status)).toBe(true);
    expect(isSlot({ id: 'tab.status' })).toBe(false);
    expect(isSlot(undefined)).toBe(false);
  });
});

describe('names', () => {
  it('are <feature>.<name>, for slots and views alike', () => {
    expect(() => defineSlot('middle')).toThrow('A slot is named <feature>.<name>');
    expect(() => defineSlot('tab.middle.left')).toThrow('A slot is named <feature>.<name>');
    expect(() => defineView(left, { id: 'Tree.files', order: 0, render: () => null })).toThrow(
      'A view is named <feature>.<name>',
    );
  });

  it('type each view’s component by its slot’s props', () => {
    // @ts-expect-error The status slot gives a tab, not a path.
    defineView(status, { id: 'tree.path', order: 0, render: ({ path }: { path: string }) => path });
    expect(defineView(status, { id: 'tree.none', order: 0, render: () => null }).slot).toBe(status);
  });
});
