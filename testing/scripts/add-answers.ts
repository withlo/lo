// Records a GraphQL query's answers to requests a cassette doesn't hold yet, and adds them in
// place, as the test organization's bot: for a read that what replays the cassette began to send
// after it was recorded.
//
//   LO_FIXTURE_TOKEN_FILE=<file holding the bot's token> \
//     node testing/scripts/add-answers.ts <query's .graphql file> <variables as JSON> <cassette> ...
//
// Each cassette gets its own answer, in a file after its others. Every other request stays as it
// was recorded. With --copy, it reads nothing from GitHub, and adds an answer another cassette
// recorded, such as an avatar, as it is:
//
//   node testing/scripts/add-answers.ts --copy <recorded interaction's file> <cassette> ...
//
// testing/README.md has the details.

import { readFileSync } from 'node:fs';

import { cassetteDir, parseJson } from '../src/cassette.ts';
import { checkRecordingAccount } from '../src/record.ts';
import { addAnswers, copyAnswer, readQuery } from '../src/rerecord.ts';

/** When, for `cassette.json`: now, to the second. */
const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

if (process.argv[2] === '--copy') {
  const [from, ...copied] = process.argv.slice(3);
  if (!from || copied.length === 0) {
    console.error(
      'Usage: node testing/scripts/add-answers.ts --copy <recorded interaction file> <cassette> ...',
    );
    process.exit(2);
  }
  copyAnswer({ from, dirs: copied.map((name) => cassetteDir(name)), at });
  for (const name of copied) console.log(`${name}: 1 added`);
  process.exit(0);
}

const [file, variables, ...names] = process.argv.slice(2);
if (!file || !variables || names.length === 0) {
  console.error(
    'Usage: node testing/scripts/add-answers.ts <query .graphql file> <variables as JSON> <cassette> ...',
  );
  process.exit(2);
}
const tokenFile = process.env['LO_FIXTURE_TOKEN_FILE'];
if (!tokenFile) {
  console.error("Set LO_FIXTURE_TOKEN_FILE to a file holding the bot's token.");
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
await checkRecordingAccount(fetch, token);

const counts = await addAnswers({
  fetch,
  token,
  query: readQuery(file),
  variables: [parseJson(variables)],
  dirs: names.map((name) => cassetteDir(name)),
  at,
});
for (const [dir, count] of counts) console.log(`${dir}: ${count} added`);
