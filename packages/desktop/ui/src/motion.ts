import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Whether Lo moves: `system` follows the system's Reduce Motion setting, `reduce` turns every move
 * off whatever the system says, and `full` keeps them on.
 */
export type Motion = 'system' | 'reduce' | 'full';

/** The attribute on `<html>` that the design system's Reduce Motion rule reads. */
const ATTRIBUTE = 'data-lo-motion';

const QUERY = '(prefers-reduced-motion: reduce)';

const listeners = new Set<() => void>();

/**
 * Sets whether Lo moves, for the whole window: the one switch. It writes `data-lo-motion` on
 * `<html>`, which the stylesheet's Reduce Motion rule reads, and tells whatever moves from a
 * script. Without a call, Lo follows the system.
 */
export function setMotion(to: Motion): void {
  const root = document.documentElement;
  if (to === 'system') root.removeAttribute(ATTRIBUTE);
  else root.setAttribute(ATTRIBUTE, to);
  for (const listener of listeners) listener();
}

/** What `setMotion` last set, or `system`. */
export function motion(): Motion {
  const set = globalThis.document?.documentElement.getAttribute(ATTRIBUTE);
  return set === 'reduce' || set === 'full' ? set : 'system';
}

/**
 * Whether moves are off now. Anything that moves from a script asks this first, and shows where it
 * would have ended instead: the stylesheet's rule only reaches CSS transitions and animations.
 */
export function motionReduced(): boolean {
  const set = motion();
  if (set !== 'system') return set === 'reduce';
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const system = globalThis.matchMedia?.(QUERY);
  system?.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    system?.removeEventListener('change', listener);
  };
}

/** `motionReduced`, kept up to date as the switch or the system's setting changes. */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => false);
}

/**
 * Runs `then` once the transitions and animations on `element` itself have ended, or at once where
 * there are none to wait for. Returns what calls it off. It waits a frame first, since a
 * transition starts with the frame that draws the change.
 */
export function whenSettled(element: Element | null, then: () => void): () => void {
  if (!element || typeof element.getAnimations !== 'function') {
    then();
    return () => {};
  }
  let off = false;
  const frame = requestAnimationFrame(() => {
    const running = element
      .getAnimations()
      // A loop never ends, and isn't a move.
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    // A move cut short by the next one rejects, and that one is waited for by its own call.
    void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
      if (!off) then();
    });
  });
  return () => {
    off = true;
    cancelAnimationFrame(frame);
  };
}

/**
 * Calls `closed` as `open` turns false, before the frame that starts the exit is drawn: focus goes
 * back and what was chosen runs at once, while the popup fades. Nothing waits on an animation.
 */
export function useOnClose(open: boolean, closed: () => void): void {
  const was = useRef(open);
  const latest = useRef(closed);
  latest.current = closed;
  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    if (!open) latest.current();
  }, [open]);
}

/**
 * What a popup shows, held as it was while the popup leaves: a caller may clear what it showed the
 * moment it closes, and the popup fades with its last words, not empty.
 */
export function useHeld<T>(open: boolean, value: T): T {
  const held = useRef(value);
  if (open) held.current = value;
  return held.current;
}

/**
 * Gives focus back to `to` as a popup closes, when focus is still in the popup or has been dropped,
 * and leaves focus that went somewhere else by itself where it is. A press outside a popup can
 * close it before the press has moved focus, and then drops what was just given back, so it looks
 * again a frame on.
 */
export function giveFocusBack(
  to: HTMLElement | SVGElement | null | undefined,
  popup: Element | null,
): void {
  const give = () => {
    if (!to?.isConnected) return;
    const active = document.activeElement;
    const lost = active === null || active === document.body || !active.isConnected;
    if (lost || popup?.contains(active)) to.focus({ preventScroll: true });
  };
  give();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(give);
}

/** The class of the Land move, for a view that draws its own rows, such as a code view's lines. */
export const LAND_CLASS = 'move-land';

let landed: { element: Element; stop: () => void } | undefined;

/**
 * Marks where a jump landed: the scroll itself is instant, and `element`, the target, takes a tint
 * that fades. One target shows at a time, so a jump made again before the last has faded, as a
 * held key does, takes the tint off the last at once.
 */
export function land(element: Element): void {
  landed?.stop();
  // Taking the class off and reading a size starts the fade afresh on the same target.
  void element.getBoundingClientRect();
  element.classList.add(LAND_CLASS);
  const stop = () => {
    element.classList.remove(LAND_CLASS);
    element.removeEventListener('animationend', ended);
    element.removeEventListener('animationcancel', ended);
    if (landed?.element === element) landed = undefined;
  };
  const ended = (event: Event) => {
    if (event.target === element) stop();
  };
  element.addEventListener('animationend', ended);
  element.addEventListener('animationcancel', ended);
  landed = { element, stop };
}
