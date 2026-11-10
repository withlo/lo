// A live test against github.com: fetching a pull request from a private repository with a token,
// which git gets from the credential helper scoped to `https://github.com`.
//
// It runs only when LO_FIXTURE_TOKEN_FILE names a file holding a token that can read
// `rozed-dev/playground`, which is never so in CI:
//
//   LO_FIXTURE_TOKEN_FILE=<file> pnpm nx run git:test -- test/live-github.test.ts
//
// It reads the token from that file and never prints it.

import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, gitProgram } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { Cache } from '../src/cache.ts';
import { GitError } from '../src/errors.ts';
import { gitAt } from '../src/find.ts';
import type { Git } from '../src/git.ts';
import { parseOid } from '../src/oid.ts';
import { readFile, revParse } from './fixtures.ts';
import { script, tempFolder } from './support.ts';

const OWNER = 'rozed-dev';
const REPO = 'playground';
/** `stack-b` into `stack-a`, the head of pull request #1, which goes into `main`. Each adds a file. */
const PULL = 2;
const HEAD_BRANCH = 'stack-b';
const BASE_BRANCH = 'stack-a';
/** The file pull request #2 adds. */
const ADDED = 'stack-b.md';
/** The file pull request #1 adds, which #2's diff, from its merge base with `stack-a`, leaves out. */
const BELOW = 'stack-a.md';

const tokenFile = process.env.LO_FIXTURE_TOKEN_FILE;

/** GETs `path` from GitHub's REST API, with `token` when there is one. */
async function api(path: string, accept: string, token?: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
  });
}

/** A string field of a JSON object. */
function field(value: unknown, ...keys: string[]): string {
  let at = value;
  for (const key of keys) {
    at = typeof at === 'object' && at !== null ? (Reflect.get(at, key) as unknown) : undefined;
  }
  if (typeof at !== 'string') throw new Error(`no ${keys.join('.')} in GitHub's answer`);
  return at;
}

/**
 * A git that records how every git ran: whether the credential helper's variable was set, then its
 * arguments, then the real git with `GIT_TRACE` and `GIT_TRACE2_EVENT` on, which record every
 * program git starts and every git process, the ones git starts itself included.
 */
async function tracedGit(): Promise<{ git: Git; logs: string[]; summary: () => Summary }> {
  const dir = tempFolder();
  const argv = join(dir, 'argv');
  const trace = join(dir, 'trace');
  const trace2 = join(dir, 'trace2');
  writeFileSync(argv, '');
  const wrapper = script(
    join(dir, 'git'),
    [
      `if [ -n "\${LO_GIT_TOKEN+set}" ]; then printf 'token-var:set ' >> '${argv}'; else printf 'token-var:unset ' >> '${argv}'; fi`,
      `printf '%s\\n' "$*" >> '${argv}'`,
      `GIT_TRACE='${trace}' GIT_TRACE2_EVENT='${trace2}' exec '${gitProgram()}' "$@"`,
    ].join('\n'),
  );
  const status = await gitAt(wrapper, { env: process.env, platform: process.platform });
  if (status.status !== 'found') throw new Error(`the traced git: ${status.status}`);
  const logs = [argv, trace, trace2];
  const summary = (): Summary => {
    const runs = readFileSync(argv, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    const events = readFileSync(trace2, 'utf8').split('\n');
    const children = events.filter((line) => line.includes('"event":"child_start"'));
    return {
      runs: runs.length,
      withTokenVariable: runs.filter((run) => run.startsWith('token-var:set ')).length,
      helperGets: children.filter(
        (line) => line.includes('LO_GIT_TOKEN') && line.includes('f get"'),
      ).length,
      credentialPrograms: children.filter((line) => /credential|askpass/i.test(line)).length,
    };
  };
  return { git: status.git, logs, summary };
}

interface Summary {
  /** Times Lo ran git. */
  runs: number;
  /** Of those, the runs with the credential helper's variable set. */
  withTokenVariable: number;
  /** Times git asked Lo's credential helper for credentials. */
  helperGets: number;
  /** Programs git started that ask for credentials: any credential helper or askpass. */
  credentialPrograms: number;
}

test.skipIf(tokenFile === undefined)(
  'fetches a private repository through the credential helper',
  { timeout: 300_000 },
  async () => {
    const token = readFileSync(tokenFile ?? '', 'utf8').trim();
    expect(token.length).toBeGreaterThanOrEqual(20);
    const user: unknown = await (await api('/user', 'application/vnd.github+json', token)).json();
    expect(field(user, 'login')).toBe('rozed-bot');

    // The repository is private: GitHub's API doesn't show it without a token.
    expect((await api(`/repos/${OWNER}/${REPO}`, 'application/vnd.github+json')).status).toBe(404);
    // The pull request as GitHub's API describes it, which is what the app passes to fetchPull.
    const answer = await api(
      `/repos/${OWNER}/${REPO}/pulls/${PULL}`,
      'application/vnd.github+json',
      token,
    );
    expect(answer.status).toBe(200);
    const pull: unknown = await answer.json();
    expect([field(pull, 'head', 'ref'), field(pull, 'base', 'ref')]).toEqual([
      HEAD_BRANCH,
      BASE_BRANCH,
    ]);
    const head = parseOid(field(pull, 'head', 'sha'));
    const refs = {
      number: PULL,
      head,
      baseBranch: BASE_BRANCH,
      base: parseOid(field(pull, 'base', 'sha')),
    };
    const root = join(tempFolder(), 'cache');
    const signedIn = await tracedGit();
    const anonymous = await tracedGit();

    // With the token: fetch, then the diff and the file it adds.
    {
      const cache = await Cache.open({ root, git: signedIn.git });
      const repo = await cache.open(OWNER, REPO, { token: () => Promise.resolve(token) });
      const fetched = await repo.fetchPull(refs);
      expect(fetched.head).toBe(head);
      expect(fetched.baseSource).toBe('branch');
      expect(revParse(repo, `refs/lo/pull/${PULL}/revs/${head}`)).toBe(head);
      expect(await repo.pullRevisions(PULL)).toEqual([head]);
      const base = await repo.mergeBase(fetched.head, fetched.baseTip);
      if (base === undefined) throw new Error('the head and the base share no history');
      const changed = git(
        repo.folder,
        '--no-lazy-fetch',
        'diff',
        '--name-status',
        '--no-renames',
        base,
        head,
      );
      expect(changed.split('\n')).toContain(`A\t${ADDED}`);
      expect(changed).not.toContain(BELOW);
      const blob = parseOid(git(repo.folder, '--no-lazy-fetch', 'rev-parse', `${head}:${ADDED}`));
      expect(await repo.download([blob], ADDED)).toEqual([]);
      const raw = await api(
        `/repos/${OWNER}/${REPO}/contents/${ADDED}?ref=${head}`,
        'application/vnd.github.raw+json',
        token,
      );
      expect(raw.status).toBe(200);
      const content = readFile(repo, head, ADDED);
      expect(content).not.toBe('');
      expect(content).toBe((await raw.text()).trim());
      repo.close();
      await cache.close();
    }

    // Without a token: the same fetch fails as GitHub refusing it, and nothing prompts.
    {
      const cache = await Cache.open({ root, git: anonymous.git });
      const repo = await cache.open(OWNER, REPO);
      const error: unknown = await repo.fetchPull(refs).catch((caught: unknown) => caught);
      if (!(error instanceof GitError)) throw new Error('fetched without a token');
      expect(error.detail.kind === 'fetch' && error.detail.failure).toMatch(
        /^(auth|repoNotFound)$/,
      );
      expect(error.isRetryable()).toBe(false);
      expect(error.message).not.toContain(token);
      repo.close();
      await cache.close();
    }

    // The token is in no file in the cache: not a clone's config, logs or refs, nor git's home.
    const files = readdirFiles(root);
    expect(files).toContain(join(root, 'repos/github.com', OWNER, `${REPO}.git`, 'config'));
    expect(files.filter((file) => readFileSync(file).includes(token))).toEqual([]);
    // No git, or anything git started, was given the token as an argument, nor traced it.
    for (const log of [...signedIn.logs, ...anonymous.logs]) {
      expect(readFileSync(log).includes(token)).toBe(false);
    }
    // With the token, git asked Lo's helper, which read it from the variable set on that git.
    const withToken = signedIn.summary();
    expect(withToken.helperGets).toBeGreaterThan(0);
    expect(withToken.withTokenVariable).toBeGreaterThan(0);
    // Without one, no git had the variable or the helper, and git ran no other helper or askpass.
    expect(anonymous.summary()).toMatchObject({
      withTokenVariable: 0,
      helperGets: 0,
      credentialPrograms: 0,
    });
  },
);

/** Every file under `folder`, following no links. */
function readdirFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => join(folder, name))
    .filter((path) => lstatSync(path).isFile());
}
