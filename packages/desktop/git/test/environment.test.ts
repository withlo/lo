// What a running git really has, read from outside it as the system reports it: an environment of
// Lo's making, with the token only on a fetch, and the token in nothing else.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { FakeServer, git } from '@lo/testing/git';
import { expect, onTestFinished, test, vi } from 'vitest';

import { GitError } from '../src/errors.ts';
import { Token } from '../src/token.ts';
import { eventually, foundGit, runnerIn, tempFolder } from './support.ts';

/** A stand-in token. Not a real one. */
const SECRET = 'gho_FAKE_TOKEN_FOR_TESTS';

/**
 * The environment the process `pid` started with, as the system reports it: each variable's name
 * where the system lists them one by one (Linux), and the whole text.
 */
function environmentOf(pid: number): { text: string; names?: string[] } {
  if (existsSync(`/proc/${pid}/environ`)) {
    const variables = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    const names = variables.filter((line) => line !== '').map((line) => line.split('=')[0] ?? '');
    return { text: variables.join('\n'), names };
  }
  return {
    text: execFileSync('ps', ['eww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }),
  };
}

/** The arguments the process `pid` runs with, as the system reports them. */
function argumentsOf(pid: number): string {
  return execFileSync('ps', ['-ww', '-o', 'args=', '-p', String(pid)], { encoding: 'utf8' });
}

/** The variables git keeps from Lo's environment, and the ones Lo sets on every git. */
const KEPT = ['PATH', 'TMPDIR', 'DEVELOPER_DIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE'];
const OWN = [
  'HOME',
  'GIT_CEILING_DIRECTORIES',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_GLOBAL',
  'GIT_TERMINAL_PROMPT',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_LITERAL_PATHSPECS',
  'GIT_ALLOW_PROTOCOL',
  'LC_ALL',
];

/** The names in `names` that are neither kept, nor set by Lo, nor `extra`. */
function others(names: string[] | undefined, extra: string): string[] | undefined {
  return names?.filter((name) => !KEPT.includes(name) && !OWN.includes(name) && name !== extra);
}

test('every git gets an environment of Lo’s making, and only a fetch gets the token', async () => {
  // Main's environment, with a token and settings of its own in it.
  vi.stubEnv('GITHUB_TOKEN', 'hunter2');
  vi.stubEnv('LO_PLANTED', 'planted-value');
  vi.stubEnv('GIT_DIR', '/planted/.git');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const silent = await FakeServer.silent();
  onTestFinished(() => silent.close());
  const dir = tempFolder();
  const repo = join(dir, 'repo.git');
  git(dir, 'init', '-q', '--bare', repo);
  const lo = await runnerIn(dir, { git: await foundGit(process.env), remote: silent.url });

  const read = lo.command({ gitDir: repo }).arg('cat-file', '--batch').start({ input: true });
  const fetch = lo
    .command('none', { fetching: { token: new Token(SECRET) } })
    .arg('ls-remote', `${silent.url}/owner/repo.git`)
    .start();
  onTestFinished(() => {
    read.stop();
    fetch.stop();
  });
  await eventually(() => silent.requests().length > 0);
  const reading = environmentOf(read.pid ?? 0);
  const fetching = environmentOf(fetch.pid ?? 0);

  for (const { text } of [reading, fetching]) {
    const home = `HOME=${join(dir, 'home')}`;
    for (const own of ['GIT_CONFIG_NOSYSTEM=1', 'GIT_TERMINAL_PROMPT=0', 'LC_ALL=C', home]) {
      expect(text).toContain(own);
    }
    for (const mains of ['GITHUB_TOKEN', 'hunter2', 'LO_PLANTED', 'planted-value', '/planted/']) {
      expect(text).not.toContain(mains);
    }
  }
  expect(reading.text).toContain('GIT_NO_LAZY_FETCH=1');
  expect(reading.text).not.toContain('LO_GIT_TOKEN');
  expect(reading.text).not.toContain(SECRET);
  expect(fetching.text).toContain(`LO_GIT_TOKEN=${SECRET}`);
  expect(fetching.text).not.toContain('GIT_NO_LAZY_FETCH');
  // Where the system lists them one by one: nothing but what Lo sets and the few it keeps.
  expect(others(reading.names, 'GIT_NO_LAZY_FETCH') ?? []).toEqual([]);
  expect(others(fetching.names, 'LO_GIT_TOKEN') ?? []).toEqual([]);
  // Nor is the token in either's arguments.
  expect(argumentsOf(fetch.pid ?? 0)).toContain('ls-remote');
  expect(argumentsOf(fetch.pid ?? 0)).not.toContain(SECRET);
  expect(argumentsOf(read.pid ?? 0)).not.toContain(SECRET);
});

test('the token stays out of logs, errors and git’s own trace', async () => {
  const server = await FakeServer.asksForAPassword();
  onTestFinished(() => server.close());
  const dir = tempFolder();
  const logged: string[] = [];
  const lo = await runnerIn(dir, { remote: server.url, log: (line) => logged.push(line) });
  const trace = join(dir, 'trace2.json');

  const error: unknown = await lo
    .command('none', { fetching: { token: new Token(SECRET) } })
    .arg('ls-remote', `${server.url}/owner/repo.git`)
    .env('GIT_TRACE2_EVENT', trace)
    .run(undefined, { what: 'owner/repo' })
    .catch((caught: unknown) => caught);

  if (!(error instanceof GitError)) throw new Error(`expected a GitError, got ${String(error)}`);
  // git did sign in, so the token was there to leak.
  expect(error.detail).toMatchObject({ kind: 'fetch', failure: 'tokenRefused' });
  expect(server.saw(SECRET)).toBe(true);
  const traced = readFileSync(trace, 'utf8');
  expect(traced).toContain('ls-remote');
  expect(logged).toHaveLength(1);
  for (const shown of [
    error.message,
    String(error.stack),
    JSON.stringify(error.detail),
    inspect(error, { depth: 10 }),
    logged.join('\n'),
    traced,
  ]) {
    expect(shown).not.toContain(SECRET);
  }
});
