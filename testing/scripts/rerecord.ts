// Records a GraphQL query's answers again in place, in cassettes that hold it, as the test
// organization's bot, after the query changed:
//
//   LO_FIXTURE_TOKEN_FILE=<file holding the bot's token> \
//     node testing/scripts/rerecord.ts <query's .graphql file> <cassette>[/<file>] ...
//
// A cassette's name records every request of the query in it again, and `<cassette>/<file>` only
// that one. Every other request stays as it was recorded. testing/README.md has the details.

import { readFileSync } from 'node:fs';

import { cassetteDir } from '../src/cassette.ts';
import { checkRecordingAccount } from '../src/record.ts';
import { readQuery, rerecord } from '../src/rerecord.ts';

const [file, ...names] = process.argv.slice(2);
if (!file || names.length === 0) {
  console.error(
    'Usage: node testing/scripts/rerecord.ts <query .graphql file> <cassette>[/<file>] ...',
  );
  process.exit(2);
}
// Each cassette once, with the files named in it, or none for all.
const files = new Map<string, string[] | undefined>();
for (const name of names) {
  const [cassette = '', only] = name.split('/', 2);
  const named = files.get(cassette);
  if (files.has(cassette) && named === undefined) continue;
  files.set(cassette, only === undefined ? undefined : [...(named ?? []), only]);
}
const tokenFile = process.env['LO_FIXTURE_TOKEN_FILE'];
if (!tokenFile) {
  console.error("Set LO_FIXTURE_TOKEN_FILE to a file holding the bot's token.");
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
await checkRecordingAccount(fetch, token);

const counts = await rerecord({
  fetch,
  token,
  query: readQuery(file),
  cassettes: [...files].map(([name, only]) => ({ dir: cassetteDir(name), files: only })),
  at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
});
for (const [dir, count] of counts) console.log(`${dir}: ${count} recorded again`);
