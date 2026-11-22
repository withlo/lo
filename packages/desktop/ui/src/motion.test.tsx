// @vitest-environment jsdom
// The pieces every move is made of: the one switch that turns them off, what a popup does the
// moment it's asked to close, the Open and Swap moves, where a jump lands, and scrolling a pane.

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render, rerender } from '../test/dom.ts';
import { Collapse, Swap } from './Collapse.tsx';
import {
  giveFocusBack,
  land,
  LAND_CLASS,
  motion,
  motionReduced,
  setMotion,
  useHeld,
  useMotionReduced,
  useOnClose,
} from './motion.ts';
import { reveal, scrollPane } from './reveal.ts';
import { SegmentedControl } from './SegmentedControl.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  setMotion('system');
  vi.unstubAllGlobals();
});

function Says() {
  return <p>{useMotionReduced() ? 'still' : 'moving'}</p>;
}

describe('the one switch', () => {
  it('follows the system until it’s set, and then says what it was set to', () => {
    const system = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('matchMedia', () => system);
    expect(motion()).toBe('system');
    expect(motionReduced()).toBe(true);
    setMotion('full');
    expect(document.documentElement.getAttribute('data-lo-motion')).toBe('full');
    expect(motionReduced()).toBe(false);
    setMotion('reduce');
    expect(motionReduced()).toBe(true);
    setMotion('system');
    expect(document.documentElement.hasAttribute('data-lo-motion')).toBe(false);
  });

  it('tells what moves from a script as it changes', () => {
    const host = render(<Says />);
    expect(host.textContent).toBe('moving');
    act(() => setMotion('reduce'));
    expect(host.textContent).toBe('still');
  });
});

describe('a popup asked to close', () => {
  it('says so at once, and keeps what it showed', () => {
    const closed = vi.fn<() => void>();
    function Popup({ open, words }: { open: boolean; words: string }) {
      useOnClose(open, closed);
      return <p>{useHeld(open, words)}</p>;
    }
    const host = render(<Popup open words="Merge #264" />);
    expect(closed).not.toHaveBeenCalled();
    // The caller clears what it showed as it closes; the popup fades with its last words.
    rerender(host, <Popup open={false} words="" />);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('Merge #264');
    rerender(host, <Popup open words="Close #264" />);
    expect(host.textContent).toBe('Close #264');
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('gives focus back from the popup, and leaves focus that went elsewhere by itself', () => {
    const host = render(
      <>
        <button id="opener">Open</button>
        <button id="other">Other</button>
        <div id="popup">
          <button id="inside">Inside</button>
        </div>
      </>,
    );
    const find = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!;
    find('inside').focus();
    giveFocusBack(find('opener'), find('popup'));
    expect(document.activeElement).toBe(find('opener'));
    find('other').focus();
    giveFocusBack(find('opener'), find('popup'));
    expect(document.activeElement).toBe(find('other'));
  });
});

function Reply() {
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState(0);
  return (
    <>
      <button onClick={() => setOpen((was) => !was)}>Reply</button>
      <Collapse open={open} onGone={() => setGone((count) => count + 1)}>
        {open && <p>Write a reply</p>}
      </Collapse>
      <output>{gone}</output>
    </>
  );
}

describe('Collapse', () => {
  it('draws nothing while closed, moves as it opens, and is gone once it has closed', () => {
    const host = render(<Reply />);
    expect(host.querySelector('.move-open')).toBeNull();
    click(host.querySelector('button')!);
    const box = host.querySelector('.move-open')!;
    expect(box.textContent).toBe('Write a reply');
    expect(box.hasAttribute('data-appear')).toBe(true);
    expect(box.hasAttribute('inert')).toBe(false);
    click(host.querySelector('button')!);
    // jsdom runs no transitions, so it has gone by now, and said so once.
    expect(host.querySelector('.move-open')).toBeNull();
    expect(host.querySelector('output')?.textContent).toBe('1');
  });

  it('is just there when it’s open as its view first draws', () => {
    const host = render(
      <Collapse open>
        <p>Already here</p>
      </Collapse>,
    );
    expect(host.querySelector('.move-open')?.hasAttribute('data-appear')).toBe(false);
    cleanUp();
    const moving = render(
      <Collapse open appear>
        <p>Just came</p>
      </Collapse>,
    );
    expect(moving.querySelector('.move-open')?.hasAttribute('data-appear')).toBe(true);
  });
});

describe('Swap', () => {
  it('fades in what replaces what it showed, in the same box, and not what it first shows', () => {
    const host = render(<Swap id="loading">Loading</Swap>);
    expect(host.firstElementChild?.classList.contains('move-swap')).toBe(false);
    rerender(host, <Swap id="diff">The diff</Swap>);
    expect(host.firstElementChild?.classList.contains('move-swap')).toBe(true);
    expect(host.textContent).toBe('The diff');
  });
});

describe('land', () => {
  it('marks one target at a time, and takes the mark off when its fade ends', () => {
    const host = render(
      <>
        <p id="one">One</p>
        <p id="two">Two</p>
      </>,
    );
    const one = host.querySelector('#one')!;
    const two = host.querySelector('#two')!;
    land(one);
    expect(one.classList.contains(LAND_CLASS)).toBe(true);
    // A jump made again before the last has faded, as a held key does, moves the mark.
    land(two);
    expect(one.classList.contains(LAND_CLASS)).toBe(false);
    expect(two.classList.contains(LAND_CLASS)).toBe(true);
    two.dispatchEvent(new Event('animationend'));
    expect(two.classList.contains(LAND_CLASS)).toBe(false);
  });
});

/**
 * A pane 100 high, holding 1000, inside a page that scrolls too, with a row 20 high, 300 down the
 * pane. The row is in a box that scrolls only sideways: one whose `overflow-x` is `auto` computes
 * `overflow-y: auto` as well, but holds no more than its height.
 */
function panes() {
  const host = render(
    <div id="page" style={{ overflowY: 'auto' }}>
      <div id="pane" style={{ overflowY: 'auto' }}>
        <div id="wide" style={{ overflowX: 'auto', overflowY: 'auto' }}>
          <p id="row">Row</p>
        </div>
      </div>
    </div>,
  );
  const page = host.querySelector<HTMLElement>('#page')!;
  const pane = host.querySelector<HTMLElement>('#pane')!;
  const wide = host.querySelector<HTMLElement>('#wide')!;
  const row = host.querySelector<HTMLElement>('#row')!;
  Object.defineProperty(page, 'clientHeight', { value: 200 });
  Object.defineProperty(page, 'scrollHeight', { value: 1200 });
  Object.defineProperty(pane, 'clientHeight', { value: 100 });
  Object.defineProperty(pane, 'scrollHeight', { value: 1000 });
  Object.defineProperty(wide, 'clientHeight', { value: 20 });
  Object.defineProperty(wide, 'scrollHeight', { value: 20 });
  pane.getBoundingClientRect = () => new DOMRect(0, 50, 200, 100);
  row.getBoundingClientRect = () => new DOMRect(0, 50 + 300 - pane.scrollTop, 200, 20);
  return { page, pane, wide, row };
}

describe('reveal', () => {
  it('scrolls the pane the element is in, and nothing around it', () => {
    const { page, pane, wide, row } = panes();
    expect(scrollPane(row)).toBe(pane);
    reveal(row, { block: 'start' });
    expect(pane.scrollTop).toBe(300);
    expect(wide.scrollTop).toBe(0);
    expect(page.scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
    // A jump marks where it landed.
    expect(row.classList.contains(LAND_CLASS)).toBe(true);
  });

  it('moves as little as it can to keep a cursor in view, and doesn’t mark it', () => {
    const { pane, row } = panes();
    reveal(row);
    // Its bottom edge comes to the pane's.
    expect(pane.scrollTop).toBe(220);
    expect(row.classList.contains(LAND_CLASS)).toBe(false);
    // In view already, nothing moves.
    reveal(row);
    expect(pane.scrollTop).toBe(220);
    reveal(row, { block: 'center' });
    expect(pane.scrollTop).toBe(260);
  });
});

/** The middle view's switch, with a new array of its segments each time it's drawn. */
const views = (value: 'overview' | 'diff') => (
  <SegmentedControl
    label="View"
    kind="views"
    items={[
      { value: 'overview', label: 'Overview' },
      { value: 'diff', label: 'Diff' },
    ]}
    value={value}
    onChange={() => {}}
  />
);

describe('a thumb', () => {
  it('watches its segments once, however often its caller draws them anew', () => {
    let watchers = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor() {
          watchers += 1;
        }
        observe() {}
        disconnect() {}
      },
    );
    const host = render(views('overview'));
    rerender(host, views('overview'));
    rerender(host, views('overview'));
    expect(watchers).toBe(1);
    // Another segment chosen is measured afresh.
    rerender(host, views('diff'));
    expect(watchers).toBe(2);
  });
});

describe('the styles', () => {
  it('have a rule for each move', async () => {
    const host = render(<p />);
    const moves = [
      'move-tint',
      'move-pop',
      'move-pop-down',
      'move-sheet',
      'move-scrim',
      'move-scrim-fast',
      'move-open',
      'move-slide',
      'move-swap',
      LAND_CLASS,
    ];
    expect(await missingRules(host, moves)).toEqual([]);
  });
});
