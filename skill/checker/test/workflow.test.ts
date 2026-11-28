/**
 * The overview workflow the installer writes, and the commands it runs: when it runs, what its
 * token may do, that it never checks out or runs a pull request's code, and that nothing a pull
 * request says reaches a shell; then `keep` and `fold` on the command line, GitHub's answers, and
 * the log the runner reads.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { actionsContext, actionsLog, ContextError } from '../src/actions.ts';
import { gitHubApi, GitHubError, isRepositoryName } from '../src/github.ts';
import { main } from '../src/main.ts';
import { tokenHeader } from '../src/remote.ts';
import { WORKFLOW_PATH, WORKFLOW_TEXT } from '../src/workflow.ts';
import { MANIFEST } from './support.ts';

const SOURCE = readFileSync(
  fileURLToPath(new URL('../workflow/lo-overview.yml', import.meta.url)),
  'utf8',
);

describe('the workflow', () => {
  test('goes where GitHub runs workflows from, running the checker by this exact version', () => {
    expect(WORKFLOW_PATH).toBe('.github/workflows/lo-overview.yml');
    expect(WORKFLOW_TEXT).not.toContain('{version}');
    const runs = [...WORKFLOW_TEXT.matchAll(/^ +npx .*$/gm)].map(([line]) => line.trim());
    expect(runs).toEqual([
      `npx --prefix "$tools" --yes ${MANIFEST.name}@${MANIFEST.version} keep --pr "$PR"`,
      `npx --prefix "$tools" --yes ${MANIFEST.name}@${MANIFEST.version} fold --pr "$PR"`,
    ]);
    expect(WORKFLOW_TEXT).toBe(
      SOURCE.replaceAll(`${MANIFEST.name}@{version}`, `${MANIFEST.name}@${MANIFEST.version}`),
    );
  });

  test('runs on a pull request’s events from the base branch, and by hand for one', () => {
    expect(SOURCE).toMatch(
      /^on:\n {2}pull_request_target:\n {4}types: \[opened, synchronize, reopened, closed\]\n {2}workflow_dispatch:\n/m,
    );
    expect(SOURCE).not.toMatch(/^\s+pull_request:/m);
  });

  test('gives its token only what it needs: refs, and reading pull requests', () => {
    expect(SOURCE).toMatch(/^permissions:\n {2}contents: write\n {2}pull-requests: read\n\n/m);
    expect(SOURCE.match(/permissions:/g)).toHaveLength(1);
  });

  test('uses no action, so it never checks out the pull request, and starts nothing but the checker', () => {
    expect(SOURCE).not.toMatch(/^\s*(?:-\s*)?uses:/m);
    expect(SOURCE).not.toMatch(/checkout|git clone|git fetch|npm (?:install|ci)/);
  });

  test('never puts what the event says inside a script, only in the environment', () => {
    const scripts = [...SOURCE.matchAll(/run: \|\n((?: {10}.*\n)+)/g)].map(([, body]) => body!);
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(script).not.toContain('${{');
    // The pull request's number is the only value taken from the event.
    const values = [...SOURCE.matchAll(/\$\{\{([^}]*)\}\}/g)].map(([, inner]) =>
      inner!.replace(/\s+/g, ' ').trim(),
    );
    expect(new Set(values)).toEqual(
      new Set([
        'github.event.pull_request.number || inputs.pr',
        'github.token',
        "!cancelled() && (github.event_name == 'workflow_dispatch' || github.event.pull_request.merged)",
      ]),
    );
  });
});

/** Runs the command line with `env`, and what it wrote. */
async function ran(args: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const status = await main(
    args,
    { out: (text) => out.push(text), err: (text) => err.push(text) },
    env,
  );
  return { status, out: out.join(''), err: err.join('') };
}

describe('keep and fold on the command line', () => {
  test('take a pull request’s number, and nothing else', async () => {
    for (const command of ['keep', 'fold']) {
      expect(await ran([command])).toMatchObject({ status: 2 });
      expect((await ran([command])).err).toContain(`${command} needs --pr`);
      expect((await ran([command, '--pr', 'x'])).err).toContain(
        "--pr takes a pull request's number",
      );
      expect((await ran([command, '--pr', '5', '--stack', '3'])).err).toContain(
        `${command} takes only --pr`,
      );
      expect((await ran([command, '--pr', '5', 'folder'])).err).toContain(
        `${command} takes only --pr`,
      );
    }
  });

  test('say, as the runner shows an error, that they run in the workflow', async () => {
    expect(await ran(['keep', '--pr', '5'], { GITHUB_TOKEN: 'x' })).toEqual({
      status: 2,
      out: '::error::GITHUB_REPOSITORY names no repository. keep and fold run in the repository’s workflow.\n',
      err: '',
    });
    expect(
      (await ran(['fold', '--pr', '5'], { GITHUB_REPOSITORY: 'us/repo', PATH: process.env.PATH }))
        .out,
    ).toBe('::error::GITHUB_TOKEN is empty. The workflow passes it the token.\n');
  });
});

describe('the workflow’s environment', () => {
  const env = { GITHUB_REPOSITORY: 'us/repo', GITHUB_TOKEN: 'ghs_x' };

  test('names the repository, GitHub and its API, and the token', () => {
    expect(actionsContext(env)).toEqual({
      repository: 'us/repo',
      server: 'https://github.com',
      api: 'https://api.github.com',
      token: 'ghs_x',
    });
    expect(
      actionsContext({
        ...env,
        GITHUB_SERVER_URL: 'https://ghe.example.com/',
        GITHUB_API_URL: 'https://ghe.example.com/api/v3/',
      }),
    ).toMatchObject({ server: 'https://ghe.example.com', api: 'https://ghe.example.com/api/v3' });
  });

  test('refuses anything but HTTPS addresses and a repository’s name', () => {
    for (const more of [
      { GITHUB_REPOSITORY: '../repo' },
      { GITHUB_REPOSITORY: 'us/repo/more' },
      { GITHUB_SERVER_URL: 'http://github.com' },
      { GITHUB_SERVER_URL: 'https://github.com/path' },
      { GITHUB_SERVER_URL: 'https://user:pass@github.com' },
      { GITHUB_API_URL: 'file:///etc' },
      { GITHUB_TOKEN: '' },
    ]) {
      expect(() => actionsContext({ ...env, ...more })).toThrow(ContextError);
    }
  });

  test('takes only names GitHub gives repositories', () => {
    expect(isRepositoryName('withlo/lo')).toBe(true);
    expect(isRepositoryName('a-b/c.d_e')).toBe(true);
    for (const name of [
      '-a/b',
      'a/..',
      'a/.',
      'a/b.git',
      'a b/c',
      'a/b c',
      'a',
      'a/b/c',
      'a/b\n',
    ]) {
      expect(isRepositoryName(name)).toBe(false);
    }
  });

  test('signs git in as actions/checkout does', () => {
    expect(tokenHeader('ghs_x')).toBe(
      `basic ${Buffer.from('x-access-token:ghs_x').toString('base64')}`,
    );
  });
});

describe('the log', () => {
  test('writes each line as one line, and never as a command of the runner’s', () => {
    const out: string[] = [];
    const log = actionsLog((text) => out.push(text));
    log.info('One\nline\r\n::set-env name=X::y');
    log.info('::add-mask::x');
    log.warning('100% of\n::error::it');
    log.error('No.');
    expect(out).toEqual([
      'One line ::set-env name=X::y\n',
      ' ::add-mask::x\n',
      '::warning::100%25 of%0A::error::it\n',
      '::error::No.\n',
    ]);
  });
});

/** A fetch that answers each request with what `answer` gives, and keeps what was asked. */
function fetcher(answer: (url: string) => { status: number; body: unknown }) {
  const asked: { url: string; authorization: string | null }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    asked.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    const { status, body } = answer(url);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { asked, fetch };
}

/** Waits for nothing. */
const pause = async (): Promise<void> => {};

describe('what GitHub says', () => {
  const PULL = {
    number: 5,
    merged: true,
    merged_at: '2026-11-28T08:00:00Z',
    base: { repo: { id: 1, full_name: 'us/repo' } },
    head: { repo: { id: 2, full_name: 'them/repo' } },
  };

  test('reads a pull request’s repositories and whether it merged, with the token', async () => {
    const { asked, fetch } = fetcher(() => ({ status: 200, body: PULL }));
    const github = gitHubApi('https://api.github.com/', 'ghs_x', fetch);
    expect(await github.pull('us/repo', 5)).toEqual({
      number: 5,
      base: { id: 1, name: 'us/repo' },
      head: { id: 2, name: 'them/repo' },
      merged: true,
      mergedAt: '2026-11-28T08:00:00Z',
    });
    expect(asked[0]!.url).toBe('https://api.github.com/repos/us/repo/pulls/5');
    expect(asked[0]!.authorization).toBe('Bearer ghs_x');
  });

  test('says a deleted fork is no head, and a missing pull request is none', async () => {
    const gone = fetcher(() => ({ status: 200, body: { ...PULL, head: { repo: null } } }));
    expect(
      (await gitHubApi('https://api.github.com', 't', gone.fetch).pull('us/repo', 5))?.head,
    ).toBe(undefined);
    const none = fetcher(() => ({ status: 404, body: { message: 'Not Found' } }));
    expect(await gitHubApi('https://api.github.com', 't', none.fetch).pull('us/repo', 5)).toBe(
      undefined,
    );
  });

  test('refuses an answer of another shape, or another pull request', async () => {
    for (const body of [
      { ...PULL, number: 6 },
      { ...PULL, base: { repo: { id: 1, full_name: '../x' } } },
      { ...PULL, head: { repo: { id: 'two', full_name: 'them/repo' } } },
      'not json',
    ]) {
      const { fetch } = fetcher(() => ({ status: 200, body }));
      await expect(
        gitHubApi('https://api.github.com', 't', fetch).pull('us/repo', 5),
      ).rejects.toThrow(GitHubError);
    }
  });

  test('asks again once after a server error, and says what a refusal says', async () => {
    let calls = 0;
    const flaky = fetcher(() =>
      calls++ === 0 ? { status: 502, body: '' } : { status: 200, body: PULL },
    );
    expect(
      await gitHubApi('https://api.github.com', 't', flaky.fetch, pause).pull('us/repo', 5),
    ).toMatchObject({
      number: 5,
    });
    expect(calls).toBe(2);
    const refused = fetcher(() => ({
      status: 403,
      body: { message: 'Resource not accessible by integration\n::error::x' },
    }));
    await expect(
      gitHubApi('https://api.github.com', 't', refused.fetch, pause).pull('us/repo', 5),
    ).rejects.toThrow('GitHub answered 403: Resource not accessible by integration ::error::x.');
  });

  test('maps a commit to the account GitHub links its author to, if any', async () => {
    const id = 'a'.repeat(40);
    const answers: Record<string, unknown> = {
      [`/repos/us/repo/commits/${id}`]: { author: { login: 'writer' } },
      [`/repos/them/repo/commits/${id}`]: { author: null },
    };
    const { fetch } = fetcher((url) => ({
      status: 200,
      body: answers[new URL(url).pathname] ?? {},
    }));
    const github = gitHubApi('https://api.github.com', 't', fetch);
    expect(await github.commitLogin('us/repo', id)).toBe('writer');
    expect(await github.commitLogin('them/repo', id)).toBeUndefined();
    await expect(github.commitLogin('us/repo', 'HEAD')).rejects.toThrow(GitHubError);
    await expect(github.commitLogin('../x', id)).rejects.toThrow(GitHubError);
    const odd = fetcher(() => ({ status: 200, body: { author: { login: 'not a login' } } }));
    expect(
      await gitHubApi('https://api.github.com', 't', odd.fetch).commitLogin('us/repo', id),
    ).toBe(undefined);
  });
});
