import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { defineSlot, defineView, Slot, Slots, useViews, type View } from './slots.tsx';

// Two slots a made-up tab feature defines, and the views other features put in them.
const status = defineSlot<{ tab: string }>('tab.status');
const left = defineSlot('tab.left');

function Counter({ tab }: { tab: string }) {
  const [count] = useState(3);
  return <s>{`${tab}: ${count}`}</s>;
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
