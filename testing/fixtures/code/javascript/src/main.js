import { summarize } from './report.js';
import { countWords } from './words.js';

const text = 'the quick brown fox jumps over the lazy dog';

console.log(summarize(text));
console.log(`${countWords(text)} words in all`);
