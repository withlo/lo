// Where Lo is for the person at the computer, which sets how often Lo reads GitHub: the window in
// front, on screen behind or beside the window in front, or away (`Presence` in `@lo/github`). It's
// worked out from what the system says of Lo's windows and the screen (`screen.ts`), and heard by
// whatever reads GitHub on a schedule. Nothing here calls Electron.

import type { Presence } from '@lo/github';

/** What the system says of Lo's windows and the screen. */
export interface Sight {
  /** Whether a window of Lo's has focus. */
  readonly focused: boolean;
  /** Whether a window of Lo's is on screen: shown, and not minimized. */
  readonly shown: boolean;
  /** Whether the screen is locked. */
  readonly locked: boolean;
}

/**
 * Where Lo is, given what the system says: away while no window of Lo's is on screen or the screen
 * is locked, in front while one has focus, and otherwise on screen behind another window.
 */
export function presenceOf({ focused, shown, locked }: Sight): Presence {
  if (locked || !shown) return 'away';
  return focused ? 'front' : 'shown';
}

/** Where Lo is now, and who hears it each time that changes. */
export class Presences {
  #presence: Presence;
  readonly #listeners = new Set<(presence: Presence) => void>();

  /** Where Lo is as it starts, given what the system says then. */
  constructor(sight: Sight) {
    this.#presence = presenceOf(sight);
  }

  /** Where Lo is now. */
  get presence(): Presence {
    return this.#presence;
  }

  /** What the system says now: each listener hears where Lo is, if that changed. */
  look(sight: Sight): void {
    const presence = presenceOf(sight);
    if (presence === this.#presence) return;
    this.#presence = presence;
    for (const listener of this.#listeners) listener(presence);
  }

  /**
   * Calls `listener` with where Lo is now, then each time that changes, until the returned function
   * is called.
   */
  watch(listener: (presence: Presence) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#presence);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
