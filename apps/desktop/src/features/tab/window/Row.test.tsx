// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { FIRST_LAYOUT } from '../contract.ts';
import {
  askPanel,
  closePanel,
  layout,
  resetLayout,
  row,
  togglePanel,
  usePanelDrawn,
  viewCounts,
  type There,
} from './layout.ts';
import { LeftPanel, RightPanel } from './Row.tsx';
import { setRowSizes } from './sizes.testing.ts';

vi.mock('./main.ts', () => ({
  main: () => ({
    layout: () => Promise.resolve(FIRST_LAYOUT),
    keepLayout: () => Promise.resolve(),
  }),
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  setRowSizes();
});

beforeEach(() => {
  viewCounts.left = 1;
  viewCounts.right = 1;
});

afterEach(() => {
  layout.setState(FIRST_LAYOUT, true);
  row.setState({}, true);
});

const there: There = { left: true, threads: true, beside: true };

/** A pull request's tab's row, as the tab draws it: a panel only while it's drawn. */
function Tab() {
  const showLeft = usePanelDrawn('left', there);
  const showRight = usePanelDrawn('threads', there);
  return (
    <>
      {showLeft && (
        <LeftPanel there={there} failed={false}>
          <button type="button">a.ts</button>
        </LeftPanel>
      )}
      <main data-lo-middle tabIndex={-1} />
      {showRight && (
        <RightPanel there={there} failed={false} label="Threads" view="comments.panel">
          <button type="button">Thread</button>
        </RightPanel>
      )}
    </>
  );
}

/** Draws the row, and says where its parts are. */
function render() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Tab />));
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  const find = (selector: string) => container.querySelector<HTMLElement>(selector);
  return {
    middle: () => find('[data-lo-middle]'),
    left: () => find('[data-lo-left]'),
    right: () => find('[data-lo-right]'),
    focus: (panel: 'left' | 'right') => {
      find(`[data-lo-${panel}] button`)?.focus();
      expect(document.activeElement?.textContent).toBe(panel === 'left' ? 'a.ts' : 'Thread');
    },
  };
}

/** Makes `change`, and lets React draw it and focus be handed on. */
async function settle(change: () => void): Promise<void> {
  await act(async () => {
    change();
    await Promise.resolve();
  });
}

describe('focus in a panel', () => {
  it('goes back to the middle view as the panel closes', async () => {
    layout.setState({ left: { open: true }, threads: { open: true } });
    row.setState({ width: 1440 });
    const tab = render();
    tab.focus('right');
    await settle(() => togglePanel('threads'));
    expect(tab.right()).toBeNull();
    expect(document.activeElement).toBe(tab.middle());
  });

  it('goes back to the middle view as the panel is put away for the one asked for', async () => {
    layout.setState({ left: { open: false }, threads: { open: true } });
    row.setState({ width: 720 });
    const tab = render();
    tab.focus('right');
    // At 720 px, only one panel fits beside the view: the left, asked for, puts the threads away.
    await settle(() => askPanel('left'));
    expect(tab.left()).not.toBeNull();
    expect(tab.right()).toBeNull();
    expect(document.activeElement).toBe(tab.middle());
  });

  it('goes back to the middle view as the window narrows and puts the panel away', async () => {
    layout.setState({ left: { open: true }, threads: { open: false } });
    row.setState({ width: 1440 });
    const tab = render();
    tab.focus('left');
    await settle(() => row.setState({ width: 540 }));
    expect(tab.left()).toBeNull();
    expect(document.activeElement).toBe(tab.middle());
  });

  it('stays while a drag would close the panel, and through a drag brought back', async () => {
    layout.setState({ left: { open: true }, threads: { open: false } });
    row.setState({ width: 1440 });
    const tab = render();
    tab.focus('left');
    await settle(() => row.setState({ drag: { edge: 'left', width: 120, closing: true } }));
    // Drawn 0 px wide, not taken off the page, so it keeps focus.
    expect(tab.left()?.style.width).toBe('0px');
    expect(tab.left()?.className).toContain('overflow-hidden');
    expect(document.activeElement?.textContent).toBe('a.ts');
    await settle(() => row.setState({ drag: undefined }));
    expect(tab.left()?.style.width).toBe('300px');
    expect(document.activeElement?.textContent).toBe('a.ts');
  });

  it('lays out what the panel holds at its last width while a drag would close it', async () => {
    layout.setState({ left: { open: true }, threads: { open: false } });
    row.setState({ width: 1440 });
    const tab = render();
    const held = () => tab.left()?.querySelector<HTMLElement>(':scope > div');
    await settle(() => row.setState({ drag: { edge: 'left', width: 240, closing: false } }));
    expect(tab.left()?.style.width).toBe('240px');
    expect(held()?.style.width).toBe('');
    await settle(() => row.setState({ drag: { edge: 'left', width: 120, closing: true } }));
    expect(tab.left()?.style.width).toBe('0px');
    expect(held()?.style.width).toBe('240px');
    await settle(() => row.setState({ drag: { edge: 'left', width: 260, closing: false } }));
    expect(held()?.style.width).toBe('');
  });

  it('goes back to the middle view as a drag that closes the panel is let go', async () => {
    layout.setState({ left: { open: false }, threads: { open: true } });
    row.setState({ width: 1440 });
    const tab = render();
    tab.focus('right');
    await settle(() => row.setState({ drag: { edge: 'threads', width: 120, closing: true } }));
    // As the edge's `onClose` does.
    await settle(() => {
      row.setState({ drag: undefined });
      closePanel('threads');
    });
    expect(tab.right()).toBeNull();
    expect(document.activeElement).toBe(tab.middle());
  });

  it('stays where it is when it’s elsewhere as a panel goes', async () => {
    layout.setState({ left: { open: true }, threads: { open: true } });
    row.setState({ width: 1440 });
    const tab = render();
    tab.focus('left');
    await settle(() => togglePanel('threads'));
    expect(document.activeElement?.textContent).toBe('a.ts');
  });
});

describe('a panel arriving', () => {
  it('fades in when it’s asked for, or put back by Reset layout', async () => {
    layout.setState({ left: { open: false }, threads: { open: false } });
    row.setState({ width: 1440 });
    const tab = render();
    await settle(() => askPanel('threads'));
    expect(tab.right()?.classList.contains('move-swap')).toBe(true);
    await settle(() => resetLayout());
    expect(tab.left()?.classList.contains('move-swap')).toBe(true);
  });

  it('fades in back as its key closes the other panel, but not as a drag closes it', async () => {
    layout.setState({ left: { open: true }, threads: { open: true } });
    row.setState({ width: 720 });
    const tab = render();
    await settle(() => askPanel('threads'));
    expect(tab.left()).toBeNull();
    await settle(() => togglePanel('threads'));
    expect(tab.left()?.classList.contains('move-swap')).toBe(true);
    await settle(() => askPanel('threads'));
    expect(tab.left()).toBeNull();
    // As the edge's `onClose` does.
    await settle(() => {
      row.setState({ drag: undefined });
      closePanel('threads');
    });
    expect(tab.left()?.classList.contains('move-swap')).toBe(false);
  });

  it('is just there back from being put away, as the window widens', async () => {
    layout.setState({ left: { open: true }, threads: { open: true } });
    row.setState({ width: 720 });
    const tab = render();
    expect(tab.right()).toBeNull();
    await settle(() => row.setState({ width: 1440 }));
    expect(tab.right()?.classList.contains('move-swap')).toBe(false);
    expect(tab.left()?.classList.contains('move-swap')).toBe(false);
  });

  it('is just there once the one asked for couldn’t be drawn, when the window widens later', async () => {
    layout.setState({ left: { open: false }, threads: { open: false } });
    row.setState({ width: 600 });
    const tab = render();
    // Too cramped to draw: asked for, it opens in the layout, but isn't drawn.
    await settle(() => askPanel('threads'));
    expect(tab.right()).toBeNull();
    await act(() => new Promise((done) => requestAnimationFrame(() => done(undefined))));
    await settle(() => row.setState({ width: 1440 }));
    expect(tab.right()?.classList.contains('move-swap')).toBe(false);
  });
});
