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
  /** Settles once the overview is seen. */
  readonly seen: Promise<void>;
}

/** A first frame being drawn: `settle` once each block has said it'll draw, `open` at the bound. */
export interface Drawing extends FirstDraw {
  settle(): void;
  open(): void;
}

/** A first frame being drawn, which calls `opened` once, as it's seen. */
export function drawing(opened: () => void): Drawing {
  let pending = 0;
  let settled = false;
  let open = false;
  let seen!: () => void;
  const promise = new Promise<void>((resolve) => (seen = resolve));
  const show = () => {
    if (open) return;
    open = true;
    seen();
    opened();
  };
  return {
    seen: promise,
    begin() {
      if (open) return () => {};
      pending += 1;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        pending -= 1;
        if (settled && pending === 0) show();
      };
    },
    settle() {
      settled = true;
      if (pending === 0) show();
    },
    open: show,
  };
}

export const FirstDrawContext = createContext<FirstDraw | undefined>(undefined);

/** The first frame the overview's blocks draw before, if it's still to come. */
export function useFirstDraw(): FirstDraw | undefined {
  return useContext(FirstDrawContext);
}
