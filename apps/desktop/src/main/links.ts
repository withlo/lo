// Links other apps hand Lo: a `lo://` or web link the system opens Lo with, as an event or, from
// the `lo` command, as an argument to a new Lo that hands its arguments to the one running. Each
// is untrusted, and goes to one place, the open feature's `link`, which reads it as any typed link.
// Main gathers them here from the moment it starts, before the feature is there to take them.

/** The longest link Lo takes from another app. */
export const LINK_LIMIT = 2048;

/** The most links Lo keeps waiting, and takes from one command line. Past it, the rest are dropped. */
export const MOST_LINKS = 20;

/** The schemes a link from another app may have: Lo's own, and the web's. */
const LINK = /^(?:lo|https?):\/\//i;

/** Whether `argument` is a link Lo takes from another app: `lo://`, `https://` or `http://`. */
export function isIncomingLink(argument: string): boolean {
  return argument.length <= LINK_LIMIT && LINK.test(argument);
}

/**
 * The links in a command line, in order, and no more than {@link MOST_LINKS}: the arguments that are
 * links, and nothing else. A packaged Lo has quit already on any argument that starts with `-`;
 * one built from source is started with switches and its own folder, which are no links.
 */
export function linksIn(argv: readonly string[]): string[] {
  return argv.filter(isIncomingLink).slice(0, MOST_LINKS);
}

/** Where links from other apps wait until something takes them. */
export class LinkInbox {
  readonly #waiting: string[] = [];
  #taker: ((link: string) => void) | undefined;

  /**
   * A link came from another app: it goes to whatever takes links, or waits for it. Anything but a
   * link is dropped, and so is a link past {@link MOST_LINKS} waiting.
   */
  receive(link: string): void {
    if (!isIncomingLink(link)) return;
    if (this.#taker) {
      this.#taker(link);
    } else if (this.#waiting.length < MOST_LINKS) {
      this.#waiting.push(link);
    }
  }

  /**
   * Takes every link from now on, starting with those that waited, in the order they came, until
   * the returned function is called.
   */
  take(taker: (link: string) => void): () => void {
    this.#taker = taker;
    for (const link of this.#waiting.splice(0)) taker(link);
    return () => {
      if (this.#taker === taker) this.#taker = undefined;
    };
  }
}

/** The links other apps hand this Lo. */
export const incomingLinks = new LinkInbox();
