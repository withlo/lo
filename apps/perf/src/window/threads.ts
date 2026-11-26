// The suite's review threads, drawn as plain text through the diff view's `renderThread`: each
// comment's author and body, in a card. The view places them and keeps them; this draws them, and
// draws a thread again when the view says it changed. Beside lines, as Lo starts, each is its mark,
// and the threads of a line are drawn the same in the view's popover, with the slot a new comment's
// box goes in after them.

import type {
  DiffView,
  Place,
  PopoverContent,
  PopoverView,
  ThreadContent,
  ThreadView,
} from '@lo/ui/code';

/** The attribute of the element a popover's new comment's box goes in (`NEW_SLOT` in `@lo/ui`). */
const NEW_SLOT = 'data-new-slot';

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
    const words = { lines: `line ${at.line}`, line: `line ${at.line}` };
    const mark = { resolved: false, words };
    this.#threads.set(key, { view: { id, at, open: true, version, mark }, comments });
  }

  /** Adds `comment` to the thread under the line at `at`, or starts one. */
  add(at: Place, comment: Comment): void {
    this.put(at, [...(this.#threads.get(placeKey(at))?.comments ?? []), comment]);
  }

  /** Gives `view` the threads, drawn as plain text, under their lines or in its popover. */
  show(view: DiffView): void {
    view.setThreads(
      [...this.#threads.values()].map((thread) => thread.view),
      (host, thread) => this.#draw(host, thread),
      { popover: (host, popover) => this.#drawPopover(host, popover) },
    );
  }

  /** Draws a thread's comments in `host`, and again as it changes. */
  #draw(host: HTMLElement, thread: ThreadView): ThreadContent {
    const fill = (shown: ThreadView): void => host.replaceChildren(this.#card(shown.id));
    fill(thread);
    return { update: fill, destroy: () => host.replaceChildren() };
  }

  /**
   * Draws the threads of a line in the view's popover, each a card as under its line, and the slot
   * of a new comment's box open in it; and again as they change.
   */
  #drawPopover(host: HTMLElement, popover: PopoverView): PopoverContent {
    const fill = (shown: PopoverView): void => {
      const cards = shown.threads.map(({ id }) => {
        const card = this.#card(id);
        card.dataset.threadId = id;
        return card;
      });
      const slot = document.createElement('div');
      slot.setAttribute(NEW_SLOT, '');
      const box = shown.box !== undefined && shown.box.thread === undefined;
      host.replaceChildren(...cards, ...(box ? [slot] : []));
    };
    fill(popover);
    return { update: fill, destroy: () => host.replaceChildren() };
  }

  /** Thread `id`'s comments, each its author and body, in a card. */
  #card(id: string): HTMLElement {
    const card = document.createElement('div');
    card.className = 'perf-thread';
    const drawn = [...this.#threads.values()].find((each) => each.view.id === id);
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
    return card;
  }
}

function placeKey(place: Place): string {
  return `${place.file}:${place.side}:${place.line}`;
}
