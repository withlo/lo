// An overview's first frame, and the code blocks that draw before it: a code block near the screen
// as the overview is first laid out draws its code before the overview is seen, so it's seen at its
// height. The overview is shown once every such block has drawn, or said why it can't, or once the
// bound passes, whichever is first; after that, a block's code coming moves nothing on screen as
// `Held` keeps it.

import { createContext, useContext } from 'react';

/** What a shown overview's blocks tell it as it's first laid out. */
export interface FirstDraw {
  /**
   * Says a block will draw before the overview is seen, until the function it returns is called:
   * once the block has drawn, or found it's far from the screen, or that it can't.
   */
  begin(): () => void;
  /** Settles once the overview is seen: drawn, in the middle view on screen. */
  readonly seen: Promise<void>;
  /** Whether the overview has been the middle view on screen, rather than kept behind another. */
  onScreen(): boolean;
}

/**
 * A first frame being drawn: `settle` once each block has said it'll draw, `open` at the bound,
 * and `show` once the overview is the middle view on screen.
 */
export interface Drawing extends FirstDraw {
  settle(): void;
  open(): void;
  show(): void;
}

/** A first frame being drawn, which calls `opened` once, as it's drawn. */
export function drawing(opened: () => void): Drawing {
  let pending = 0;
  let settled = false;
  let open = false;
  let shown = false;
  let drawn!: () => void;
  let onScreen!: () => void;
  const both = [
    new Promise<void>((resolve) => (drawn = resolve)),
    new Promise<void>((resolve) => (onScreen = resolve)),
  ];
  const draw = () => {
    if (open) return;
    open = true;
    drawn();
    opened();
  };
  return {
    seen: Promise.all(both).then(() => undefined),
    onScreen: () => shown,
    show() {
      shown = true;
      onScreen();
    },
    begin() {
      if (open) return () => {};
      pending += 1;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        pending -= 1;
        if (settled && pending === 0) draw();
      };
    },
    settle() {
      settled = true;
      if (pending === 0) draw();
    },
    open: draw,
  };
}

export const FirstDrawContext = createContext<FirstDraw | undefined>(undefined);

/** The first frame the overview's blocks draw before, if it's still to come. */
export function useFirstDraw(): FirstDraw | undefined {
  return useContext(FirstDrawContext);
}
