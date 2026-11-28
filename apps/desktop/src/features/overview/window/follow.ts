// Moving through an overview by its blocks, and from a block to its code: the overview on screen in
// each tab, which the keys act on; the block that has focus, or the one at the top of the screen;
// `]b` and `[b`, `Tab` within a block, stepping a walkthrough or tabs, and the article's scroll;
// following a block, link or part to its code, which the tab's history records so `⌃o` comes back
// to the block; and, with code beside, the diff following the block that has focus to its code.
// Nothing here moves what's on screen but a key, a click or a menu asks it to.

import type { OverviewTree } from '@lo/artifact';
import { land, reveal } from '@lo/ui';
import { KEY_EVENT, type Entry, type Target } from '@lo/ui/commands';
import {
  blockNumber,
  blockOf,
  blockStops,
  focusTargetOf,
  glossaryIn,
  hasSteps,
  linksIn,
  stepIn,
  type GlossaryParts,
} from '@lo/ui/overview';

import { refuse } from '../../../window/commands/notices.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { showPlace, type ShowHow } from '../../diff/window/shared.ts';
import { holdLimit } from '../../revisions/window/shared.ts';
import { settingNow } from '../../settings/window/shared.ts';
import { activeTab, showInstead, showMiddle, tabState } from '../../tab/window/shared.ts';
import { on } from '../settings.ts';
import { blockId, blockIn, codeOf, type CodeAt } from './blocks.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import { main } from './main.ts';
import { openings, overviewPlace } from './opening.ts';
import { placeOnHead, placing, writtenIn } from './since.ts';
import { hasStackOverview, subjects } from './stack.ts';
import { showWholeStackAt } from './stacked.ts';

/** An overview drawn in a tab while it's on screen, as the keys act on it. */
export interface DrawnOverview {
  readonly tab: string;
  readonly tree: OverviewTree;
  /** The number Lo gave the tree, which its blocks' ids carry. */
  readonly generation: number;
  /** The view's own element, around the overview. */
  readonly root: HTMLElement;
  /** The overview's scrolling element, once it's drawn. */
  scroller(): HTMLElement | null;
  /** Whether it's the overview of the stack the tab's layer is in, rather than the layer's own. */
  readonly stack?: boolean | undefined;
}

/** What a place in the stack's overview is in, as the tab's history keeps it. */
export const IN_STACK = 'stack';

const drawn = new Map<string, DrawnOverview>();

/** What's told of each overview drawn on screen, by its tab's id. */
const drawnListeners = new Set<(tab: string) => void>();

/**
 * Calls `listener` with a tab's id each time its overview is drawn on screen. Returns a function
 * that stops it.
 */
export function onDrawn(listener: (tab: string) => void): () => void {
  drawnListeners.add(listener);
  return () => {
    drawnListeners.delete(listener);
  };
}

/** Records the overview drawn in tab `tab` while it's on screen. Returns a function that forgets it. */
export function setDrawn(overview: DrawnOverview): () => void {
  drawn.set(overview.tab, overview);
  // One that stops itself as it's told is taken out of the set this goes through, which a `Set`
  // allows.
  for (const listener of drawnListeners) listener(overview.tab);
  return () => {
    if (drawn.get(overview.tab) === overview) drawn.delete(overview.tab);
  };
}

/** The overview on screen in tab `tab`, if it's drawn there. */
export function drawnIn(tab: string): DrawnOverview | undefined {
  return drawn.get(tab);
}

/** The number Lo gave the tree each tab's overview last showed, whose blocks history can reveal. */
export const trees = tabState<number | undefined>(() => undefined);

/** The number Lo gave the tree each tab's stack's overview last showed, as {@link trees}. */
export const stackTrees = tabState<number | undefined>(() => undefined);

/** A block to show once the tab's overview is drawn, as `⌃o` back to it asks, counted so each is once. */
export const reveals = tabState<{ block: number; count: number } | undefined>(() => undefined);

let revealCount = 0;

/** The overview's article, where its blocks are. */
function articleOf(overview: DrawnOverview): HTMLElement | null {
  return overview.scroller()?.querySelector<HTMLElement>('.lo-ov__article') ?? null;
}

/** The block with number `index` in the overview, as drawn, if it's one the block keys stop at. */
export function blockElement(overview: DrawnOverview, index: number): HTMLElement | undefined {
  const article = articleOf(overview);
  return article ? blockStops(article).find((block) => blockNumber(block) === index) : undefined;
}

/** The block that has focus, or that holds what has focus, if any. */
export function focusedBlock(overview: DrawnOverview): HTMLElement | undefined {
  const article = articleOf(overview);
  return article ? blockOf(article, document.activeElement) : undefined;
}

/** The block the reader is at: the one with focus, or else the first at the top of the screen. */
export function currentBlock(overview: DrawnOverview): HTMLElement | undefined {
  return focusedBlock(overview) ?? onScreen(overview)[0];
}

/** Where on the page the block the reader is at sits, by its number, to keep it there. */
export function placeIn(overview: DrawnOverview): { block: number; top: number } | undefined {
  const block = currentBlock(overview);
  const index = block && blockNumber(block);
  return block && index !== undefined
    ? { block: index, top: block.getBoundingClientRect().top }
    : undefined;
}

/** The blocks with any of themselves on screen, first to last. */
function onScreen(overview: DrawnOverview): HTMLElement[] {
  const scroller = overview.scroller();
  const article = articleOf(overview);
  if (!scroller || !article) return [];
  const box = scroller.getBoundingClientRect();
  return blockStops(article).filter((block) => {
    const { top, bottom } = block.getBoundingClientRect();
    return bottom > box.top && top < box.bottom;
  });
}

/** A block, as a key's or a menu's target. */
export function targetOf(overview: DrawnOverview, block: Element): Target | undefined {
  const index = blockNumber(block);
  return index === undefined
    ? undefined
    : { kind: 'block', block: blockId(overview.generation, index) };
}

/**
 * Where on the page each block was as the tab's history last recorded it, by tab and block id:
 * `⌃o` back to the block puts it there again.
 */
const left = new Map<string, Map<string, number>>();

/**
 * The place in the tab's history of the block the reader is at, if there's one. Where it is on the
 * page is kept with it.
 */
export function hereIn(overview: DrawnOverview): Entry | undefined {
  const block = currentBlock(overview);
  const at = block && targetOf(overview, block);
  if (block && at?.kind === 'block') {
    const tops = left.get(overview.tab) ?? new Map<string, number>();
    tops.set(at.block, block.getBoundingClientRect().top);
    left.set(overview.tab, tops);
  }
  return at && entryOf(overview, at);
}

/** A place at `at` in `overview`, as the tab's history keeps it: in the stack's, saying so. */
function entryOf(overview: DrawnOverview, at: Target): Entry {
  return overview.stack ? { view: 'overview', at, within: IN_STACK } : { view: 'overview', at };
}

/**
 * What the reader does that moves the overview: after it, where it is is theirs. A key the
 * overview's own commands take never gets this far; each of them that moves it lets go first.
 */
const INPUT = ['wheel', 'keydown', 'pointerdown'] as const;

/** How long the overview takes to settle to a new width, at most, in milliseconds. */
const SETTLE_MS = 1000;

/** What stops holding a block in place in each tab, while one is held. */
const holding = new Map<string, () => void>();

/** Stops holding a block in place in the overview, as the reader moves it. */
function letGo(overview: DrawnOverview): void {
  holding.get(overview.tab)?.();
}

/**
 * Keeps `block` at `top` on the page while the overview settles: as it takes a new width, and as
 * the blocks above it settle to one, until the reader moves or a second has passed. Returns a
 * function that stops it.
 */
export function holdBlock(overview: DrawnOverview, block: Element, top: number): () => void {
  letGo(overview);
  const scroller = overview.scroller();
  const content = articleOf(overview);
  if (!scroller || !content) return () => undefined;
  const keep = () => {
    const moved = block.getBoundingClientRect().top - top;
    if (Math.abs(moved) >= 0.5) scroller.scrollTop += moved;
  };
  keep();
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const settling = new ResizeObserver(keep);
  settling.observe(content);
  const stop = () => {
    settling.disconnect();
    clearTimeout(timer);
    for (const type of INPUT) window.removeEventListener(type, stop, true);
    if (holding.get(overview.tab) === stop) holding.delete(overview.tab);
  };
  const timer = setTimeout(stop, SETTLE_MS);
  for (const type of INPUT) window.addEventListener(type, stop, true);
  holding.set(overview.tab, stop);
  return stop;
}

/** How far inside the screen a block brought onto it is kept from its edges, in pixels. */
const MARGIN = 24;

/**
 * Scrolls the overview just far enough to show `element` whole, or its top when it's taller than
 * the screen. One already on screen whole stays where it is.
 */
export function bringOnScreen(scroller: HTMLElement, element: Element): void {
  const box = scroller.getBoundingClientRect();
  const { top, bottom, height } = element.getBoundingClientRect();
  const from = box.top + MARGIN;
  const to = box.bottom - MARGIN;
  if (top >= from && bottom <= to) return;
  const by = top < from || height > to - from ? top - from : bottom - to;
  scroller.scrollTop += by;
}

/** Gives `block` focus, and brings it on screen if it isn't. */
export function focusBlock(overview: DrawnOverview, block: HTMLElement): void {
  letGo(overview);
  focusTargetOf(block).focus({ preventScroll: true });
  const scroller = overview.scroller();
  if (scroller) bringOnScreen(scroller, block);
}

/** The overview's Glossary section, as drawn, if it has one. */
export function glossaryOf(overview: DrawnOverview): GlossaryParts | undefined {
  const article = articleOf(overview);
  return article ? glossaryIn(article) : undefined;
}

/**
 * Goes to the overview's Glossary section: its heading at the top of the screen, and the first
 * term the pull request adds or changes, else its first term, landed on and given focus. The tab's
 * history keeps where the reader was, so `⌃o` comes back.
 */
export function goToGlossary(overview: DrawnOverview): void {
  const glossary = glossaryOf(overview);
  if (!glossary) return;
  letGo(overview);
  const here = hereIn(overview);
  if (here) registry().history.record(here);
  const { heading, box, first, term } = glossary;
  reveal(heading ?? box, { block: 'start', land: false });
  term?.focus({ preventScroll: true });
  if (first) land(first);
}

/**
 * Why the block keys can't move while the overview's first blocks draw, unseen: nothing, so a key
 * pressed meanwhile does nothing and says nothing. The placeholder over it says the wait.
 */
const NOT_DRAWN = '';

/**
 * The block `]b` (`1`) or `[b` (`-1`) goes to: the next or previous one the block keys stop at,
 * from the block the reader is at; from none, or with `fromScreen`, the first that starts at the
 * top of the screen or below it, or the last that starts above it. Or why there's none.
 */
export function nextBlock(
  overview: DrawnOverview,
  by: 1 | -1,
  fromScreen = false,
): HTMLElement | string {
  const article = articleOf(overview);
  const scroller = overview.scroller();
  // Unseen while its first blocks draw, it has nothing to take focus yet.
  if (!article || !scroller || getComputedStyle(article).visibility === 'hidden') {
    return NOT_DRAWN;
  }
  const stops = blockStops(article);
  const focused = fromScreen ? undefined : focusedBlock(overview);
  let next: HTMLElement | undefined;
  if (focused) {
    next = stops[stops.indexOf(focused) + by];
  } else {
    const top = scroller.getBoundingClientRect().top;
    const below = (block: HTMLElement) => block.getBoundingClientRect().top >= top - 1;
    next = by > 0 ? stops.find(below) : stops.findLast((block) => !below(block));
  }
  if (next) return next;
  if (stops.length === 0) return 'No blocks in this overview';
  return by > 0 ? 'Last block' : 'First block';
}

/** What `Tab` stops at before the blocks: the outline's sections and the byline's offer. */
const CONTROLS = 'button, a[href], [role="link"], summary';

/** Whether `element` is drawn: the outline isn't in a narrow window. */
function drawnOnPage(element: Element): boolean {
  // The unit tests' page has no `checkVisibility`, nor a layout to check.
  return typeof element.checkVisibility !== 'function' || element.checkVisibility();
}

/**
 * What `Tab` goes through from the overview itself before it reaches a block, as they're written:
 * the outline's sections, then the byline's offer, which come before the first block.
 */
function leadIn(overview: DrawnOverview): (HTMLElement | SVGElement)[] {
  const scroller = overview.scroller();
  const article = articleOf(overview);
  if (!scroller || !article) return [];
  const [first] = blockStops(article);
  return [...scroller.querySelectorAll(CONTROLS)].filter(
    (element): element is HTMLElement | SVGElement =>
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      blockOf(article, element) === undefined &&
      (first === undefined ||
        Boolean(element.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)) &&
      element.tabIndex >= 0 &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      element.closest('[hidden], [data-lo-hints]') === null &&
      drawnOnPage(element),
  );
}

/**
 * Where `Tab` (`1`) or `⇧Tab` (`-1`) goes. In a block, the next or previous of its links, figure
 * parts and controls, round through the block itself: it never leaves the block. From the
 * overview itself, as `Esc` leaves it, the outline's sections, then the byline's offer, then the
 * block `]b` goes to, which takes focus; `⇧Tab` goes back through the byline and the outline. Or
 * why there's nowhere.
 */
export function nextLink(overview: DrawnOverview, by: 1 | -1): HTMLElement | SVGElement | string {
  const active = document.activeElement;
  const block = focusedBlock(overview);
  if (block) {
    const order = [focusTargetOf(block), ...linksIn(block)];
    if (order.length === 1) return 'No links in this block';
    const at = order.findIndex((each) => each === active);
    return order[(Math.max(0, at) + by + order.length) % order.length] ?? order[0]!;
  }
  const lead = leadIn(overview);
  const at = lead.findIndex((each) => each === active);
  if (at === -1) return (by > 0 ? lead[0] : lead.at(-1)) ?? nextBlock(overview, 1, true);
  const next = lead[at + by];
  if (next) return next;
  return by > 0 ? nextBlock(overview, 1, true) : 'First link';
}

/** Gives `element`, a link, part or control in a block, focus, and brings it on screen. */
export function focusLink(overview: DrawnOverview, element: HTMLElement | SVGElement): void {
  letGo(overview);
  element.focus({ preventScroll: true });
  const scroller = overview.scroller();
  if (scroller) bringOnScreen(scroller, element);
}

/**
 * The control with focus in the overview's view, if it's outside the overview's blocks: a section
 * in its outline, the byline's offer, or a link no block holds. With no overview drawn, any of the
 * view's own, such as its Retry now.
 */
export function looseControl(overview: DrawnOverview | undefined): HTMLElement | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return undefined;
  const root = overview?.root ?? active.closest('[data-lo-scope="overview"]');
  if (!root?.contains(active)) return undefined;
  if (overview && focusedBlock(overview)) return undefined;
  return active.matches(CONTROLS) ? active : undefined;
}

/** Runs a link's, a part's or a control's own action, as a click on it does. */
function activate(element: Element): void {
  if (element instanceof HTMLElement) element.click();
  else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** The block `target` names in the overview, if it's one of its own drawn now. */
export function blockAt(overview: DrawnOverview, target: Target): HTMLElement | undefined {
  if (target.kind !== 'block') return undefined;
  const index = blockIn(target.block, overview.generation);
  return index === undefined ? undefined : blockElement(overview, index);
}

/** The code the block `element` points at, if it points at any. */
export function codeIn(overview: DrawnOverview, element: Element): CodeAt | undefined {
  const index = blockNumber(element);
  const node = index === undefined ? undefined : overview.tree.blocks[index];
  return node && codeOf(node);
}

/** What `⏎` on a block does: the link or control in it with focus, its fold, its code, its first link. */
type Follow =
  { kind: 'activate'; element: Element } | { kind: 'code'; code: CodeAt; block: HTMLElement };

/** What following `block` does, or why it can't be followed. */
export function followOf(overview: DrawnOverview, block: HTMLElement): Follow | string {
  const own = focusTargetOf(block);
  const active = document.activeElement;
  if (active && active !== own && (linksIn(block) as Element[]).includes(active)) {
    return { kind: 'activate', element: active };
  }
  if (block.localName === 'details') return { kind: 'activate', element: own };
  const code = codeIn(overview, block);
  if (code) return { kind: 'code', code, block };
  // Its first link or part, never a control such as a tab, which isn't somewhere to go.
  const first = linksIn(block).find((element) => element.getAttribute('role') === 'link');
  if (first) return { kind: 'activate', element: first };
  return 'No code or link in this block';
}

/**
 * What `⏎` on `block` is called, by what it does there: "Open link" where it follows a link or a
 * part, and a fold's "Expand" or "Collapse". Nothing where it goes to code, which its label says,
 * or where there's nothing to follow.
 */
export function followName(overview: DrawnOverview, block: HTMLElement): string | undefined {
  const found = followOf(overview, block);
  if (typeof found === 'string' || found.kind === 'code') return undefined;
  if (block instanceof HTMLDetailsElement && found.element === focusTargetOf(block)) {
    return block.open ? 'Collapse' : 'Expand';
  }
  return 'Open link';
}

/**
 * Follows `block`, as `⏎` does: the link, part or control in it that has focus, or for the block
 * itself, a fold opens or closes, and code goes to the diff. The block takes focus first, so the
 * place the tab's history records is the block, and `⌃o` comes back to it.
 */
export function follow(overview: DrawnOverview, block: HTMLElement): void {
  const found = followOf(overview, block);
  if (typeof found === 'string') return;
  if (found.kind === 'activate') {
    activate(found.element);
    return;
  }
  if (!block.contains(document.activeElement)) focusTargetOf(block).focus({ preventScroll: true });
  goToCodeFrom(overview, found.code);
}

/**
 * Shows `code`, which `overview` points at: a layer's own overview's in the tab's diff, as
 * {@link goToCode} does; the stack's, at its commit, in the whole stack shown as one diff.
 */
function goToCodeFrom(overview: DrawnOverview, code: CodeAt): void {
  if (!overview.stack) {
    goToCode(overview.tab, code);
    return;
  }
  const tab = activeTab();
  if (tab?.kind !== 'pull' || tab.id !== overview.tab) return;
  showWholeStackAt(tab, code.path, code.lines);
}

/**
 * With code beside the overview, has the diff follow `block`, which focus just landed on, to the
 * code it points at, as `⏎` would show it: nothing recorded, nothing said, and focus where it is.
 */
export function followBlock(overview: DrawnOverview, block: HTMLElement): void {
  // The code beside is the layer's: it doesn't follow the stack's overview.
  if (overview.stack) return;
  const code = codeIn(overview, block);
  if (code) goToCode(overview.tab, code, 'follow');
}

/**
 * What the reader does that stops code waiting to be placed, as they've moved on: a key, as the key
 * listener tells of it once it's their input (`KEY_EVENT`), those Lo's commands take among them; a
 * click; or the wheel.
 */
const MOVED = [KEY_EVENT, 'pointerdown', 'wheel'] as const;

/** What stops the code each tab waits to go to while Lo works out where it is now. */
const placings = new Map<string, () => void>();

/**
 * Shows `code`, at the overview's commit, where it is at the head on screen: in the tab's diff, at
 * the line its first line maps to, or whole where the diff doesn't have it, its lines marked; the
 * place the tab is at recorded first. Until Lo knows how the file changed since the commit, it
 * waits, for up to `holdLimit()`, then goes where the lines were; the reader moving on first stops
 * it. For a file gone from the head on screen, or lines Lo can't place there, a note says why it
 * can't. To `follow`, as the code beside follows a block, records nothing and says nothing.
 */
export function goToCode(tab: string, code: CodeAt, how: ShowHow = 'go'): void {
  placings.get(tab)?.();
  const working = placing(tab, code.path);
  if (!working) {
    goOnHead(tab, code, how);
    return;
  }
  const stop = () => {
    clearTimeout(bound);
    for (const type of MOVED) window.removeEventListener(type, stop, true);
    if (placings.get(tab) === stop) placings.delete(tab);
  };
  const go = () => {
    if (placings.get(tab) !== stop) return;
    stop();
    goOnHead(tab, code, how);
  };
  const bound = setTimeout(go, holdLimit());
  void working.then(go, go);
  // Not the key or click that asked for the code: the window has heard it already.
  for (const type of MOVED) window.addEventListener(type, stop, true);
  placings.set(tab, stop);
}

/** Shows `code` where it is at the head on screen, as far as Lo knows, or says why it can't. */
function goOnHead(tab: string, code: CodeAt, how: ShowHow): void {
  const { path, lines } = code;
  const head = placeOnHead(tab, path, lines);
  const since = writtenIn(tab);
  if (how === 'follow') {
    if (head && (!lines || head.line !== undefined)) {
      showPlace(tab, head.path, head.line, head.lines, 'new', how);
    }
    return;
  }
  if (!head) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    refuse(since === undefined ? `${name} was deleted` : `${name} was deleted since ${since}`);
    return;
  }
  if (lines && head.line === undefined) {
    refuse(since === undefined ? 'These lines changed' : `These lines changed since ${since}`);
    return;
  }
  showPlace(tab, head.path, head.line, head.lines);
}

/**
 * Follows a link to `code` in the overview, from `from`: its block takes focus first, unless what
 * has focus is in it, so the place the tab's history records is the block.
 */
export function followCode(overview: DrawnOverview, from: Element, code: CodeAt): void {
  const article = articleOf(overview);
  const block = article ? blockOf(article, from) : undefined;
  if (block && !block.contains(document.activeElement)) {
    focusTargetOf(block).focus({ preventScroll: true });
  }
  goToCodeFrom(overview, code);
}

/** Records where a link was followed from in the overview, its block, as the place `⌃o` comes back to. */
export function recordFrom(overview: DrawnOverview, from: Element): void {
  const article = articleOf(overview);
  const block = article ? blockOf(article, from) : undefined;
  const at = block && targetOf(overview, block);
  if (!at) return;
  // The overview has already moved to where the link goes: the block is brought on screen again.
  if (at.kind === 'block') left.get(overview.tab)?.delete(at.block);
  registry().history.record(entryOf(overview, at));
}

/**
 * What `→` on `block` is called: "Next tab" on tabs. Nothing on a walkthrough, which its label
 * says, or where there's nothing to step.
 */
export function stepName(block: HTMLElement): string | undefined {
  const own = block.matches('.lo-walk, .lo-tabs')
    ? block
    : block.querySelector('.lo-walk, .lo-tabs');
  return own?.matches('.lo-tabs') ? 'Next tab' : undefined;
}

/** Whether `block` has a walkthrough or tabs to step, or why not. */
export function stepsIn(block: HTMLElement): true | string {
  return hasSteps(block) || 'No steps in this block';
}

/** Steps the walkthrough or tabs in `block`: `1` on, `-1` back. */
export function step(block: HTMLElement, by: 1 | -1): void {
  stepIn(block, by);
}

/** How the article scrolls with a key. */
export type Scroll = 'down' | 'up' | 'top' | 'bottom' | 'pageDown' | 'pageUp';

/** How far a line's scroll goes, as an arrow key's does. */
const LINE = 40;

/** Scrolls the overview's article, as `j`, `k`, `gg`, `G` and the page keys do. */
export function scroll(overview: DrawnOverview, how: Scroll): void {
  letGo(overview);
  const scroller = overview.scroller();
  if (!scroller) return;
  const page = Math.max(LINE, scroller.clientHeight - LINE);
  switch (how) {
    case 'down':
      scroller.scrollTop += LINE;
      return;
    case 'up':
      scroller.scrollTop -= LINE;
      return;
    case 'top':
      scroller.scrollTop = 0;
      return;
    case 'bottom':
      scroller.scrollTop = scroller.scrollHeight;
      return;
    case 'pageDown':
      scroller.scrollTop += page;
      return;
    case 'pageUp':
      scroller.scrollTop -= page;
      return;
    default:
      how satisfies never;
      throw new Error(`A scroll Lo doesn’t know: ${String(how)}.`);
  }
}

/** The tabs whose newer overview was asked for, with the tree each showed then, if any. */
const loading = new Map<string, { from: number | undefined }>();

/**
 * Loads the newer overview pushed while tab `tab`'s was read. The blocks it replaces go, and with
 * them what had focus, so once it's drawn the overview itself takes focus: see `loadedNewer`.
 */
export function loadNewer(tab: string, stack = false): void {
  loading.set(tab, { from: (stack ? stackTrees : trees).get(tab) });
  main()
    .load({ id: tab, stack })
    .catch((error: unknown) => console.error("Lo couldn't load the newer overview:", error));
}

/**
 * Whether the overview drawn in tab `tab`, the tree numbered `generation`, is the newer one asked
 * for there, once: the overview itself takes focus, as after `Esc`, unless the reader has put it
 * somewhere else since.
 */
export function loadedNewer(tab: string, generation: number): boolean {
  const asked = loading.get(tab);
  if (!asked || asked.from === generation) return false;
  loading.delete(tab);
  return true;
}

/** Tabs whose history can reveal places in the overview. */
const registered = new Set<string>();

/**
 * Lets tab `tab`'s history reveal its places in the overview for as long as the tab is open: a
 * block of the overview it shows, which comes on screen with the block given focus, or the
 * overview itself, left at no block, which goes to the timeline where the tab went there without
 * ever showing its overview. A block a newer overview doesn't have is gone, and every place is
 * while Settings turns overviews off.
 */
export function placesFor(tab: string): void {
  if (registered.has(tab)) return;
  registered.add(tab);
  registry().history.register(
    tab,
    'overview',
    (at, within) => {
      if (!settingNow(on)) return false;
      // A place in the stack's overview shows it again, while the stack has one.
      const stack = within === IN_STACK;
      if (stack && !hasStackOverview(tab)) return false;
      subjects.set(tab, stack ? 'stack' : 'pull');
      if (at.kind === 'none') {
        return !stack && overviewPlace(openings.get(tab)) === 'timeline'
          ? showInstead(tab)
          : showMiddle(tab, OVERVIEW_VIEW);
      }
      const tree = (stack ? stackTrees : trees).get(tab);
      const index = at.kind === 'block' && tree !== undefined ? blockIn(at.block, tree) : undefined;
      if (index === undefined) return false;
      revealBlock(tab, index);
      return true;
    },
    // A block the overview no longer has is gone, as is the stack's once there's none. Before one is
    // drawn, it can't tell.
    (at, within) => {
      if (!settingNow(on)) return false;
      const stack = within === IN_STACK;
      if (stack && !hasStackOverview(tab)) return false;
      const tree = (stack ? stackTrees : trees).get(tab);
      return at.kind !== 'block' || tree === undefined || blockIn(at.block, tree) !== undefined;
    },
  );
}

/**
 * Shows block `index` of the overview tab `tab` shows, as history brings a block back: the overview
 * comes on screen, with the block given focus once it's drawn.
 */
export function revealBlock(tab: string, index: number): void {
  revealCount += 1;
  reveals.set(tab, { block: index, count: revealCount });
  showMiddle(tab, OVERVIEW_VIEW);
  const overview = drawn.get(tab);
  if (overview) takeReveal(overview);
}

/** Forgets the tabs that closed, those not in `open`. */
export function keepPlaces(open: ReadonlySet<string>): void {
  for (const tab of registered) if (!open.has(tab)) registered.delete(tab);
  for (const tab of left.keys()) if (!open.has(tab)) left.delete(tab);
  for (const tab of loading.keys()) if (!open.has(tab)) loading.delete(tab);
  for (const [tab, stop] of placings) if (!open.has(tab)) stop();
}

/**
 * Shows the block history asked for in the overview drawn, if one is waiting, once: focus goes to
 * it, where it was on the page when the tab left it, or brought on screen when that's off it now.
 * Says whether there was one.
 */
export function takeReveal(overview: DrawnOverview): boolean {
  const waiting = reveals.get(overview.tab);
  if (!waiting) return false;
  const block = blockElement(overview, waiting.block);
  if (!block) return false;
  reveals.set(overview.tab, undefined);
  const top = left.get(overview.tab)?.get(blockId(overview.generation, waiting.block));
  const scroller = overview.scroller();
  if (top === undefined || !scroller || !onScreenAt(scroller, block, top)) {
    focusBlock(overview, block);
    return true;
  }
  // Where it was on the page as the tab left it, whatever the overview did while hidden.
  focusTargetOf(block).focus({ preventScroll: true });
  holdBlock(overview, block, top);
  return true;
}

/**
 * Whether `block`, at `top` on the page, would show on screen: its start, or enough of it to read.
 * A window made shorter since leaves a place near its foot off screen.
 */
function onScreenAt(scroller: HTMLElement, block: Element, top: number): boolean {
  const box = scroller.getBoundingClientRect();
  const { height } = block.getBoundingClientRect();
  return top < box.bottom - MARGIN && top + height > box.top + MARGIN;
}
