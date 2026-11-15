import { countWords, Tally } from './words.js';

/**
 * A summary of `text`: how many words it has, and the one that comes up most.
 * @param {string} text
 * @returns {string}
 */
export function summarize(text) {
  const tally = new Tally();
  for (const word of text.split(/\s+/)) {
    if (word !== '') tally.add(word.toLowerCase());
  }
  const total = countWords(text);
  return `${total} words, mostly "${tally.top() ?? ''}"`;
}
