import { createContext, useContext, useMemo, useRef, type HTMLAttributes } from 'react';

import { useGiveUp } from './giveUp.ts';

/** Whether the row a hint is in draws its hints without their key chips. */
const Squeezed = createContext(false);

/** Whether the `HintRow` around a hint has given up its key chips, which its tooltip then gives. */
export function useHintsSqueezed(): boolean {
  return useContext(Squeezed);
}

export interface HintRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * What it gives up after its hints' key chips, where it still doesn't fit, a step at a time, as
   * `useGiveUp` names them: the same steps from draw to draw.
   */
  more?: readonly string[] | undefined;
}

/** What a row of hints gives up where it's too narrow for them: their key chips. */
const STEPS = ['keys'];

/**
 * A row of hints, `HintButton`s, on one line that never wraps or runs past its end. Where its
 * hints with their key chips don't fit, it draws them without, and each hint gives its key in its
 * tooltip instead; where it still doesn't fit, it gives up what `more` names. It measures, rather
 * than taking a width to give them up at, since a key is wider on one system than another: `⏎` on
 * macOS is "Enter" on Linux.
 */
export function HintRow({ className, children, more, ...props }: HintRowProps) {
  const row = useRef<HTMLDivElement | null>(null);
  const steps = useMemo(() => (more ? [...STEPS, ...more] : STEPS), [more]);
  const squeezed = useGiveUp(row, steps) > 0;
  return (
    <div
      ref={row}
      className={`give-up flex overflow-hidden whitespace-nowrap ${className ?? ''}`}
      {...props}
    >
      <Squeezed.Provider value={squeezed}>{children}</Squeezed.Provider>
    </div>
  );
}
