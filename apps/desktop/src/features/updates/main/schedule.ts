// When Lo checks for a newer version by itself: a while after its window is up, then every 6 hours,
// while `updates.check` is on. A check asked for counts too, so the next comes 6 hours after it.
// The time is the clock's, looked at every few minutes, so a computer that slept through a check
// makes it soon after it wakes. Nothing here calls Electron, so it runs under unit tests.

/** How long after the window is up Lo first checks, in ms. */
export const FIRST_CHECK = 30_000;

/** How long after the window is up Lo first checks a feed on this machine, for its tests, in ms. */
export const FIRST_LOCAL_CHECK = 1_000;

/** How long Lo waits between checks, in ms. */
export const CHECK_EVERY = 6 * 60 * 60 * 1000;

/** How often Lo looks at the clock while it waits for the next check, in ms. */
const LOOK_EVERY = 5 * 60 * 1000;

export class Schedule {
  readonly #check: () => void;
  readonly #first: number;
  /** When the window came up, once it has. */
  #up: number | undefined;
  /** `updates.check`, once the settings file has been read. */
  #on: boolean | undefined;
  /** When Lo last checked, whoever asked. */
  #last: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;

  /** Calls `check` for each check Lo makes by itself, the first `first` ms after the window is up. */
  constructor(check: () => void, first: number) {
    this.#check = check;
    this.#first = first;
  }

  /** The window is up: the first check comes a while after. */
  up(): void {
    this.#up ??= Date.now();
    this.#plan();
  }

  /** `updates.check` is `on`: checks by itself, or only when asked to. */
  timed(on: boolean): void {
    this.#on = on;
    this.#plan();
  }

  /** Lo has just checked, as asked: the next check by itself comes the interval after. */
  checked(): void {
    this.#last = Date.now();
    this.#plan();
  }

  /** Stops for good: Lo is quitting. */
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** When the next check by itself is due, or nothing when none is. */
  #due(): number | undefined {
    if (this.#stopped || this.#up === undefined || this.#on !== true) return undefined;
    return this.#last === undefined ? this.#up + this.#first : this.#last + CHECK_EVERY;
  }

  #plan(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const due = this.#due();
    if (due === undefined) return;
    const wait = due - Date.now();
    if (wait <= 0) {
      this.#last = Date.now();
      this.#check();
      this.#plan();
      return;
    }
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#plan();
      },
      Math.min(wait, LOOK_EVERY),
    );
  }
}
