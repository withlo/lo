import { wrap } from './layout.ts';
import { countWords, Tally } from './words.ts';

/** A summary of `text`: how many words it has, and the one that comes up most. */
export function summarize(text: string): string {
  const tally = new Tally();
  for (const word of text.split(/\s+/).filter((part) => part !== '')) {
    tally.add(word.toLowerCase());
  }
  const total = countWords(text);
  return `${total} words, mostly "${tally.top() ?? ''}"`;
}

/** The summary of `text`, wrapped to lines of at most `width` characters. */
export function report(text: string, width: number): string[] {
  return wrap(summarize(text), width);
}
