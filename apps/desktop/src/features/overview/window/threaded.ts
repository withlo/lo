// The review threads on an overview's code blocks, which another feature, such as the comments,
// places and draws, and the comments written on a block, under its lines. A block asks for its
// threads as it's drawn, and again each time they change, and gives them to its code view, which
// has the threader draw each one in an element of its own; what would move a line on screen waits
// in the view. A block waits a moment for its tab's threads before it's first drawn, so those on
// its lines come with it. Each block drawn is kept here while it is, as the keys and menus find it.

import type {
  BoxFrame,
  ComposeOptions,
  Composer,
  ComposerEvents,
  ExcerptView,
  Place,
  RenderThread,
  Span,
  ThreadView,
} from '@lo/ui/code';
import type { Target } from '@lo/ui/commands';
import { BLOCK_ATTRIBUTE, blockNumber } from '@lo/ui/overview';

import type { PullTab } from '../../tab/window/shared.ts';
import { blockId } from './blocks.ts';

/** A code block as drawn, as its threads are placed on it and comments are written on it. */
export interface DrawnBlock {
  /** The pull request's tab, by its view's id. */
  readonly tab: string;
  /**
   * What the block is known by, a restart included: the commit the overview describes and the file
   * and lines it points at ({@link blockKey}).
   */
  readonly key: string;
  /** Its id, as the block keys and menus name it. */
  readonly block: string;
  /** Its code view's id for its file, which the places of its threads and boxes name. */
  readonly file: string;
  /** The file's path at `commit`. */
  readonly path: string;
  /** The commit the overview describes, whose lines it shows. */
  readonly commit: string;
  /** The commit its older side starts from, for a stack's layer; none for the pull request's base. */
  readonly from: string | null;
  /** The lines it points at, at `commit`, within the file. */
  readonly lines: { readonly start: number; readonly end: number };
  /** The lines its `:::code` names, as its key has them, past the file's end or not. */
  readonly named: { readonly start: number; readonly end: number };
}

/** A code block on screen, where a comment is written under one of its lines. */
export interface WritingBlock {
  readonly block: DrawnBlock;
  /**
   * Opens a comment box with `draft` in it, under a line the block shows or the last line of a
   * span, with `frame` drawn around its editor, focused unless `options.focus` is false. A box
   * already open there is the one it gives. It throws for a line the block doesn't show.
   */
  compose(
    at: Place | Span,
    draft: string,
    on: ComposerEvents,
    frame?: BoxFrame,
    options?: ComposeOptions,
  ): Composer;
}

/** What places and draws the review threads on overview blocks, and opens the boxes there. */
export interface BlockThreads {
  /** The threads on `block`'s lines, placed on its code view's lines. */
  threadsOn(block: DrawnBlock): readonly ThreadView[];
  /** Whether tab `tab`'s threads' first read has ended, or there are none to read. */
  settled(tab: string): boolean;
  /**
   * What draws the threads of `tab`'s blocks in the elements a code view makes for them. A
   * thread's own button that opens or collapses it calls `toggle` with its id.
   */
  render(tab: PullTab, toggle: (thread: string) => void): RenderThread;
  /** `block` was drawn: the boxes open under its lines open again there, unfocused. */
  drawn(block: WritingBlock): void;
}

/** How long a block, the first time its code is ready, waits for its threads' first read. */
export const WAIT_FOR_THREADS = 1_000;

let current: BlockThreads | undefined;

/** Each tab's listeners, which ask for its blocks' threads again. */
const listeners = new Map<string, Set<() => void>>();

/** Takes `given` as what places and draws the blocks' threads. Returns a function that lets it go. */
export function blockThreadsWith(given: BlockThreads): () => void {
  current = given;
  for (const tab of listeners.keys()) changed(tab);
  return () => {
    if (current !== given) return;
    current = undefined;
    for (const tab of listeners.keys()) changed(tab);
  };
}

/** What places and draws the blocks' threads now, if anything does. */
export function blockThreader(): BlockThreads | undefined {
  return current;
}

/** Says tab `tab`'s threads changed, so its blocks drawn ask for them again. */
export function changed(tab: string): void {
  for (const listener of listeners.get(tab) ?? []) listener();
}

/** Calls `listener` each time tab `tab`'s threads change. Returns a function that stops it. */
export function onBlockThreads(tab: string, listener: () => void): () => void {
  let each = listeners.get(tab);
  if (!each) {
    each = new Set();
    listeners.set(tab, each);
  }
  each.add(listener);
  return () => {
    const kept = listeners.get(tab);
    kept?.delete(listener);
    if (kept?.size === 0) listeners.delete(tab);
  };
}

/**
 * Resolves once tab `tab`'s threads' first read has ended, or after `wait` milliseconds, or at
 * once with nothing to place them.
 */
export function threadsSettled(tab: string, wait = WAIT_FOR_THREADS): Promise<void> {
  return new Promise((resolve) => {
    if (current?.settled(tab) !== false) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, wait);
    const stop = onBlockThreads(tab, () => {
      if (current?.settled(tab) !== false) done();
    });
  });
}

/**
 * The key of a code block that points at `path`'s lines `start` to `end`, of an overview that
 * describes `commit`.
 */
export function blockKey(commit: string, path: string, start: number, end: number): string {
  return JSON.stringify([commit.toLowerCase(), path, start, end]);
}

/** A block drawn, and its code view. */
interface Drawn {
  readonly writing: WritingBlock;
  readonly view: ExcerptView;
  /** The element around its code view, in the overview's article. */
  readonly element: HTMLElement;
}

/** The blocks drawn, by their code views' ids for their files. */
const drawnBlocks = new Map<string, Drawn>();

/**
 * The id of the article's block that `element` is in, by tree `tree`, if it's in one.
 */
export function blockIdOf(element: Element, tree: number): string | undefined {
  const block = element.closest(`[${BLOCK_ATTRIBUTE}]`);
  const index = block ? blockNumber(block) : undefined;
  return index === undefined ? undefined : blockId(tree, index);
}

/**
 * Keeps `block`, drawn in `view` in `element`, as the keys and menus find it, and tells the
 * threader, which opens its boxes again. Returns a function that forgets it.
 */
export function drawBlock(block: DrawnBlock, view: ExcerptView, element: HTMLElement): () => void {
  const writing: WritingBlock = {
    block,
    compose: (at, draft, on, frame, options) => view.compose(at, draft, on, frame, options),
  };
  const entry: Drawn = { writing, view, element };
  drawnBlocks.set(block.file, entry);
  current?.drawn(writing);
  return () => {
    if (drawnBlocks.get(block.file) === entry) drawnBlocks.delete(block.file);
  };
}

/** Tab `tab`'s block with key `key`, while it's drawn. */
export function writingBlockKeyed(tab: string, key: string): WritingBlock | undefined {
  for (const { writing } of drawnBlocks.values()) {
    if (writing.block.tab === tab && writing.block.key === key) return writing;
  }
  return undefined;
}

/** What a comment on a block goes under: the block, and the line or lines of it. */
export interface BlockLines {
  readonly writing: WritingBlock;
  readonly at: Place | Span;
}

/**
 * The code block `target` names in tab `tab`, and its lines a comment is on: for a line in a
 * block's code, as a key there names it, that line or the lines `v` selected; for a block, as a
 * key on it or its menu names it, the lines it points at. Or why there's none.
 */
export function blockLinesOf(tab: string, target: Target): BlockLines | string {
  if (target.kind === 'line') {
    const drawn = drawnBlocks.get(target.at.file);
    if (drawn?.writing.block.tab !== tab)
      return 'Comments are written in the diff or on a code block.';
    return { writing: drawn.writing, at: target.at };
  }
  if (target.kind !== 'block') return 'No code block has focus. ] b goes to the next one.';
  for (const { writing } of drawnBlocks.values()) {
    const { block } = writing;
    if (block.tab !== tab || block.block !== target.block) continue;
    const { file, lines } = block;
    return { writing, at: { file, side: 'new', from: lines.start, to: lines.end } };
  }
  return 'There’s no code drawn in this block to comment on.';
}
