// The bench's readings inside the page, installed with `page.evaluate(installRecorder)` once the
// pull request has loaded. Every frame it notes when the frame began, from `requestAnimationFrame`,
// and then, once the frame's layout is done and before it's painted, what the frame shows:
//
// - how level the rows on screen are, from the view's probe: the on-screen top of every row with
//   something on both sides, headers and collapsed blocks included, on each side;
// - what on screen isn't drawn: a row drawn on one side only, a stretch of either editor's content
//   CodeMirror hasn't drawn (its gaps, and the blocks of lines the view forgot), and how far the
//   scroll ran past what the last frame drew, which the compositor scrolls into before the page
//   draws again.
//
// The readings run in a ResizeObserver's callback, which comes after the frame's animation frame
// callbacks, CodeMirror's measuring and the spacer pass among them, and after layout, and before
// paint: a small hidden element changes size every frame to call it. It also keeps Long Animation
// Frames entries while recording, and the Event Timing API's entries for keys all the time.
//
// `installRecorder` runs in the page, so it uses nothing from outside itself but the two helpers
// it's given, `coverage` and `ranPast`, which `recorderSource` sends with it.

import type { Probe } from '@lo/ui/code';

import type { Marks } from '../src/window/marks.ts';

/** What the recorder noted in each frame, one array per reading, a frame at each index. */
export interface Frames {
  /** When each frame began, from `requestAnimationFrame`. */
  start: number[];
  /** How far apart the worst pair of rows on screen start, in px; 0 in the inline layout. */
  worst: number[];
  /** Rows with something on both sides on screen. */
  rows: number[];
  /** Rows on screen drawn on one side only. */
  oneSided: number[];
  /** How much of the screen, in px, either editor's content leaves undrawn. */
  undrawn: number[];
  /** How far the scroll ran past what the frame before had drawn beyond the screen, in px. */
  past: number[];
  /** How far both editors draw, unbroken, beyond the screen, the shorter of the two, in px. */
  above: number[];
  below: number[];
  /** How long the readings themselves took, in ms. */
  readMs: number[];
  scrollTop: number[];
}

/** A frame that took over 50 ms, as Long Animation Frames reports it. */
export interface LongFrameEntry {
  start: number;
  duration: number;
  blocking: number;
  renderStart: number;
  styleAndLayoutStart: number;
  scripts: { invoker: string; source: string; duration: number; forcedLayout: number }[];
}

/** A key the Event Timing API reported. */
export interface KeyEntry {
  name: string;
  /** When the key was pressed, the event's own time. */
  start: number;
  /** From then to the next paint after its handlers ran, rounded to 8 ms. */
  duration: number;
  processingStart: number;
  processingEnd: number;
}

export interface Recording {
  frames: Frames;
  longFrames: LongFrameEntry[];
}

/** What the recorder offers the bench, as `window.perfBench`. */
export interface Recorder {
  /** The page's clock, which every time here is on. */
  now(): number;
  /**
   * Starts noting every frame, from nothing. With `wheel`, the scroll comes from the wheel, which
   * the compositor scrolls by itself, so how far it ran past what was drawn counts too. Keys
   * scroll from script, on the main thread, and the frame that scrolls draws what it scrolls to.
   */
  start(wheel: boolean): void;
  /** Stops, and hands over what it noted. */
  stop(): Recording;
  /** The keys reported since `since`, on the page's clock. */
  keys(since: number): KeyEntry[];
  /** The time between frames over the next `ms`, at the median: about 16.7 ms when the display is awake. */
  frameRate(ms: number): Promise<{ median: number; frames: number }>;
  /** Waits for the frame after the next one to begin: whatever was asked for before is painted. */
  painted(): Promise<void>;
}

declare global {
  interface Window {
    diffView: Probe;
    diffLoaded?: boolean;
    perfMarks?: Marks;
    perfBench?: Recorder;
  }
}

/** A block an editor's content draws, on screen, and whether it shows nothing. */
export interface Block {
  top: number;
  bottom: number;
  blank: boolean;
}

/** What an editor draws around the screen. */
export interface Coverage {
  /** How many px of the screen inside its content it leaves undrawn. */
  undrawn: number;
  /** How far what it draws runs on, unbroken, above the screen's top and below its bottom. */
  above: number;
  below: number;
}

/**
 * What an editor's content, `count` blocks in order from the top, `blockAt` each, draws around a
 * screen from `top` to `bottom`. A run of drawn blocks to the start or end of the content counts
 * as `reach`, since nothing more can come there; so does anything past `reach`.
 */
export function coverage(
  count: number,
  blockAt: (index: number) => Block,
  top: number,
  bottom: number,
  reach: number,
): Coverage {
  // The first block that ends below the top of the screen.
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (blockAt(middle).bottom > top) high = middle;
    else low = middle + 1;
  }
  let undrawn = 0;
  let below = 0;
  let open = true;
  let index = low;
  for (; index < count; index++) {
    const block = blockAt(index);
    if (block.top >= bottom + reach) break;
    if (block.top < bottom && block.blank) {
      undrawn += Math.max(0, Math.min(block.bottom, bottom) - Math.max(block.top, top));
    }
    if (block.bottom > bottom && open) {
      if (block.blank) open = false;
      else below += block.bottom - Math.max(block.top, bottom);
    }
    if (!open && block.top >= bottom) break;
  }
  if (open && index >= count) below = reach;
  let above = 0;
  let back = Math.min(low, count) - 1;
  // The block across the top of the screen, if any, then the ones above it.
  if (low < count && blockAt(low).top < top) back = low;
  for (; back >= 0 && above < reach; back--) {
    const block = blockAt(back);
    if (block.blank) break;
    above += Math.min(block.bottom, top) - block.top;
    if (back === 0) above = reach;
  }
  if (back < 0 && above < reach && low === 0) above = reach;
  return { undrawn, above: Math.min(above, reach), below: Math.min(below, reach) };
}

/**
 * How far the scroll ran past what the last frame drew, in px: the compositor scrolls `ran` px
 * (down when positive) between the last frame and this one, showing what the last frame drew,
 * which ran on `drawn.above` and `drawn.below` px beyond the screen.
 */
export function ranPast(ran: number, drawn: { above: number; below: number }): number {
  return Math.max(0, ran > 0 ? ran - drawn.below : -ran - drawn.above);
}

/** The helpers `installRecorder` is given. */
export interface Helpers {
  coverage: typeof coverage;
  ranPast: typeof ranPast;
}

/** The script that installs the recorder in the page, with its helpers. */
export function recorderSource(): string {
  return `(${installRecorder.toString()})({ coverage: ${coverage.toString()}, ranPast: ${ranPast.toString()} })`;
}

/**
 * Installs `window.perfBench`. It's sent to the page as its source, so whatever it uses is inside
 * it, even what could be outside.
 */
/* oxlint-disable unicorn/consistent-function-scoping */
export function installRecorder({ coverage: cover, ranPast: past }: Helpers): void {
  if (window.perfBench) return;
  const scroller = document.querySelector<HTMLElement>('.lo-diffview');
  if (!scroller) throw new Error('The page has no diff view.');
  const contentOf = (label: string): HTMLElement | null =>
    scroller.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);

  /** How far past the screen to look for what's drawn: more than CodeMirror draws beyond it. */
  const reach = 4000;

  const empty = (): Frames => ({
    start: [],
    worst: [],
    rows: [],
    oneSided: [],
    undrawn: [],
    past: [],
    above: [],
    below: [],
    readMs: [],
    scrollTop: [],
  });
  let frames = empty();
  let longFrames: LongFrameEntry[] = [];
  let keys: KeyEntry[] = [];
  let recording = false;
  let wheel = false;
  /** When this frame began, and where the scroll was then, before the page moved it. */
  let frame: { start: number; scrollTop: number } | undefined;
  /** What the last frame drew beyond the screen, above and below, and where its scroll ended. */
  let last: { above: number; below: number; scrollTop: number } | undefined;

  /** Whether a child of an editor's content shows nothing: CodeMirror's gap or a forgotten block. */
  const blank = (element: Element): boolean =>
    element.classList.contains('cm-gap') ||
    (element.className === '' && element.childElementCount === 0 && !element.textContent);

  /** What one editor's content draws around the screen. */
  const drawnAround = (content: HTMLElement, top: number, bottom: number) => {
    const children = content.children;
    return cover(
      children.length,
      (index) => {
        const child = children[index]!;
        const box = child.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, blank: blank(child) };
      },
      top,
      bottom,
      reach,
    );
  };

  const read = (): void => {
    const begun = frame;
    frame = undefined;
    if (!recording || !begun) return;
    const started = performance.now();
    const box = scroller.getBoundingClientRect();
    const top = box.top;
    const bottom = box.top + scroller.clientHeight;
    const split = window.diffView.layout === 'split';
    const level = split ? window.diffView.misalignment() : { rows: 0, worst: 0, blank: 0 };
    const contents = (split ? [contentOf('Before'), contentOf('After')] : [contentOf('Changes')])
      .filter((content) => content !== null)
      .map((content) => drawnAround(content, top, bottom));
    const undrawn = Math.max(0, ...contents.map((seen) => seen.undrawn));
    // The compositor scrolls from where the last frame left the scroll to where this one began,
    // showing what the last frame drew, so further than that drew is blank on screen.
    const ranOn = wheel && last ? past(begun.scrollTop - last.scrollTop, last) : 0;
    last = {
      above: Math.min(...contents.map((seen) => seen.above)),
      below: Math.min(...contents.map((seen) => seen.below)),
      scrollTop: scroller.scrollTop,
    };
    frames.start.push(begun.start);
    frames.worst.push(level.worst);
    frames.rows.push(level.rows);
    frames.oneSided.push(level.blank);
    frames.undrawn.push(undrawn);
    frames.past.push(ranOn);
    frames.above.push(last.above);
    frames.below.push(last.below);
    frames.scrollTop.push(scroller.scrollTop);
    frames.readMs.push(performance.now() - started);
  };

  // The hidden element that changes size every frame, so the observer reads every frame.
  const ticker = document.createElement('div');
  ticker.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
  document.body.append(ticker);
  let wide = false;
  new ResizeObserver(read).observe(ticker);
  const tick = (start: number): void => {
    if (recording) {
      frame = { start, scrollTop: scroller.scrollTop };
      wide = !wide;
      ticker.style.width = wide ? '2px' : '1px';
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  new PerformanceObserver((list) => {
    if (!recording) return;
    for (const entry of list.getEntries()) longFrames.push(longFrameOf(entry));
  }).observe({ type: 'long-animation-frame' });
  // The Event Timing API's smallest threshold, which the DOM's types don't know yet.
  const keyOptions = { type: 'event', durationThreshold: 16 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!entry.name.startsWith('key') || !(entry instanceof PerformanceEventTiming)) continue;
      keys.push({
        name: entry.name,
        start: entry.startTime,
        duration: entry.duration,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
      });
    }
    // Only recent keys are asked for.
    if (keys.length > 20_000) keys = keys.slice(-10_000);
  }).observe(keyOptions);

  /** A Long Animation Frames entry's parts, read field by field: the DOM's types lack them. */
  function longFrameOf(entry: PerformanceEntry): LongFrameEntry {
    const number = (from: object, name: string): number => {
      const value: unknown = Reflect.get(from, name);
      return typeof value === 'number' ? value : 0;
    };
    const text = (from: object, name: string): string => {
      const value: unknown = Reflect.get(from, name);
      return typeof value === 'string' ? value : '';
    };
    const scripts: unknown = Reflect.get(entry, 'scripts');
    return {
      start: entry.startTime,
      duration: entry.duration,
      blocking: number(entry, 'blockingDuration'),
      renderStart: number(entry, 'renderStart'),
      styleAndLayoutStart: number(entry, 'styleAndLayoutStart'),
      scripts: (Array.isArray(scripts) ? scripts : [])
        .filter((script): script is object => typeof script === 'object' && script !== null)
        .map((script) => ({
          invoker: text(script, 'invoker'),
          source:
            `${text(script, 'sourceFunctionName')} ${text(script, 'sourceURL').replace(/^.*\//, '')}`.trim(),
          duration: number(script, 'duration'),
          forcedLayout: number(script, 'forcedStyleAndLayoutDuration'),
        }))
        .toSorted((a, b) => b.duration - a.duration)
        .slice(0, 3),
    };
  }

  const nextFrame = (): Promise<number> => new Promise((done) => requestAnimationFrame(done));

  window.perfBench = {
    now: () => performance.now(),
    start(byWheel) {
      wheel = byWheel;
      frames = empty();
      longFrames = [];
      frame = undefined;
      last = undefined;
      recording = true;
    },
    stop() {
      recording = false;
      return { frames, longFrames };
    },
    keys: (since) => keys.filter((entry) => entry.start >= since),
    frameRate(ms) {
      // A timer ends it, since frames stop coming while the display sleeps.
      return new Promise((done) => {
        const starts: number[] = [];
        let counting = true;
        const count = (start: number): void => {
          if (!counting) return;
          starts.push(start);
          requestAnimationFrame(count);
        };
        requestAnimationFrame(count);
        setTimeout(() => {
          counting = false;
          const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
          gaps.sort((a, b) => a - b);
          done({ median: gaps[gaps.length >> 1] ?? Infinity, frames: starts.length });
        }, ms);
      });
    },
    async painted() {
      await nextFrame();
      await nextFrame();
    },
  };
}
/* oxlint-enable unicorn/consistent-function-scoping */
