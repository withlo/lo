// The suite's review threads, drawn as plain text through the diff view's `renderThread`: each
// comment's author and body, in a card. The view places them and keeps them; this draws them, and
// draws a thread again when the view says it changed.

import type { DiffView, Place, ThreadContent, ThreadView } from '@lo/ui/code';

/** A comment in a thread, as plain text. */
export interface Comment {
  author: string;
  body: string;
}

/** The threads, one under a line, by the line. */
export class PlainThreads {
  readonly #threads = new Map<string, { view: ThreadView; comments: readonly Comment[] }>();

  /** Puts `comments` under the line at `at`, in place of the thread there, if there is one. */
  put(at: Place, comments: readonly Comment[]): void {
    const key = placeKey(at);
    const there = this.#threads.get(key);
    const id = there?.view.id ?? `thread-${this.#threads.size}`;
    const version = (there?.view.version ?? 0) + 1;
    this.#threads.set(key, { view: { id, at, open: true, version }, comments });
  }

  /** Adds `comment` to the thread under the line at `at`, or starts one. */
  add(at: Place, comment: Comment): void {
    this.put(at, [...(this.#threads.get(placeKey(at))?.comments ?? []), comment]);
  }

  /** Gives `view` the threads, drawn as plain text. */
  show(view: DiffView): void {
    view.setThreads(
      [...this.#threads.values()].map((thread) => thread.view),
      (host, thread) => this.#draw(host, thread),
    );
  }

  /** Draws a thread's comments in `host`, and again as it changes. */
  #draw(host: HTMLElement, thread: ThreadView): ThreadContent {
    const fill = (shown: ThreadView): void => {
      const card = document.createElement('div');
      card.className = 'perf-thread';
      const drawn = [...this.#threads.values()].find((each) => each.view.id === shown.id);
      for (const comment of drawn?.comments ?? []) {
        const item = document.createElement('div');
        item.className = 'perf-thread__comment';
        const author = document.createElement('div');
        author.className = 'perf-thread__author';
        author.textContent = comment.author;
        const body = document.createElement('p');
        body.className = 'perf-thread__body';
        body.textContent = comment.body;
        item.append(author, body);
        card.append(item);
      }
      host.replaceChildren(card);
    };
    fill(thread);
    return { update: fill, destroy: () => host.replaceChildren() };
  }
}

function placeKey(place: Place): string {
  return `${place.file}:${place.side}:${place.line}`;
}
