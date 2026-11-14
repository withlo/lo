// Writes the derived cassettes (testing/src/derivations.ts) from the recorded ones they're written
// from: answers GitHub can't be made to give on demand. Nothing is sent to GitHub.
//
//   node testing/scripts/derive-answers.ts [cassette ...]
//
// With names, only those are written. testing/README.md has the details.

import { DERIVATIONS } from '../src/derivations.ts';
import { writeDerived } from '../src/derive.ts';

const named = process.argv.slice(2);
const unknown = named.filter((name) => !DERIVATIONS.some((each) => each.name === name));
if (unknown.length > 0) {
  console.error(`No derived cassette is called ${unknown.join(', ')}.`);
  process.exit(2);
}
for (const derivation of DERIVATIONS) {
  if (named.length > 0 && !named.includes(derivation.name)) continue;
  const files = writeDerived(derivation);
  console.log(`${derivation.name}: ${files.length - 1} answer(s) from ${derivation.from}`);
}
