// Whether there are overviews in main, as the settings file says: off until Lo has read it, so
// nothing is read for overviews that turn out to be off. Turning them off closes every tab's
// overview, and on reads each open tab's again; then the features that read for overviews are told.

import type { OverviewSwitch } from '../service.ts';

/** The tabs a turn goes through. */
export interface Turning {
  /** The tabs whose overview is followed now. */
  followed(): Iterable<string>;
  /** The pull requests' tabs open now. */
  open(): readonly string[];
  /** Follows tab `id`'s overview as things stand: closes it while overviews are off. */
  follow(id: string): void;
}

export class Overviews implements OverviewSwitch {
  #on = false;
  readonly #listeners = new Set<(on: boolean) => void>();

  on(): boolean {
    return this.#on;
  }

  onChange(listener: (on: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Turns overviews on or off: off, every followed tab's overview closes, and nothing more is read;
   * on, each open tab's is read again. Then each listener is told. A turn to how they are does
   * nothing.
   */
  turn(now: boolean, tabs: Turning): void {
    if (now === this.#on) return;
    this.#on = now;
    for (const id of tabs.followed()) tabs.follow(id);
    if (now) for (const id of tabs.open()) tabs.follow(id);
    for (const listener of this.#listeners) listener(now);
  }

  /** Off again, as before the file was read, with no one listening: as the feature stops. */
  reset(): void {
    this.#on = false;
    this.#listeners.clear();
  }
}
