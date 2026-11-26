// A review thread's bubble: the mark beside the last line of a thread, or of several, in the code's
// gutter, as an icon that says what the thread is, in amber while it's unresolved or pending and in
// grey once it's resolved or out of date, and as a control that opens or collapses it. The lane
// beside the lines draws it (`lanes.ts`), and a file's header draws a file's own threads' bubble.

import { iconElement } from '../iconElement.ts';
import type { IconName } from '../icons.ts';
import { type ThreadMark, type ThreadView, viewControls } from './api.ts';

/** A mark's colour: amber while its thread is unresolved or pending, grey otherwise. */
export type LaneTone = 'warn' | 'quiet';

/** What a bubble's tooltip says a click does: the thread's command, by what it would do. */
export const COLLAPSE_THREAD = 'Collapse thread';
export const EXPAND_THREAD = 'Expand thread';

/** The bubble beside a line where threads end: one thread's, or several's. */
export interface Bubble {
  readonly icon: IconName;
  readonly tone: LaneTone;
  /** What a screen reader hears it as: what the threads are, and where. */
  readonly name: string;
  /** The thread a click opens or collapses: the first of those there. */
  readonly thread: string;
}

/** A thread as its mark shows it: what the caller said of it, unresolved on one line without. */
function markOf(thread: ThreadView): ThreadMark {
  return thread.mark ?? { resolved: false, words: { lines: '', line: '' } };
}

/** Whether a thread's mark is amber: it's unresolved or pending, and not out of date. */
function warns(mark: ThreadMark): boolean {
  return !mark.outdated && (!mark.resolved || mark.pending !== undefined);
}

/** The colour of a thread's bracket: amber while it's unresolved or pending. */
export function rangeTone(thread: ThreadView): LaneTone {
  return warns(markOf(thread)) ? 'warn' : 'quiet';
}

/** What a thread is, in words, before where it is. */
function kind(mark: ThreadMark): string {
  if (mark.pending !== undefined) return 'Pending thread';
  return mark.resolved ? 'Resolved thread' : 'Unresolved thread';
}

/** Words joined as a mark's name joins them, leaving out what's empty. */
function joined(...words: readonly string[]): string {
  return words.filter((word) => word !== '').join(' · ');
}

/**
 * The bubble beside a line where `threads` end, in their order: its icon, colour and name. One
 * thread's says what it is: `message-square` unresolved, `message-square-check` resolved,
 * `message-square-dot` holding comments not yet sent, grey once it's resolved or out of date, and
 * amber while all of it is pending. Several are `messages-square`, amber while any is unresolved
 * or pending. No digits: the count is in its name, and in the file's header.
 */
export function bubbleOf(threads: readonly ThreadView[]): Bubble {
  const first = threads[0]!;
  const marks = threads.map(markOf);
  if (threads.length > 1) {
    const unresolved = marks.filter((mark) => !mark.resolved).length;
    const where = marks[0]!.words.line;
    return {
      icon: 'messages-square',
      tone: marks.some(warns) ? 'warn' : 'quiet',
      name: joined(
        `${threads.length} threads`,
        where,
        unresolved > 0 ? `${unresolved} unresolved` : '',
      ),
      thread: first.id,
    };
  }
  const mark = marks[0]!;
  const icon: IconName =
    mark.pending !== undefined
      ? 'message-square-dot'
      : mark.resolved
        ? 'message-square-check'
        : 'message-square';
  const amber = !mark.outdated && (!mark.resolved || mark.pending === 'all');
  return {
    icon,
    tone: amber ? 'warn' : 'quiet',
    name: joined(kind(mark), mark.words.lines),
    thread: first.id,
  };
}

/** Whether two bubbles draw the same. */
export function sameBubble(a: Bubble | undefined, b: Bubble | undefined): boolean {
  if (!a || !b) return a === b;
  return a.icon === b.icon && a.tone === b.tone && a.name === b.name && a.thread === b.thread;
}

/** `element`'s colour, as its style has it now: reading it works its style out. */
function colourOf(element: Element): string {
  return getComputedStyle(element).color;
}

/** How a bubble is drawn: whether its thread is open, and what it's drawn after. */
export interface BubbleDrawing {
  /** Whether its thread is drawn open. */
  readonly open: boolean;
  /** Its element's own class, which places it. */
  readonly className: string;
  /** Whether a click runs the view's command; where it doesn't, its view runs the click itself. */
  readonly command?: boolean | undefined;
  /** The colour it was drawn in last, where that's changed: it tints from it to its own. */
  readonly was?: LaneTone | undefined;
  /**
   * Whether threads show beside lines: a click opens the thread's popover, or closes it, and the
   * pointer resting on it previews it, so it has no tooltip. Its name is heard, never shown.
   */
  readonly beside?: boolean | undefined;
}

/**
 * A bubble as a control: a click opens or collapses its thread, as `z a` does, and its tooltip
 * says which, with the key, or without one where the view runs the click itself. A screen reader
 * hears it as a button named for its threads, which says whether the thread is open. It's no stop
 * for `Tab`.
 */
export function bubbleElement(
  bubble: Bubble,
  { open, className, command = true, was, beside = false }: BubbleDrawing,
): HTMLElement {
  const control = document.createElement('span');
  const tone = `lo-bubble--${bubble.tone}`;
  const from = was === undefined || was === bubble.tone ? tone : `lo-bubble--${was}`;
  control.className = `${className} lo-bubble ${from} move-tint${open ? ' is-open' : ''}`;
  // Its colour, from the one it had: once it's on the page, its style is worked out in that
  // colour, which the tint then moves from as the class changes. A new element's first style has
  // no colour before it to move from.
  if (from !== tone) {
    requestAnimationFrame(() => {
      if (control.isConnected) colourOf(control);
      control.classList.replace(from, tone);
    });
  }
  control.setAttribute('role', 'button');
  control.setAttribute('aria-label', bubble.name);
  control.dataset.thread = bubble.thread;
  control.setAttribute('aria-expanded', String(open));
  if (beside) {
    control.dataset.command = viewControls.popover;
    control.dataset.beside = '';
  } else {
    if (command) control.dataset.command = viewControls.thread;
    control.dataset.tip = open ? COLLAPSE_THREAD : EXPAND_THREAD;
  }
  control.append(iconElement(bubble.icon, 14));
  return control;
}

/**
 * The colour each bubble was last drawn in, by a key of the caller's for where it's drawn, so a
 * bubble whose thread changes state tints from its old colour to its new one.
 */
export class Tones {
  readonly #last = new Map<string, LaneTone>();

  /** The colour the bubble at `key` had before `tone`, if it was another; `tone` is kept. */
  was(key: string, tone: LaneTone): LaneTone | undefined {
    const before = this.#last.get(key);
    this.#last.set(key, tone);
    return before === tone ? undefined : before;
  }
}
