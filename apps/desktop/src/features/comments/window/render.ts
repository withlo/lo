// Draws review threads in the elements a code view makes for them, each a React root of its own,
// which the view keeps up to date and takes down: a thread's card under its line, or, beside lines,
// the threads of one line in the view's popover over the code.

import { ThreadPopover } from '@lo/ui';
import type { PopoverView, RenderPopover, RenderThread, ThreadView } from '@lo/ui/code';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { PullTab } from '../../tab/window/shared.ts';
import { Card } from './Card.tsx';

/**
 * What draws the threads of `tab`'s view in a code view: each thread's card, from what main last
 * sent of it. Its button that opens or collapses it calls `toggle` with its id.
 */
export function renderThreads(tab: PullTab, toggle: (thread: string) => void): RenderThread {
  return (host, thread) => {
    const root = createRoot(host);
    const draw = ({ id, open, focused = false }: ThreadView) => {
      root.render(createElement(Card, { tab, id, open, focused, onToggle: () => toggle(id) }));
    };
    draw(thread);
    let gone = false;
    return {
      update(next) {
        if (!gone) draw(next);
      },
      destroy() {
        gone = true;
        // Not while React may be rendering, as when the view takes threads down in an effect.
        queueMicrotask(() => root.unmount());
      },
    };
  };
}

/**
 * What draws the popover of `tab`'s view, beside lines: the cards of the threads on its line, each
 * as a popover draws it, the first with the popover's Close, and the slot of the comment box open
 * in it: a reply's or an edit's in its thread's card, a new comment's after them. It's drawn at
 * once each time, as the view measures it to place it, and puts the box in its slot.
 */
export function renderPopover(tab: PullTab): RenderPopover {
  return (host, popover, close) => {
    const root = createRoot(host);
    const draw = ({ threads, pinned, label, box }: PopoverView) => {
      const cards = threads.map(({ id }, index) => ({
        id,
        card: createElement(Card, {
          tab,
          id,
          open: true,
          focused: pinned,
          onToggle: () => {},
          popover: true,
          onClose: index === 0 ? close : undefined,
          box: box?.thread === id ? { edits: box.edits } : undefined,
        }),
      }));
      const alone = box !== undefined && box.thread === undefined;
      root.render(createElement(ThreadPopover, { label, threads: cards, box: alone }));
    };
    flushSync(() => draw(popover));
    let gone = false;
    return {
      // At once too: a comment box opening in it goes in the slot drawn for it.
      update(next) {
        if (!gone) flushSync(() => draw(next));
      },
      destroy() {
        gone = true;
        queueMicrotask(() => root.unmount());
      },
    };
  };
}
