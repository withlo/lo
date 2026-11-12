// Image figures' decodes, one at a time across the window, in the order they're asked for. A
// decode takes memory and time for its image's whole size, whatever size it's drawn at, and an
// overview may show a hundred figures of 40 megapixels each.

/** A decode, run when its turn comes. */
export type Decode = () => Promise<void>;

export class Decodes {
  readonly #waiting = new Set<Decode>();
  #running: Promise<void> | undefined;

  /** Asks for `decode` to run in its turn. Returns a function that withdraws it, unless it's begun. */
  ask(decode: Decode): () => void {
    this.#waiting.add(decode);
    this.#next();
    return () => {
      this.#waiting.delete(decode);
    };
  }

  /** How many wait for their turn, the running one aside. */
  get waiting(): number {
    return this.#waiting.size;
  }

  /** Whether one is running. */
  get running(): boolean {
    return this.#running !== undefined;
  }

  /** Resolves once none is running or waiting. */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  #next(): void {
    if (this.#running) return;
    const [decode] = this.#waiting;
    if (!decode) return;
    this.#waiting.delete(decode);
    this.#running = decode()
      .catch(() => undefined)
      .finally(() => {
        this.#running = undefined;
        this.#next();
      });
  }
}

/** The window's decodes. */
export const decodes = new Decodes();
