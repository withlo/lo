/**
 * `keep`: a fork's overview, copied to the base repository as the same commits, when it's one Lo
 * shows and the copy moves forward, and the stack overview it names, for the stack's own fork.
 * Local bare repositories stand in for the base repository and the fork, and a fake GitHub for
 * GitHub's answers.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { git, testGitEnvironment } from '@lo/testing/git';

import { HISTORY, keep, type WorkflowOptions } from '../src/keep.ts';
import type { PullRequest } from '../src/github.ts';
import { Workspace } from '../src/remote.ts';
import {
  fakeGitHub,
  FORK_ID,
  fromFork,
  keptLog,
  openWorkspace,
  overviewText,
  Repos,
  stackText,
} from './remotes.ts';
import { scratch } from './support.ts';

let root: ReturnType<typeof scratch>;
let repos: Repos;

beforeAll(() => {
  root = scratch('keep');
  repos = new Repos(root.dir);
});

afterAll(() => root.remove());

const PR = 5;

/** A base repository and a fork, and a way to run `keep` for them with what GitHub says. */
function setUp() {
  const base = repos.bare('base');
  const fork = repos.bare('fork');
  const run = async (pulls: readonly PullRequest[] = [fromFork(PR)], pr = PR) => {
    const log = keptLog();
    const workspace = await openWorkspace();
    const options: WorkflowOptions = {
      pr,
      base: { name: 'us/repo', remote: { url: base } },
      fork: (name) => {
        expect(name).toBe('them/repo');
        return { url: fork };
      },
      github: fakeGitHub(pulls),
      log,
      workspace,
    };
    try {
      await keep(options);
    } finally {
      workspace.close();
    }
    return log.lines;
  };
  return { base, fork, run };
}

const KEPT = `refs/lo/kept/pr/${PR}`;

describe('copying a fork’s overview', () => {
  test('pushes the fork’s commit to the base repository’s copy', async () => {
    const { base, fork, run } = setUp();
    const first = repos.commit({ 'artifact.md': overviewText(PR) });
    const second = repos.commit({ 'artifact.md': overviewText(PR, 'It changes more.') }, [first]);
    repos.push(fork, second, `refs/lo/pr/${PR}`);

    const lines = await run();
    expect(repos.ref(base, KEPT)).toBe(second);
    expect(lines.at(-1)).toMatch(/^info: Copied them\/repo's refs\/lo\/pr\/5/);
    // The same commits, its history included.
    expect(git(base, 'rev-list', KEPT).split('\n')).toEqual([second, first]);
  });

  test('moves the copy forward, and leaves it when nothing moved', async () => {
    const { base, fork, run } = setUp();
    const first = repos.commit({ 'artifact.md': overviewText(PR) });
    repos.push(fork, first, `refs/lo/pr/${PR}`);
    await run();
    expect(repos.ref(base, KEPT)).toBe(first);

    expect((await run()).at(-1)).toMatch(
      /^info: refs\/lo\/kept\/pr\/5 has them\/repo's .* already/,
    );

    const second = repos.commit(
      { 'artifact.md': overviewText(PR, 'Later.'), 'figures/a.png': PNG },
      [first],
    );
    repos.push(fork, second, `refs/lo/pr/${PR}`);
    expect((await run()).at(-1)).toMatch(/^info: Moved the copy at refs\/lo\/kept\/pr\/5/);
    expect(repos.ref(base, KEPT)).toBe(second);
  });

  test('leaves the copy, and says so, when the fork’s ref moved to a commit that doesn’t descend from it', async () => {
    const { base, fork, run } = setUp();
    const first = repos.commit({ 'artifact.md': overviewText(PR) });
    repos.push(fork, first, `refs/lo/pr/${PR}`);
    await run();
    const other = repos.commit({ 'artifact.md': overviewText(PR, 'Rewritten.') });
    repos.push(fork, other, `refs/lo/pr/${PR}`);

    const lines = await run();
    expect(lines.at(-1)).toMatch(/^warning: .* doesn't descend from the copy/);
    expect(repos.ref(base, KEPT)).toBe(first);
  });

  test('copies nothing for a pull request from the base repository, or a deleted fork', async () => {
    const { base, run } = setUp();
    const own = fromFork(PR, { head: { id: 1, name: 'us/repo' } });
    expect(await run([own])).toEqual([
      `info: #5 isn't from a fork, so there's no overview to copy.`,
    ]);
    const gone = fromFork(PR, { head: undefined });
    expect(await run([gone])).toEqual([
      `info: #5's fork was deleted, so there's no overview of it to copy.`,
    ]);
    expect(repos.ref(base, KEPT)).toBeUndefined();
  });

  test('copies nothing, and says why, when the fork can’t be read', async () => {
    const { base } = setUp();
    const log = keptLog();
    const workspace = await openWorkspace();
    try {
      await keep({
        pr: PR,
        base: { name: 'us/repo', remote: { url: base } },
        fork: () => ({ url: join(root.dir, 'no-such-fork.git') }),
        github: fakeGitHub([fromFork(PR)]),
        log,
        workspace,
      });
    } finally {
      workspace.close();
    }
    expect(log.lines.at(-1)).toMatch(
      /^warning: them\/repo couldn't be read, so its refs\/lo\/pr\/5 isn't copied\./,
    );
    expect(repos.ref(base, KEPT)).toBeUndefined();
  });

  test('copies nothing when the fork has no overview', async () => {
    const { base, run } = setUp();
    expect((await run()).at(-1)).toBe(
      "info: them/repo has no refs/lo/pr/5, so there's nothing to copy.",
    );
    expect(repos.ref(base, KEPT)).toBeUndefined();
  });

  test('fails when GitHub has no such pull request', async () => {
    const { run } = setUp();
    await expect(run([])).rejects.toThrow('us/repo has no pull request #5.');
  });
});

/** The first bytes of a PNG one pixel square. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/**
 * Runs `keep` with the fork's ref at `tip`, and what it said last, a warning, once it copied
 * nothing.
 */
async function refused(tip: string): Promise<string | undefined> {
  const { base, fork, run } = setUp();
  repos.push(fork, tip, `refs/lo/pr/${PR}`);
  const lines = await run();
  expect(repos.ref(base, KEPT)).toBeUndefined();
  expect(lines.at(-1)).toMatch(/^warning: /);
  return lines.at(-1);
}

describe('what a fork can’t copy', () => {
  test('an overview of another pull request', async () => {
    expect(await refused(repos.commit({ 'artifact.md': overviewText(6) }))).toMatch(
      /isn't an overview Lo shows.*pr: 6/,
    );
  });

  test('a commit that isn’t an overview', async () => {
    expect(await refused(repos.commit({ 'README.md': 'Hello.\n' }))).toMatch(
      /isn't an overview Lo shows/,
    );
    expect(await refused(repos.commit({ 'artifact.md': '# Not an overview\n' }))).toMatch(
      /isn't an overview Lo shows/,
    );
  });

  test('an overview in a newer format', async () => {
    expect(
      await refused(
        repos.commit({ 'artifact.md': overviewText(PR).replace('format: 1', 'format: 9') }),
      ),
    ).toMatch(/format 9, which is newer/);
  });

  test('an overview whose commit holds anything else', async () => {
    expect(
      await refused(repos.commit({ 'artifact.md': overviewText(PR), 'payload.bin': 'x' })),
    ).toMatch(/isn't an overview Lo shows.*payload\.bin/);
    expect(
      await refused(
        repos.commit({
          'artifact.md': overviewText(PR),
          '.github/workflows/run.yml': 'on: push\n',
        }),
      ),
    ).toMatch(/isn't an overview Lo shows/);
  });

  test('a commit under the overview that holds anything else', async () => {
    const code = repos.commit({ 'src/main.ts': 'export {};\n', '.github/workflows/x.yml': 'x\n' });
    const tip = repos.commit({ 'artifact.md': overviewText(PR) }, [code]);
    expect(await refused(tip)).toMatch(/has a commit under it, .*, that isn't an overview's/);
  });

  test('a merge under the overview', async () => {
    const one = repos.commit({ 'artifact.md': overviewText(PR, 'One.') });
    const two = repos.commit({ 'artifact.md': overviewText(PR, 'Two.') });
    const merge = repos.commit({ 'artifact.md': overviewText(PR, 'Both.') }, [one, two]);
    expect(await refused(merge)).toMatch(/has a merge under it/);
    const tip = repos.commit({ 'artifact.md': overviewText(PR, 'After.') }, [merge]);
    expect(await refused(tip)).toMatch(/has a merge under it/);
  });

  test('more commits than a copy takes at once', async () => {
    expect(await refused(repos.chain(HISTORY + 1, PR))).toMatch(/adds more than 1,000 commits/);
  });

  test('takes as many as it may', async () => {
    const { base, fork, run } = setUp();
    const tip = repos.chain(HISTORY, PR);
    repos.push(fork, tip, `refs/lo/pr/${PR}`);
    await run();
    expect(repos.ref(base, KEPT)).toBe(tip);
  });
});

describe('a stack’s overview', () => {
  const STACK = 3;

  /** The fork with #5's overview naming stack 3, and that stack's overview. */
  function stacked() {
    const set = setUp();
    const layer = repos.commit({
      'artifact.md': overviewText(PR, 'A layer.', '', `stack: ${STACK}\n`),
    });
    repos.push(set.fork, layer, `refs/lo/pr/${PR}`);
    const stack = repos.commit({ 'artifact.md': stackText(STACK) });
    repos.push(set.fork, stack, `refs/lo/stack/${STACK}`);
    return { ...set, layer, stack };
  }

  test('is copied when the stack’s bottom layer is a pull request from the same fork', async () => {
    const { base, run, layer, stack } = stacked();
    const lines = await run([fromFork(PR), fromFork(STACK)]);
    expect(repos.ref(base, KEPT)).toBe(layer);
    expect(repos.ref(base, `refs/lo/kept/stack/${STACK}`)).toBe(stack);
    expect(lines.at(-1)).toMatch(/^info: Copied them\/repo's refs\/lo\/stack\/3/);
  });

  test('isn’t copied for a stack whose bottom layer is from another repository, or is no pull request', async () => {
    for (const pulls of [
      [fromFork(PR), fromFork(STACK, { head: { id: FORK_ID + 1, name: 'other/repo' } })],
      [fromFork(PR), fromFork(STACK, { head: undefined })],
      [fromFork(PR)],
    ]) {
      const { base, run, layer } = stacked();
      const lines = await run(pulls);
      expect(repos.ref(base, KEPT)).toBe(layer);
      expect(repos.ref(base, `refs/lo/kept/stack/${STACK}`)).toBeUndefined();
      expect(lines.at(-1)).toBe(
        "warning: #5's overview names stack 3, and #3 isn't a pull request from them/repo, so its stack overview isn't copied.",
      );
    }
  });

  test('isn’t copied when it isn’t the overview of the stack its layer names', async () => {
    const { base, fork, run } = stacked();
    repos.push(fork, repos.commit({ 'artifact.md': stackText(4) }), `refs/lo/stack/${STACK}`);
    const lines = await run([fromFork(PR), fromFork(STACK)]);
    expect(lines.at(-1)).toMatch(
      /^warning: them\/repo's refs\/lo\/stack\/3, .* isn't an overview Lo shows/,
    );
    expect(repos.ref(base, `refs/lo/kept/stack/${STACK}`)).toBeUndefined();
  });

  test('a layer that is its stack’s bottom one copies the stack’s overview too', async () => {
    const { base, fork, run } = setUp();
    repos.push(
      fork,
      repos.commit({ 'artifact.md': overviewText(PR, 'The bottom.', '', `stack: ${PR}\n`) }),
      `refs/lo/pr/${PR}`,
    );
    const stack = repos.commit({ 'artifact.md': stackText(PR) });
    repos.push(fork, stack, `refs/lo/stack/${PR}`);
    await run([fromFork(PR)]);
    expect(repos.ref(base, `refs/lo/kept/stack/${PR}`)).toBe(stack);
  });
});

describe('the workflow’s own repository', () => {
  test('holds what was fetched in refs of its own, and no FETCH_HEAD, hook or template', async () => {
    const { fork } = setUp();
    const tip = repos.commit({ 'artifact.md': overviewText(PR) });
    repos.push(fork, tip, `refs/lo/pr/${PR}`);
    const workspace = await openWorkspace();
    try {
      const fetched = await workspace.fetch({ url: fork }, [
        { from: `refs/lo/pr/${PR}`, to: 'fork' },
      ]);
      expect(fetched.get(`refs/lo/pr/${PR}`)).toBe(tip);
      expect(git(workspace.dir, 'for-each-ref', '--format=%(refname)')).toBe('refs/workflow/fork');
      expect(existsSync(join(workspace.dir, 'FETCH_HEAD'))).toBe(false);
      expect(existsSync(join(workspace.dir, 'hooks'))).toBe(false);
      expect(readdirSync(workspace.dir).toSorted()).not.toContain('info');
    } finally {
      workspace.close();
    }
    expect(existsSync(workspace.dir)).toBe(false);
  });

  test('sends the token to the base repository alone, and nothing else of the environment git reads', async () => {
    const workspace = await Workspace.open({
      ...testGitEnvironment(),
      GITHUB_TOKEN: 'ghs_secret',
      GIT_DIR: '/elsewhere',
      GIT_SSH_COMMAND: 'run-this',
    });
    try {
      const base = { url: 'https://github.com/us/repo.git', authorization: 'basic c2VjcmV0' };
      const reaching = workspace.reaching(base).env;
      const keys = Object.entries(reaching)
        .filter(([name]) => name.startsWith('GIT_CONFIG_KEY_'))
        .map(([, value]) => value);
      expect(keys).toContain('http.https://github.com/us/repo.git.extraHeader');
      expect(Object.values(reaching)).toContain('Authorization: basic c2VjcmV0');
      expect(reaching['GIT_ALLOW_PROTOCOL']).toBe('https');
      expect(reaching['GIT_CONFIG_GLOBAL']).toBeDefined();
      expect(reaching['GIT_CONFIG_NOSYSTEM']).toBe('1');
      expect(reaching['GIT_DIR']).toBe(workspace.dir);
      expect(reaching['GIT_SSH_COMMAND']).toBeUndefined();
      expect(Object.values(reaching)).not.toContain('ghs_secret');

      const fork = workspace.reaching({ url: 'https://github.com/them/repo.git' }).env;
      expect(Object.values(fork).join('\n')).not.toMatch(/extraHeader|Authorization/i);
      expect(workspace.git.env['GIT_ALLOW_PROTOCOL']).toBe('none');
    } finally {
      workspace.close();
    }
  });
});
