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
 * as a popover draws it, the first with the popover's Close. It's drawn at once, the first time, as
 * the view measures it to place it.
 */
export function renderPopover(tab: PullTab): RenderPopover {
  return (host, popover, close) => {
    const root = createRoot(host);
    const draw = ({ threads, pinned, label }: PopoverView) => {
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
        }),
      }));
      root.render(createElement(ThreadPopover, { label, threads: cards }));
    };
    flushSync(() => draw(popover));
    let gone = false;
    return {
      update(next) {
        if (!gone) draw(next);
      },
      destroy() {
        gone = true;
        queueMicrotask(() => root.unmount());
      },
    };
  };
}
