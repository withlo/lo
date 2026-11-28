// What main said on a topic of something the window asked of it, against main's answer, for any
// feature whose topic says how what it asked stands as it goes: on its way, then not, which main
// says last, just before it answers, as the comments' `drafts` and `acts` say of a comment sent or
// a change to a thread, and the review's `submitted` of a review. A topic's values come in the
// order main sent them, but not in order with replies, so any of them can come after the answer:
// once the window has heard the answer, they're older than what it said, and change nothing of
// what was asked, until the value main sent with its answer comes. Plain functions, tested alone.

/** One ask of main's, as {@link Answers.ask} made it, for its answer. */
export interface Asked {
  /** What the topic names what was asked by. */
  readonly key: string;
}

/**
 * How what main said of one ask stands, as the window heard it: `asked`, before main said it's on
 * its way; `onWay`, once it has; `past`, once main said it no longer is, which it says as it
 * answers.
 */
type Heard = 'asked' | 'onWay' | 'past';

interface Ask extends Asked {
  heard: Heard;
  /** Main's answer came before what main said with it: what comes till then changes nothing. */
  held: boolean;
}

/** What main says, on one of its topics, of what one view asked of it, by what the topic names it. */
export class Answers {
  /**
   * Each key's asks not done with, in the order they were asked: main has one at a time on its
   * way, and what it says is of the oldest it hasn't said the last of.
   */
  readonly #asks = new Map<string, Ask[]>();

  /** The window asks main for `key`: what main says of it from here may be of this ask. */
  ask(key: string): Asked {
    const ask: Ask = { key, heard: 'asked', held: false };
    const asks = this.#asks.get(key) ?? [];
    asks.push(ask);
    this.#asks.set(key, asks);
    return ask;
  }

  /**
   * Main answered `asked`. With `said`, as for an answer main gave once it had said the ask was on
   * its way, what it said till then that hasn't come yet changes nothing: says whether any has yet
   * to come. Without, as for a refusal main gave at once, or an answer lost, which main goes on to
   * say more of, nothing is held.
   */
  answered(asked: Asked, said: boolean): boolean {
    const asks = this.#asks.get(asked.key);
    const ask = asks?.find((each) => each === asked);
    if (!asks || !ask) return false;
    if (said && ask.heard !== 'past') {
      ask.held = true;
      return true;
    }
    drop(this.#asks, asks, ask);
    return false;
  }

  /**
   * Takes a value main sent on its topic, which shows each key on its way or not (`onWay`): the
   * keys it's older than main's answer for, which it changes nothing of.
   */
  take(onWay: (key: string) => boolean): ReadonlySet<string> {
    const older = new Set<string>();
    for (const [key, asks] of this.#asks) {
      const ask = asks.find((each) => each.heard !== 'past');
      if (!ask) continue;
      if (onWay(key)) {
        if (ask.heard === 'asked') ask.heard = 'onWay';
      } else if (ask.heard === 'onWay') {
        ask.heard = 'past';
      }
      if (!ask.held) continue;
      // What main said with its answer is the answer's own, and from here what's said is newer.
      if (ask.heard === 'past') drop(this.#asks, asks, ask);
      else older.add(key);
    }
    return older;
  }
}

/** Takes `ask` out of `asks`, its key's in `all`. */
function drop(all: Map<string, Ask[]>, asks: Ask[], ask: Ask): void {
  asks.splice(asks.indexOf(ask), 1);
  if (asks.length === 0) all.delete(ask.key);
}
