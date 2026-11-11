// Focus that follows a dialog's main button from one step to the next.

import { useEffect, type RefObject } from 'react';

/**
 * Focuses `ref`'s element each time `step` changes. It waits two frames: when the focused button
 * went with the last step, the dialog gives focus to itself, then again on the next frame, which
 * would otherwise take it back.
 */
export function useFocusOnStep(ref: RefObject<HTMLElement | null>, step: unknown): void {
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => ref.current?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, step]);
}
