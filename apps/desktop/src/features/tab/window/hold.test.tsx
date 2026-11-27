// @vitest-environment jsdom
import { Loading, LOADING_DELAY_MS, swapIn } from '@lo/ui';
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { useHold } from './hold.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** The frames asked for and not yet drawn. */
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;

/** Draws a frame: runs what was asked of it, as the window does before it paints. */
function frame(): void {
  const due = frames;
  frames = new Map();
  act(() => {
    for (const run of due.values()) run(performance.now());
  });
}

/** The moves running, as `getAnimations` gives them, each with what ends it. */
const running = new Map<Element, PromiseWithResolvers<void>>();

/** The moves on an element: a Swap runs until a test ends it, as it would for 90 ms. */
function animations(this: Element) {
  if (!this.classList.contains('move-swap')) return [];
  let move = running.get(this);
  if (!move) {
    move = Promise.withResolvers<void>();
    running.set(this, move);
  }
  return [
    {
      finished: move.promise,
      finish: move.resolve,
      effect: { getComputedTiming: () => ({ iterations: 1 }) },
    },
  ];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    frames.set(nextFrame, run);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Reflect.set(Element.prototype, 'getAnimations', animations);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  frames = new Map();
  running.clear();
});

/** Ends the Swap on `element`, as the move's end does. */
async function endMove(element: Element): Promise<void> {
  running.get(element)?.resolve();
  element.dispatchEvent(new Event('animationend'));
  await act(async () => {
    await Promise.resolve();
  });
}

const ALL = ['overview', 'diff', 'timeline'];

interface Props {
  readonly want: readonly string[];
  /** The views that have nothing to draw yet. */
  readonly loading?: readonly string[];
  readonly holds?: boolean;
}

/** A tab's middle views, each as the hold draws it, the one coming swapped in over the one left. */
function Middle({ want, loading = [], holds = true }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const viewOf = (id: string) => row.current?.querySelector(`[data-view="${id}"]`) ?? null;
  const drawnOf = useHold(want, {
    holds,
    element: viewOf,
    swap: (came) =>
      came.flatMap((id) => {
        const element = viewOf(id);
        if (!(element instanceof HTMLElement)) return [];
        swapIn(element);
        return [element];
      }),
  });
  return (
    <div ref={row}>
      {ALL.map((id) => (
        <div key={id} data-view={id} data-drawn={drawnOf(id)}>
          {loading.includes(id) ? <Loading status="Reading…" /> : id}
        </div>
      ))}
    </div>
  );
}

function render(props: Props) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Middle {...props} />));
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  const view = (id: string) => container.querySelector(`[data-view="${id}"]`)!;
  return {
    show: (next: Props) => act(() => root.render(<Middle {...next} />)),
    view,
    drawn: (id: string) => view(id).getAttribute('data-drawn'),
  };
}

describe('a switch of the middle view', () => {
  it('keeps the view it leaves on screen until the one it shows has laid out, a frame on', () => {
    const middle = render({ want: ['overview'] });
    expect(middle.drawn('overview')).toBe('seen');
    middle.show({ want: ['diff'], loading: ['diff'] });
    expect(middle.drawn('overview')).toBe('under');
    expect(middle.drawn('diff')).toBe('coming');
    frame();
    expect(middle.drawn('diff')).toBe('coming');
    // Its files drawn, it comes in the next frame, over the overview.
    middle.show({ want: ['diff'] });
    expect(middle.drawn('diff')).toBe('coming');
    frame();
    expect(middle.drawn('diff')).toBe('seen');
    expect(middle.drawn('overview')).toBe('under');
    expect(middle.drawn('timeline')).toBe('hidden');
  });

  it('fades the view it shows in over the one it leaves, which goes once the move has run', async () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['diff'] });
    frame();
    const diff = middle.view('diff');
    expect(diff.classList.contains('move-swap')).toBe(true);
    // Under it, drawn, for the whole move.
    frame();
    expect(middle.drawn('overview')).toBe('under');
    await endMove(diff);
    expect(middle.drawn('overview')).toBe('hidden');
    expect(diff.classList.contains('move-swap')).toBe(false);
  });

  it('shows a view that hasn’t laid out once a wait shows its loading state, and never later', () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['timeline'], loading: ['timeline'] });
    act(() => {
      vi.advanceTimersByTime(LOADING_DELAY_MS - 1);
    });
    frame();
    expect(middle.drawn('timeline')).toBe('coming');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(middle.drawn('timeline')).toBe('seen');
    expect(middle.view('timeline').querySelector('[role="status"]')).not.toBeNull();
  });

  it('counts the wait from the first key, as another switch is made while it holds', () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['diff'], loading: ['diff'] });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    middle.show({ want: ['timeline'], loading: ['timeline'] });
    expect(middle.drawn('overview')).toBe('under');
    expect(middle.drawn('diff')).toBe('hidden');
    expect(middle.drawn('timeline')).toBe('coming');
    act(() => {
      vi.advanceTimersByTime(LOADING_DELAY_MS - 200);
    });
    expect(middle.drawn('timeline')).toBe('seen');
  });

  it('puts the view it left back as it was when that view is asked for again meanwhile', () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['diff'], loading: ['diff'] });
    middle.show({ want: ['overview'], loading: ['diff'] });
    expect(middle.drawn('overview')).toBe('seen');
    expect(middle.drawn('diff')).toBe('hidden');
    expect(middle.view('overview').classList.contains('move-swap')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(LOADING_DELAY_MS);
    });
    expect(middle.drawn('overview')).toBe('seen');
  });

  it('ends the last switch’s move where it ends as the next begins, with nothing left under', async () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['diff'] });
    frame();
    const diff = middle.view('diff');
    expect(diff.classList.contains('move-swap')).toBe(true);
    middle.show({ want: ['timeline'], loading: ['timeline'] });
    expect(middle.drawn('overview')).toBe('hidden');
    expect(middle.drawn('diff')).toBe('under');
    // The diff's fade ended, so it's drawn whole under the timeline as that lays out.
    await act(async () => {
      await running.get(diff)?.promise;
    });
    diff.dispatchEvent(new Event('animationend'));
    expect(diff.classList.contains('move-swap')).toBe(false);
    expect(middle.drawn('diff')).toBe('under');
  });

  it('shows at once a view that only comes, as the code beside, or only goes', () => {
    const middle = render({ want: ['overview'] });
    middle.show({ want: ['overview', 'diff'], loading: ['diff'] });
    expect(middle.drawn('overview')).toBe('seen');
    expect(middle.drawn('diff')).toBe('seen');
    middle.show({ want: ['diff'] });
    expect(middle.drawn('overview')).toBe('hidden');
    expect(middle.drawn('diff')).toBe('seen');
  });

  it('holds nothing while the views aren’t drawn', () => {
    const middle = render({ want: ['overview'], holds: false });
    middle.show({ want: ['diff'], loading: ['diff'], holds: false });
    expect(middle.drawn('overview')).toBe('hidden');
    expect(middle.drawn('diff')).toBe('seen');
  });
});
