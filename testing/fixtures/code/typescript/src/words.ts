/** Counts the words in `text`: runs of characters between whitespace. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** Counts how often each word comes up. */
export class Tally {
  private readonly counts = new Map<string, number>();

  /** Adds one more sighting of `word`, and returns how many have been seen. */
  add(word: string): number {
    const seen = (this.counts.get(word) ?? 0) + 1;
    this.counts.set(word, seen);
    return seen;
  }

  /** How many times `word` has been seen. */
  count(word: string): number {
    return this.counts.get(word) ?? 0;
  }

  /** The word seen most often, or `undefined` before any. */
  top(): string | undefined {
    let best: string | undefined;
    for (const [word, seen] of this.counts) {
      if (best === undefined || seen > this.count(best)) best = word;
    }
    return best;
  }
}
