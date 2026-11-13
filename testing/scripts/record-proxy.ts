// Records a cassette from the app: a proxy standing in for GitHub that forwards each request to
// GitHub as the test organization's bot, and records it.
//
//   LO_FIXTURE_TOKEN_FILE=<file holding the bot's token> \
//     node testing/scripts/record-proxy.ts <cassette> <repository> <description>
//
// It prints the address to start Lo with as LO_GITHUB, with a stand-in token in
// LO_TEST_TOKEN_FILE: the proxy signs every request with the bot's token, so Lo never holds it.
// Drive Lo through what the cassette should hold, then stop the proxy with Ctrl+C, or by closing
// its input, to write the cassette. Nothing that writes to GitHub is sent unless LO_RECORD_WRITES=1
// is set, for a recording of what Lo writes. testing/README.md has the details.

import { readFileSync } from 'node:fs';

import { cassetteDir } from '../src/cassette.ts';
import { startRecordingProxy } from '../src/proxy.ts';
import { checkRecordingAccount } from '../src/record.ts';

const [name, repo, description] = process.argv.slice(2);
if (!name || !repo || !description) {
  console.error(
    'Usage: node testing/scripts/record-proxy.ts <cassette> <repository> <description>',
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

const writes = process.env['LO_RECORD_WRITES'] === '1';
const proxy = await startRecordingProxy({ dir: cassetteDir(name), token, writes });
console.log(`LO_GITHUB=${new URL(proxy.urls.api).origin}`);
if (writes) console.log('Writes to GitHub are sent and recorded.');

let finishing = false;
const finish = async () => {
  if (finishing) return;
  finishing = true;
  await proxy.finish({ description, repo });
  for (const failure of proxy.failures) console.error(`not recorded: ${failure}`);
  console.log(`${name}: recorded`);
  process.exit(proxy.failures.length > 0 ? 1 : 0);
};
process.on('SIGINT', () => void finish());
process.on('SIGTERM', () => void finish());
process.stdin.on('end', () => void finish());
process.stdin.resume();
