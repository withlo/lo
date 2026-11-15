import { report } from './report.ts';
import { countWords } from './words.ts';

const text = 'the quick brown fox jumps over the lazy dog';

console.log(report(text, 20).join('\n'));
console.log(`${countWords(text)} words in all`);
