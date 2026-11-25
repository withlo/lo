// @vitest-environment jsdom
// The pieces every move is made of: the one switch that turns them off, what a popup does the
// moment it's asked to close, the Open and Swap moves, where a jump lands, scrolling a pane and a
// dialog growing.

import { act, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { missingRules } from '../test/classes.ts';
import { cleanUp, click, render, rerender } from '../test/dom.ts';
import { Collapse, Swap } from './Collapse.tsx';
import { Dialog } from './Dialog.tsx';
import {
  giveFocusBack,
  land,
  LAND_CLASS,
  motion,
  motionReduced,
  setMotion,
  setTheme,
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

describe('a change of theme', () => {
  it('holds every transition off for the frame that draws the new colors', () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (next: () => void) => frames.push(next));
    const root = document.documentElement;
    setTheme('light');
    expect(root.dataset.theme).toBe('light');
    expect(root.hasAttribute('data-lo-theming')).toBe(true);
    // The frame that draws the new colors, then the one after it.
    frames.shift()?.();
    expect(root.hasAttribute('data-lo-theming')).toBe(true);
    frames.shift()?.();
    expect(root.hasAttribute('data-lo-theming')).toBe(false);
    // The theme it's in already changes nothing.
    setTheme('light');
    expect(root.hasAttribute('data-lo-theming')).toBe(false);
    expect(frames).toEqual([]);
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

/** A box that keeps what it holds, naming it `id`. */
function keeping(id: string | undefined) {
  return (
    <Swap id={id} keep className="box">
      <p>{id ?? 'nothing yet'}</p>
    </Swap>
  );
}

describe('Swap', () => {
  it('fades in what replaces what it showed, in the same box, and not what it first shows', () => {
    const host = render(<Swap id="loading">Loading</Swap>);
    expect(host.firstElementChild?.classList.contains('move-swap')).toBe(false);
    rerender(host, <Swap id="diff">The diff</Swap>);
    expect(host.firstElementChild?.classList.contains('move-swap')).toBe(true);
    expect(host.textContent).toBe('The diff');
  });

  it('with keep, fades the same box in as what it names changes, drawing nothing anew', () => {
    const host = render(keeping(undefined));
    const box = host.firstElementChild!;
    const kept = box.firstElementChild;
    // What it first names, after naming nothing, is just there.
    rerender(host, keeping('overview'));
    expect(box.classList.contains('move-swap')).toBe(false);
    rerender(host, keeping('diff'));
    expect(host.firstElementChild).toBe(box);
    expect(box.firstElementChild).toBe(kept);
    expect(box.textContent).toBe('diff');
    expect(box.classList.contains('move-swap')).toBe(true);
    // Once it has run, the box's classes are React's again.
    box.dispatchEvent(new Event('animationend'));
    expect(box.className).toBe('box');
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

describe('a dialog that grows', () => {
  it('clips its body until it has grown, rather than scrolling it', async () => {
    let measured: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          measured = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    setMotion('full');
    render(
      <Dialog open onOpenChange={() => {}} title="Sign in to GitHub">
        <p>Open GitHub and enter the code.</p>
      </Dialog>,
    );
    const panel = document.querySelector<HTMLElement>('[data-lo-scope="dialog"]');
    const body = document.querySelector('p')?.parentElement;
    if (!panel || !body) throw new Error('no dialog');
    let height = 200;
    Object.defineProperty(panel, 'offsetHeight', { get: () => height });
    const { promise: finished, resolve: done } = Promise.withResolvers<void>();
    const animate = vi.fn<() => { finished: Promise<void> }>(() => ({ finished }));
    Object.defineProperty(panel, 'animate', { value: animate });
    act(() => measured?.());
    // The next step is taller, and the body was scrolled.
    height = 320;
    body.scrollTop = 40;
    act(() => measured?.());
    expect(animate).toHaveBeenCalledWith({ height: ['200px', '320px'] }, expect.anything());
    expect(panel.hasAttribute('data-growing')).toBe(true);
    expect(body.style.overflow).toBe('clip');
    expect(body.scrollTop).toBe(0);
    await act(async () => {
      done();
      await finished;
    });
    expect(panel.hasAttribute('data-growing')).toBe(false);
    expect(body.style.overflow).toBe('');
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
