// What the overview reads of the stack a pull request is a layer of, and does with it, which the
// stacks give it as they start (`setStackParts`): the stack each view is in, the way to show one of
// its layers, and the way to show the whole stack as one diff, where a stack overview's code goes.
// The stacks' window code reads the overview's own, for the stack overview's row in their tree, so
// the overview's never reads theirs back.

import { useSyncExternalStore } from 'react';

import type { StackView } from '../../stacks/contract.ts';
import type { PullTab } from '../../tab/window/shared.ts';

/** Lines of a file, first and last. */
export interface StackLines {
  readonly start: number;
  readonly end: number;
}

/** What the stacks give the overview. */
export interface StackParts {
  /** The stack view `id` of a pull request's tab is in, as main last said: none until it has. */
  viewOf(id: string): StackView | undefined;
  /** Calls `listener` as any view's stack changes. Returns a function that stops it. */
  onViews(listener: () => void): () => void;
  /** Asks main for the stack view `id` is in, when it hasn't said. */
  ask(id: string): void;
  /** Shows layer `number` of the stack `tab` is in, as `⏎` on its row in the stack's tree does. */
  showLayer(tab: PullTab, number: number): void;
  /**
   * Shows the whole stack `tab` is in as one diff, at `path`, its lines `lines` marked: up to the
   * layer whose head is `commit`, the one the stack overview describes.
   */
  showAt(tab: PullTab, path: string, lines: StackLines | undefined, commit: string): void;
}

let parts: StackParts | undefined;
let stopViews: (() => void) | undefined;
const listeners = new Set<() => void>();

/** Calls every listener, as the stacks say a view's stack changed. */
function changed(): void {
  // One that stops itself as it's told is taken out of the set this goes through.
  for (const listener of listeners) listener();
}

/** Takes what the stacks give the overview, until the function it returns takes it back. */
export function setStackParts(given: StackParts): () => void {
  stopViews?.();
  parts = given;
  stopViews = given.onViews(changed);
  changed();
  return () => {
    if (parts !== given) return;
    stopViews?.();
    stopViews = undefined;
    parts = undefined;
  };
}

/** The stack view `id` is in, as the stacks last said: none until they have. */
export function stackViewOf(id: string): StackView | undefined {
  return parts?.viewOf(id);
}

/** Calls `listener` as any view's stack changes. Returns a function that stops it. */
export function onStackViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stack view `id` is in, re-rendering as it changes. */
export function useStackView(id: string): StackView | undefined {
  return useSyncExternalStore(onStackViews, () => stackViewOf(id));
}

/** Asks the stacks for the stack view `id` is in, when they haven't said. */
export function askForStack(id: string): void {
  parts?.ask(id);
}

/** Shows layer `number` of the stack `tab` is in. */
export function showStackLayer(tab: PullTab, number: number): void {
  parts?.showLayer(tab, number);
}

/**
 * Shows the whole stack `tab` is in as one diff, at `path`, its lines `lines` marked, up to the
 * layer whose head is `commit`.
 */
export function showWholeStackAt(
  tab: PullTab,
  path: string,
  lines: StackLines | undefined,
  commit: string,
): void {
  parts?.showAt(tab, path, lines, commit);
}
