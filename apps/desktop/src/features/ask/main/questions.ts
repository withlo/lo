// The question main is asking in the window, one at a time for all of Lo, and what ends it: the
// reader's answer to it, by its id, from the window it was asked in; or Cancel, as the window closes,
// the asker gives up, or Lo quits. Nothing here calls Electron, so it runs under unit tests.

import type { Question } from '../contract.ts';
import type { Asked, Asking } from '../service.ts';

/** The window a question is asked in, while it's up. */
export interface QuestionWindow {
  /** Calls `listener` once the window closes. Returns a function that stops it. */
  onClosed(listener: () => void): () => void;
}

export interface QuestionsOptions {
  /** The window with Electron's id `id`, while it's open. */
  readonly window: (id: number) => QuestionWindow | undefined;
  /** Tells the window the question being asked, or that none is. */
  readonly publish: (question: Question | null) => void;
  /** A new question's id, which nothing else can guess. */
  readonly newId?: () => string;
}

/** The question up: what it asks, the window it's asked in, and what answers it. */
interface Up {
  readonly question: Question;
  readonly window: number;
  readonly end: (act: boolean) => void;
}

export class Questions implements Asking {
  readonly #options: QuestionsOptions;
  #up: Up | undefined;

  constructor(options: QuestionsOptions) {
    this.#options = options;
  }

  /** The question being asked, or none. */
  get current(): Question | null {
    return this.#up?.question ?? null;
  }

  ask(window: number | undefined, asked: Asked, signal?: AbortSignal): Promise<boolean> {
    const shown = window === undefined ? undefined : this.#options.window(window);
    // Never two at once: the one up stays, and this one is Cancel.
    if (window === undefined || !shown || signal?.aborted || this.#up) {
      return Promise.resolve(false);
    }
    const question: Question = { ...asked, id: this.#options.newId?.() ?? crypto.randomUUID() };
    return new Promise((resolve) => {
      const cancel = () => end(false);
      const stop = shown.onClosed(cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      const end = (act: boolean) => {
        if (this.#up?.question !== question) return;
        this.#up = undefined;
        stop();
        signal?.removeEventListener('abort', cancel);
        this.#options.publish(null);
        resolve(act);
      };
      this.#up = { question, window, end };
      this.#options.publish(question);
    });
  }

  /**
   * The reader's answer to question `id`, from window `window`: its action (`act`), or Cancel. Only
   * the question up counts, from the window it's asked in; any other answer is ignored.
   */
  answer(window: number | undefined, id: string, act: boolean): void {
    const up = this.#up;
    if (!up || up.question.id !== id || up.window !== window) return;
    up.end(act);
  }

  /** Ends the question up as Cancel, as Lo quits. */
  stop(): void {
    this.#up?.end(false);
  }
}
