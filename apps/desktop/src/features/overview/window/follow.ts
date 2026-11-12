// Moving through an overview by its blocks, and from a block to its code: the overview on screen in
// each tab, which the keys act on; the block that has focus, or the one at the top of the screen;
// `]b` and `[b`, `Tab` within a block, stepping a walkthrough or tabs, and the article's scroll;
// following a block, link or part to its code, which the tab's history records so `⌃o` comes back
// to the block; and the code beside the overview, which follows the block that has focus. Nothing
// here moves what's on screen but a key, a click or a menu asks it to.

import type { OverviewTree } from '@lo/artifact';
import type { Entry, Target } from '@lo/ui/commands';
import {
  blockNumber,
  blockOf,
  blockStops,
  focusTargetOf,
  hasSteps,
  linksIn,
  stepIn,
} from '@lo/ui/overview';

import { registry } from '../../../window/commands/registry.ts';
import { showPlace } from '../../diff/window/shared.ts';
import { showMiddle, tabState } from '../../tab/window/shared.ts';
import { blockId, blockIn, codeOf, onHead, type CodeAt } from './blocks.ts';
import { OVERVIEW_VIEW } from './labels.ts';
import { main } from './main.ts';

/** An overview drawn in a tab while it's on screen, as the keys act on it. */
export interface DrawnOverview {
  readonly tab: string;
  readonly tree: OverviewTree;
  /** The number Lo gave the tree, which its blocks' ids carry. */
  readonly generation: number;
  /** The view's own element, around the overview and the code beside it. */
  readonly root: HTMLElement;
  /** The overview's scrolling element, once it's drawn. */
  scroller(): HTMLElement | null;
}

const drawn = new Map<string, DrawnOverview>();

/** Records the overview drawn in tab `tab` while it's on screen. Returns a function that forgets it. */
export function setDrawn(overview: DrawnOverview): () => void {
  drawn.set(overview.tab, overview);
  return () => {
    if (drawn.get(overview.tab) === overview) drawn.delete(overview.tab);
  };
}

/** The overview on screen in tab `tab`, if it's drawn there. */
export function drawnIn(tab: string): DrawnOverview | undefined {
  return drawn.get(tab);
}

/** The block whose code is beside the overview in each tab, by its id, while it's open. */
export const besides = tabState<string | undefined>(() => undefined);

/** The number Lo gave the tree each tab's overview last showed, whose blocks history can reveal. */
export const trees = tabState<number | undefined>(() => undefined);

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

/** The block whose code is beside the overview, while it's open. */
function besideBlock(overview: DrawnOverview): HTMLElement | undefined {
  const id = besides.get(overview.tab);
  const index = id === undefined ? undefined : blockIn(id, overview.generation);
  return index === undefined ? undefined : blockElement(overview, index);
}

/** Whether focus is in the view, the overview or the code beside it. */
function focusIn(overview: DrawnOverview): boolean {
  return overview.root.contains(document.activeElement);
}

/**
 * The block the reader is at: the one with focus; while focus is in the code beside, the one that
 * shows it; otherwise the first at the top of the screen.
 */
export function currentBlock(overview: DrawnOverview): HTMLElement | undefined {
  const focused = focusedBlock(overview);
  if (focused) return focused;
  if (focusIn(overview)) {
    const beside = besideBlock(overview);
    if (beside) return beside;
  }
  return onScreen(overview)[0];
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
  return at && { view: 'overview', at };
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
    return 'The overview isn’t drawn yet.';
  }
  const stops = blockStops(article);
  const focused = fromScreen
    ? undefined
    : (focusedBlock(overview) ?? (focusIn(overview) ? besideBlock(overview) : undefined));
  let next: HTMLElement | undefined;
  if (focused) {
    next = stops[stops.indexOf(focused) + by];
  } else {
    const top = scroller.getBoundingClientRect().top;
    const below = (block: HTMLElement) => block.getBoundingClientRect().top >= top - 1;
    next = by > 0 ? stops.find(below) : stops.findLast((block) => !below(block));
  }
  if (next) return next;
  if (stops.length === 0) return 'This overview has no blocks to move between.';
  return by > 0 ? 'This is the last block.' : 'This is the first block.';
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
      element.closest('[hidden]') === null &&
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
    if (order.length === 1) return 'This block has no links or parts.';
    const at = order.findIndex((each) => each === active);
    return order[(Math.max(0, at) + by + order.length) % order.length] ?? order[0]!;
  }
  const lead = leadIn(overview);
  const at = lead.findIndex((each) => each === active);
  if (at === -1) return (by > 0 ? lead[0] : lead.at(-1)) ?? nextBlock(overview, 1, true);
  const next = lead[at + by];
  if (next) return next;
  return by > 0 ? nextBlock(overview, 1, true) : 'There’s nothing before this in the overview.';
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
 * in its outline, the byline's offer, a link no block holds, or the button over the code beside
 * it. With no overview drawn, any of the view's own, such as its Retry now.
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
  return 'This block has nothing to follow.';
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
  goToCode(overview.tab, found.code);
}

/**
 * Shows `code`, at the overview's commit, in the tab's diff, or whole where the diff doesn't have
 * it, the place the tab is at recorded first.
 */
export function goToCode(tab: string, code: CodeAt): void {
  const head = onHead(code);
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
  goToCode(overview.tab, code);
}

/** Records where a link was followed from in the overview, its block, as the place `⌃o` comes back to. */
export function recordFrom(overview: DrawnOverview, from: Element): void {
  const article = articleOf(overview);
  const block = article ? blockOf(article, from) : undefined;
  const at = block && targetOf(overview, block);
  if (!at) return;
  // The overview has already moved to where the link goes: the block is brought on screen again.
  if (at.kind === 'block') left.get(overview.tab)?.delete(at.block);
  registry().history.record({ view: 'overview', at });
}

/** Whether `block` has a walkthrough or tabs to step, or why not. */
export function stepsIn(block: HTMLElement): true | string {
  return hasSteps(block) || 'This block has no steps or tabs.';
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
      throw new Error(`A scroll Lo doesn't know: ${String(how)}.`);
  }
}

/** Where on the page the block the reader was at sat as the code beside came or went. */
const kept = new Map<string, { block: number; top: number }>();

/** Notes where on the page the block the reader is at sits, for `keptPlace`. */
function keepPlace(overview: DrawnOverview): void {
  const block = currentBlock(overview);
  const index = block && blockNumber(block);
  if (!block || index === undefined) {
    kept.delete(overview.tab);
    return;
  }
  kept.set(overview.tab, { block: index, top: block.getBoundingClientRect().top });
}

/**
 * Where on the page the block the reader was at sat in tab `tab`'s overview as the code beside
 * last came or went, once: the overview, narrower or wider, scrolls to put it back there.
 */
export function keptPlace(tab: string): { block: number; top: number } | undefined {
  const place = kept.get(tab);
  kept.delete(tab);
  return place;
}

/**
 * Opens the code beside the overview for `block`, or the first block with code on screen without
 * one; or closes it, when it's open. Says why, when there's no code to show.
 */
export function toggleBeside(overview: DrawnOverview, block: HTMLElement | undefined): void {
  if (besides.get(overview.tab) !== undefined) {
    keepPlace(overview);
    besides.set(overview.tab, undefined);
    return;
  }
  const chosen = besideFor(overview, block);
  if (typeof chosen === 'string') return;
  keepPlace(overview);
  besides.set(overview.tab, blockId(overview.generation, chosen));
}

/** The block the code beside opens for: `block`, or the first with code on screen. Or why none. */
export function besideFor(
  overview: DrawnOverview,
  block: HTMLElement | undefined,
): number | string {
  const chosen = block ?? onScreen(overview).find((each) => codeIn(overview, each) !== undefined);
  const index = chosen && blockNumber(chosen);
  if (!chosen || index === undefined) return 'There’s no block with code on screen.';
  return codeIn(overview, chosen) ? index : 'This block shows no code.';
}

/** Closes the code beside the overview in tab `tab`, if it's open, and says whether it was. */
export function closeBeside(tab: string): boolean {
  if (besides.get(tab) === undefined) return false;
  const overview = drawn.get(tab);
  if (overview) keepPlace(overview);
  besides.set(tab, undefined);
  return true;
}

/**
 * Closes the code beside the overview, if it's open, focus going to the block the reader is at.
 * Says whether it was open.
 */
export function closeBesideAt(overview: DrawnOverview): boolean {
  const block = currentBlock(overview);
  if (!closeBeside(overview.tab)) return false;
  if (block) focusTargetOf(block).focus({ preventScroll: true });
  return true;
}

/** The tabs whose newer overview was asked for, with the tree each showed then, if any. */
const loading = new Map<string, { from: number | undefined }>();

/**
 * Loads the newer overview pushed while tab `tab`'s was read. The blocks it replaces go, and with
 * them what had focus, so once it's drawn the overview itself takes focus: see `loadedNewer`.
 */
export function loadNewer(tab: string): void {
  loading.set(tab, { from: trees.get(tab) });
  main()
    .load({ id: tab })
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
 * block of the overview it shows, which comes on screen with the block given focus.
 */
export function placesFor(tab: string): void {
  if (registered.has(tab)) return;
  registered.add(tab);
  registry().history.register(tab, 'overview', (at) => {
    const tree = trees.get(tab);
    const index = at.kind === 'block' && tree !== undefined ? blockIn(at.block, tree) : undefined;
    if (index === undefined) return false;
    revealCount += 1;
    reveals.set(tab, { block: index, count: revealCount });
    showMiddle(tab, OVERVIEW_VIEW);
    const overview = drawn.get(tab);
    if (overview) takeReveal(overview);
    return true;
  });
}

/** Forgets the tabs that closed, those not in `open`. */
export function keepPlaces(open: ReadonlySet<string>): void {
  for (const tab of registered) if (!open.has(tab)) registered.delete(tab);
  for (const tab of left.keys()) if (!open.has(tab)) left.delete(tab);
  for (const tab of loading.keys()) if (!open.has(tab)) loading.delete(tab);
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
