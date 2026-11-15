/**
 * Counts the words in `text`: runs of characters between whitespace.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** Counts how often each word comes up. */
export class Tally {
  /** @type {Map<string, number>} */
  counts = new Map();

  /**
   * Adds one more sighting of `word`, and returns how many have been seen.
   * @param {string} word
   * @returns {number}
   */
  add(word) {
    const seen = (this.counts.get(word) ?? 0) + 1;
    this.counts.set(word, seen);
    return seen;
  }

  /**
   * The word seen most often, or `undefined` before any.
   * @returns {string | undefined}
   */
  top() {
    /** @type {string | undefined} */
    let best;
    for (const [word, seen] of this.counts) {
      if (best === undefined || seen > (this.counts.get(best) ?? 0)) best = word;
    }
    return best;
  }
}
