// Draws review threads in the elements a code view makes for them, each a React root of its own,
// which the view keeps up to date and takes down.

import type { RenderThread, ThreadView } from '@lo/ui/code';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type { PullTab } from '../../tab/window/shared.ts';
import { Card } from './Card.tsx';
import type { PostPull } from './Post.tsx';

/**
 * What draws the threads of `tab`'s view in a code view: each thread's card, from what main last
 * sent of it. Its button that opens or collapses it calls `toggle` with its id.
 */
export function renderThreads(tab: PullTab, toggle: (thread: string) => void): RenderThread {
  const view = tab.id;
  const pull: PostPull = { owner: tab.owner, repo: tab.repo, number: tab.number };
  return (host, thread) => {
    const root = createRoot(host);
    const draw = ({ id, open }: ThreadView) => {
      root.render(createElement(Card, { view, pull, id, open, onToggle: () => toggle(id) }));
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
