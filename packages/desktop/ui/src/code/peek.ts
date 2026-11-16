// A peek: code from elsewhere, shown in place under a line, as a definition is for `gd`. Around
// the code sits a frame the caller draws in the parts the peek makes: a head, the list of answers
// beside the code when there's more than one, and a foot. The code is the shown answer's lines,
// drawn read-only with their numbers and highlighting, its answer's line marked near the top, in a
// box of at most 15 lines that scrolls past the rest. The peek's height comes from its code's lines
// alone: its head and foot are as tall as the design has them, and its list as tall as the code
// beside it, so nothing the frame draws, nor a width that wraps the code anew, moves what's under
// it.
//
// The peek is a scope of its own, `peek`, whose keys are Lo's: it has no Vim and no cursor, and
// what a key there acts on is the line it's under. The keys that scroll, which none of Lo's take,
// scroll its code, never the view under it. It's one element, which outlives the blocks a view
// draws it in, as a thread's does, and moves into whichever draws it last.

import { WidgetType } from '@codemirror/view';

import { SCOPE_ATTRIBUTE, setScopeSource, type Target } from '../commands/index.ts';
import {
  PEEK_LINES,
  type Mode,
  type PeekAnswer,
  type PeekCode,
  type PeekFrame,
  type PeekParts,
  type PeekView,
  type Place,
} from './api.ts';
import { lineStarts, tokenClass, tokensFrom } from './highlight.ts';

/** How many lines show above the answer's, where the code has them, as a doc comment above it. */
const ABOVE = 4;

/** The fewest lines tall the code is beside a list of answers, which scrolls in its height. */
const LISTED = 6;

/** How tall the head and foot are, and the code's lines and the room around them, in pixels. */
const HEAD = 34;
const FOOT = 32;
const LINE = 20;
const PADDING = 8;

/** The room around a peek in the whole-file view, above and below it. */
const HOLDER = 16;

/** How many lines tall the code of `peek` is. */
export function peekLines(peek: PeekView): number {
  const lines = peek.code?.lines.length ?? 0;
  return Math.min(PEEK_LINES, Math.max(1, lines, peek.answers.length > 1 ? LISTED : 0));
}

/**
 * Where a peek's line goes, down from the top of a screen `height` tall, for the peek to show
 * whole: the line is `top` down from the top now, and the peek ends `below` under the line's top.
 * The least scroll ends the peek at the screen's foot. A peek taller than the room under the line
 * puts the line at the top, never above it. Undefined while the peek ends on screen, within half a
 * pixel, or the line is below the screen.
 */
export function peekShownAt(top: number, below: number, height: number): number | undefined {
  if (top >= height || top + below <= height + 0.5) return undefined;
  return Math.max(0, height - below);
}

/** A peek under a line, as a code view draws it. */
export class PeekBlock {
  readonly dom: HTMLElement;
  readonly #parts: PeekParts;
  readonly #body: HTMLElement;
  readonly #code: HTMLElement;
  /** The line it's under, as the caller gave it, which a key in it acts on. */
  readonly at: Place;
  #peek: PeekView;
  #frame: { update(peek: PeekView): void; destroy(): void } | undefined;
  readonly #stops: (() => void)[] = [];
  /** Focus left it as it moved into another block, and is on its way back. */
  #refocusing = false;
  /** Whether the code is still to be scrolled to its answer, once it's laid out. */
  #toScroll = true;
  /** How far its code and list were scrolled as it moved, which moving it loses, to put back. */
  #scrolled: { code: number; list: number } | undefined;
  readonly #laidOut: ResizeObserver;

  constructor(at: Place, peek: PeekView, frame: PeekFrame | undefined) {
    this.at = at;
    this.#peek = peek;
    this.dom = element('div', 'lo-diffpeek');
    this.dom.setAttribute(SCOPE_ATTRIBUTE, 'peek');
    this.dom.setAttribute('role', 'dialog');
    this.dom.tabIndex = -1;
    this.#parts = {
      head: element('div', 'lo-diffpeek__head'),
      list: element('div', 'lo-diffpeek__list'),
      foot: element('div', 'lo-diffpeek__foot'),
    };
    this.#body = element('div', 'lo-diffpeek__body');
    this.#code = element('div', 'lo-diffpeek__code');
    this.#body.append(this.#parts.list, this.#code);
    this.dom.append(this.#parts.head, this.#body, this.#parts.foot);
    // Without a frame there's nothing to draw around the code.
    for (const part of Object.values(this.#parts)) part.hidden = frame === undefined;
    this.#show(peek);
    this.#stops.push(setScopeSource(this.dom, this));
    this.dom.addEventListener('keydown', this.#scrollKey);
    // The code is scrolled to its answer once it has a size: not before it's in the page. Moved,
    // it's scrolled back where it was.
    this.#laidOut = new ResizeObserver(() => {
      if (this.#toScroll) this.#scrollToAnswer();
      else this.#scrollBack();
    });
    this.#laidOut.observe(this.#code);
    // Drawn now, with the rest, so the peek comes as tall as it is.
    this.#frame = frame?.(this.#parts, peek);
  }

  get peek(): PeekView {
    return this.#peek;
  }

  /** Shows what `peek` shows. Says whether the peek's height changes. */
  update(peek: PeekView): boolean {
    const before = peekLines(this.#peek);
    const scroll = peek.shown !== this.#peek.shown || peek.code !== this.#peek.code;
    this.#peek = peek;
    this.#show(peek, scroll);
    this.#frame?.update(peek);
    return peekLines(peek) !== before;
  }

  /** How tall it is, drawn, or as tall as it comes before it is. */
  get height(): number {
    const drawn = this.dom.offsetHeight;
    if (drawn > 0) return drawn;
    const framed = this.#parts.head.hidden ? 0 : HEAD + FOOT;
    return framed + peekLines(this.#peek) * LINE + PADDING;
  }

  /** Whether focus is in it, or on its way back to it after it moved. */
  get hasFocus(): boolean {
    return this.#refocusing || this.dom.contains(this.dom.ownerDocument.activeElement);
  }

  /** Puts it in `parent`, keeping its focus, and its code and list scrolled where they were. */
  attach(parent: HTMLElement): void {
    const focused = this.hasFocus;
    if (this.dom.isConnected && this.#code.clientHeight > 0) {
      this.#scrolled ??= { code: this.#code.scrollTop, list: this.#parts.list.scrollTop };
    }
    parent.append(this.dom);
    // The block isn't in the page until the editor that draws it has put it there.
    queueMicrotask(() => this.#scrollBack());
    if (!focused) return;
    this.#refocusing = true;
    queueMicrotask(() => {
      if (!this.#refocusing) return;
      this.#refocusing = false;
      this.focus();
    });
  }

  /** Scrolls the code and list back where they were before it moved, once it's drawn again. */
  #scrollBack(): void {
    const scrolled = this.#scrolled;
    if (!scrolled || this.#code.clientHeight === 0) return;
    this.#scrolled = undefined;
    this.#code.scrollTop = scrolled.code;
    this.#parts.list.scrollTop = scrolled.list;
  }

  /** Takes focus, where it's drawn, without scrolling anything to it. */
  focus(): void {
    this.dom.focus({ preventScroll: true });
  }

  destroy(): void {
    this.#refocusing = false;
    this.#laidOut.disconnect();
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    const frame = this.#frame;
    this.#frame = undefined;
    frame?.destroy();
    this.dom.remove();
  }

  // Keys: Lo's alone. There's no Vim in a peek.

  keyState(): { mode: Mode; pending: boolean; target: Target } {
    return { mode: 'normal', pending: false, target: { kind: 'line', at: this.at } };
  }

  passKeys(): void {}

  clearPending(): void {}

  setVimKeys(): void {}

  /**
   * A key that scrolls, which nothing in the peek took: it scrolls the code, as it would a page,
   * and never what's under the peek. What the frame draws keeps a key it uses itself, as a field
   * its `Space` and arrows, or a button its `Space`: one it doesn't, the browser would scroll with.
   */
  readonly #scrollKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    const by = scrollOf(event, this.#code.clientHeight);
    if (by === undefined) return;
    const { target } = event;
    const inside = target instanceof HTMLElement && this.#within(target, '*') ? target : undefined;
    const use = inside ? keyUse(inside, event.key) : 'scroll';
    if (use === 'own') return;
    event.preventDefault();
    if (use === 'caret' && inside) moveCaret(inside, event);
    if (use !== 'scroll') return;
    const box = this.#code;
    box.scrollTop = by === 'start' ? 0 : by === 'end' ? box.scrollHeight : box.scrollTop + by;
  };

  /** Whether `target` is in what `selector` matches inside the peek, not the editor around it. */
  #within(target: EventTarget | null, selector: string): boolean {
    const found = target instanceof Element ? target.closest(selector) : null;
    return found !== null && found !== this.dom && this.dom.contains(found);
  }

  /** Draws `peek`'s code in its place, and with `scroll` scrolls it to its answer. */
  #show(peek: PeekView, scroll = true): void {
    this.dom.setAttribute('aria-label', peek.label);
    this.dom.classList.toggle('lo-diffpeek--single', peek.answers.length <= 1);
    this.#body.style.setProperty('--lo-diffpeek-lines', String(peekLines(peek)));
    const answer = peek.answers[peek.shown];
    this.#code.replaceChildren(...(peek.code ? [codeElement(peek.code, answer)] : []));
    if (!scroll) return;
    this.#toScroll = true;
    this.#scrolled = undefined;
    if (this.#code.isConnected) this.#scrollToAnswer();
  }

  /** Scrolls the code so its answer's line has a few lines above it, as far as it can. */
  #scrollToAnswer(): void {
    const box = this.#code;
    if (box.clientHeight === 0) return;
    this.#toScroll = false;
    const code = this.#peek.code;
    const answer = this.#peek.answers[this.#peek.shown];
    const index = code && answer ? answer.line - code.first : -1;
    const first = index - ABOVE;
    const above = box.querySelectorAll('.lo-ln')[first];
    if (first <= 0 || !above) {
      box.scrollTop = 0;
      return;
    }
    const padding = Number.parseFloat(getComputedStyle(box).paddingTop) || 0;
    box.scrollTop += above.getBoundingClientRect().top - box.getBoundingClientRect().top - padding;
  }
}

/** The kinds of `<input>` typed in, which a key moves the caret in. */
const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number']);

/** The kinds of `<input>` pressed, as a button is, or picked, as a box to tick. */
const PRESSED_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file']);

/** The roles of what's pressed or picked, as a button is, which `Space` is for, not scrolling. */
const PRESSED_ROLES = new Set([
  'button',
  'link',
  'option',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
]);

/**
 * What `drawn`, drawn in the frame, does with `key`, a key that scrolls: uses it itself (`own`),
 * as a field moving its caret or a button pressed with `Space`; has the peek move its caret
 * (`caret`), for a key a field leaves to the browser on some systems, which would scroll; does
 * nothing with it (`stop`), as a link with `Space`, which the browser would scroll with; or leaves
 * it to scroll the code (`scroll`).
 */
function keyUse(drawn: HTMLElement, key: string): 'own' | 'caret' | 'stop' | 'scroll' {
  const arrow = key.startsWith('Arrow');
  const across = key === 'ArrowLeft' || key === 'ArrowRight';
  if (drawn instanceof HTMLSelectElement) return 'own';
  if (drawn instanceof HTMLInputElement && !TEXT_INPUTS.has(drawn.type)) {
    if (PRESSED_INPUTS.has(drawn.type)) {
      if (key === ' ' || (arrow && drawn.type === 'radio')) return 'own';
      return 'scroll';
    }
    // A range, a date and the like take every key that moves them.
    return 'own';
  }
  const typed = drawn instanceof HTMLInputElement || drawn instanceof HTMLTextAreaElement;
  if (typed || drawn.isContentEditable) {
    const lines = !(drawn instanceof HTMLInputElement);
    if (key === ' ' || across || (arrow && lines)) return 'own';
    // `Home` and `End`, and up and down a line of one: to its ends.
    if (typed && key !== 'PageUp' && key !== 'PageDown') return 'caret';
    return 'stop';
  }
  if (key !== ' ') return 'scroll';
  if (drawn instanceof HTMLButtonElement) return 'own';
  const pressed =
    drawn.closest('a[href]') !== null || PRESSED_ROLES.has(drawn.getAttribute('role') ?? '');
  return pressed ? 'stop' : 'scroll';
}

/**
 * Moves the caret of `field` to the start or end of its line, as `Home` and `End` do, or `↑` and
 * `↓` in a field of one line, the selection growing with `Shift`.
 */
function moveCaret(field: HTMLElement, event: KeyboardEvent): void {
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  const { value, selectionStart, selectionEnd, selectionDirection } = field;
  // Some kinds, as a number, have no caret to move.
  if (selectionStart === null || selectionEnd === null) return;
  const backward = selectionDirection === 'backward';
  const head = backward ? selectionStart : selectionEnd;
  const anchor = backward ? selectionEnd : selectionStart;
  const end = value.indexOf('\n', head);
  const to =
    event.key === 'Home' || event.key === 'ArrowUp'
      ? value.lastIndexOf('\n', head - 1) + 1
      : end === -1
        ? value.length
        : end;
  if (!event.shiftKey) field.setSelectionRange(to, to);
  else
    field.setSelectionRange(
      Math.min(anchor, to),
      Math.max(anchor, to),
      to < anchor ? 'backward' : 'forward',
    );
}

/**
 * How far the key of `event` scrolls a box `height` tall, as the browser scrolls a page: by a line,
 * by a page, or to an end. None for a key that doesn't scroll.
 */
function scrollOf(event: KeyboardEvent, height: number): number | 'start' | 'end' | undefined {
  const page = Math.max(LINE, height - LINE);
  switch (event.key) {
    case 'ArrowDown':
      return LINE;
    case 'ArrowUp':
      return -LINE;
    case 'PageDown':
      return page;
    case 'PageUp':
      return -page;
    case ' ':
      return event.shiftKey ? -page : page;
    case 'Home':
      return 'start';
    case 'End':
      return 'end';
    case 'ArrowLeft':
    case 'ArrowRight':
      // The code wraps: there's nothing to the side.
      return 0;
    default:
      return undefined;
  }
}

/**
 * A peek as a block of its own under a line, as the whole-file view draws it. The peek outlives the
 * block, and moves into whichever draws it last.
 */
export class PeekWidget extends WidgetType {
  readonly block: PeekBlock;

  constructor(block: PeekBlock) {
    super();
    this.block = block;
  }

  override eq(other: PeekWidget): boolean {
    return other.block === this.block;
  }

  toDOM(): HTMLElement {
    // The room around it is padding, which the editor measures, not margin.
    const holder = element('div', 'lo-filepeek');
    this.block.attach(holder);
    return holder;
  }

  override get estimatedHeight(): number {
    return this.block.height + HOLDER;
  }

  /** The peek handles its own events. */
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * `code`'s lines, numbered, each wrapping under its own indent, highlighted from its tokens, with
 * `answer`'s line marked and the name on it, where the answer says where that starts.
 */
function codeElement(code: PeekCode, answer: PeekAnswer | undefined): HTMLElement {
  const grid = element('div', 'lo-uni');
  const starts = lineStarts(code.lines);
  code.lines.forEach((text, index) => {
    const number = code.first + index;
    const marked = answer?.line === number;
    const gutter = element('div', marked ? 'lo-ln is-active' : 'lo-ln', String(number));
    const line = element('div', marked ? 'lo-line lo-line-active' : 'lo-line');
    line.style.setProperty('--ind', String(text.length - text.trimStart().length));
    const name = marked && answer.column !== undefined ? nameAt(text, answer.column) : undefined;
    line.append(...spans(text, code.tokens, starts[index]!, name));
    grid.append(gutter, line);
  });
  return grid;
}

/** The name starting at `column` of `text`, as columns from and to, if one starts there. */
function nameAt(text: string, column: number): { from: number; to: number } | undefined {
  const found = /^[\p{L}\p{N}_$]+/u.exec(text.slice(column));
  return found ? { from: column, to: column + found[0].length } : undefined;
}

/**
 * The text of a line, starting at `start` in the code's text, in runs of one token's class each,
 * the name in a run of its own.
 */
function spans(
  text: string,
  tokens: Uint32Array | undefined,
  start: number,
  name: { from: number; to: number } | undefined,
): Node[] {
  const classes: string[] = Array.from({ length: text.length }, () => '');
  if (tokens) {
    for (const { from, to, token } of tokensFrom(tokens, start, start + text.length)) {
      const className = tokenClass(token);
      if (!className) continue;
      for (let at = Math.max(from, start); at < Math.min(to, start + text.length); at++) {
        classes[at - start] = className;
      }
    }
  }
  if (name) {
    for (let at = name.from; at < Math.min(name.to, text.length); at++) {
      classes[at] = `${classes[at]} lo-diffpeek__name`.trim();
    }
  }
  const out: Node[] = [];
  let from = 0;
  for (let at = 1; at <= text.length; at++) {
    if (at < text.length && classes[at] === classes[from]) continue;
    const run = text.slice(from, at);
    const className = classes[from]!;
    out.push(className ? element('span', className, run) : document.createTextNode(run));
    from = at;
  }
  return out;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
