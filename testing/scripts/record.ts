// Records cassettes into testing/fixtures/github from GitHub, as the test organization's bot.
//
//   LO_FIXTURE_TOKEN_FILE=<file holding the bot's token> \
//     node testing/scripts/record.ts <scenarios module> [cassette ...]
//
// The module exports `scenarios`, a list of `Scenario`s; with cassette names, only those are
// recorded. Scenarios that write to GitHub run only with LO_RECORD_WRITES=1, and the recorder
// refuses any write a scenario doesn't declare. testing/README.md has the details.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { fixturesDir } from '../src/cassette.ts';
import { checkRecordingAccount, isScenario, Recorder } from '../src/record.ts';

const [module, ...names] = process.argv.slice(2);
if (!module) {
  console.error('Usage: node testing/scripts/record.ts <scenarios module> [cassette ...]');
  process.exit(2);
}

const tokenFile = process.env['LO_FIXTURE_TOKEN_FILE'];
if (!tokenFile) {
  console.error("Set LO_FIXTURE_TOKEN_FILE to a file holding the bot's token.");
  process.exit(2);
}
const token = readFileSync(tokenFile, 'utf8').trim();
const writes = process.env['LO_RECORD_WRITES'] === '1';

await checkRecordingAccount(fetch, token);

const loaded: unknown = await import(pathToFileURL(resolve(module)).href);
const exported: unknown =
  typeof loaded === 'object' && loaded !== null && 'scenarios' in loaded ? loaded.scenarios : [];
if (!Array.isArray(exported) || !exported.every(isScenario)) {
  console.error(`${module} must export \`scenarios\`, a list of scenarios.`);
  process.exit(2);
}
const scenarios = exported.filter(
  (scenario) => names.length === 0 || names.includes(scenario.name),
);
const unknown = names.filter((name) => !scenarios.some((scenario) => scenario.name === name));
if (unknown.length > 0) {
  console.error(`${module} has no scenario named ${unknown.join(', ')}.`);
  process.exit(2);
}

for (const scenario of scenarios) {
  if (scenario.writes && !writes) {
    console.log(`${scenario.name}: skipped, since it writes to GitHub (set LO_RECORD_WRITES=1)`);
    continue;
  }
  const recorder = new Recorder({
    fetch,
    dir: join(fixturesDir, scenario.name),
    secrets: [token],
    writes: scenario.writes ?? false,
  });
  let setup;
  try {
    setup = await scenario.run(recorder.fetch, token);
  } catch (error) {
    recorder.discard();
    throw error;
  }
  recorder.finish({
    description: scenario.description,
    recorded_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    repo: scenario.repo,
    ...(scenario.schema === undefined ? {} : { schema: scenario.schema }),
    ...(setup === undefined ? {} : { setup }),
  });
  console.log(`${scenario.name}: recorded`);
}
