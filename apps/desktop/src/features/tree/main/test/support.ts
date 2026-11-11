// What the tree feature's main tests share: git with a cache of its own, fetching from a remote
// standing in for GitHub, a clone of a pull request there, and a tab's tree with what it sends the
// window collected.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseOid, type Repo } from '@lo/git';
import { GithubClient, Token, type GitHubUrls } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { APP_PULL, gitProgram, writeAppRemote } from '@lo/testing/git';
import { expect, onTestFinished } from 'vitest';

import { createGit } from '../../../../main/git.ts';
import type { LocalState } from '../../../tab/contract.ts';
import type { PullTabInfo } from '../../../tab/service.ts';
import type { TreeState } from '../../contract.ts';
import { TreeTab, type TreeReads } from '../tree.ts';

/** A new folder, removed when the test ends. */
export function folder(prefix = 'lo-tree-'): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

let appRemote: string | undefined;

/** The e2e pull request's remote, made once for the test file. */
export function e2eRemote(): string {
  appRemote ??= writeAppRemote(realpathSync(mkdtempSync(join(tmpdir(), 'lo-tree-remote-'))));
  return appRemote;
}

/**
 * The clone of `owner/name` in a new cache, fetching from `remote`, with pull request `number`
 * fetched into it: its head on `head`, merging into `baseBranch`.
 */
export async function cloneOf(
  remote: string,
  pull: {
    owner: string;
    name: string;
    number: number;
    head: string;
    baseBranch: string;
    base: string;
  },
): Promise<Repo> {
  const git = createGit({
    settings: { program: gitProgram(), test: { remote } },
    root: join(folder(), 'cache'),
    env: process.env,
    platform: process.platform,
    log: () => undefined,
    cleanUp: () => Promise.resolve(),
  });
  onTestFinished(() => git.stop());
  await git.check();
  const cache = git.cache;
  if (!cache) throw new Error('the cache is closed');
  const repo = await cache.open(pull.owner, pull.name, {});
  onTestFinished(() => repo.close());
  await repo.fetchPull({
    number: pull.number,
    head: parseOid(pull.head),
    baseBranch: pull.baseBranch,
    base: parseOid(pull.base),
  });
  return repo;
}

/** The clone of rozed-dev/e2e with #78 fetched. */
export function e2eClone(): Promise<Repo> {
  return cloneOf(e2eRemote(), {
    owner: 'rozed-dev',
    name: 'e2e',
    number: APP_PULL.number,
    head: APP_PULL.head,
    baseBranch: 'app/base',
    base: APP_PULL.base,
  });
}

/** GitHub's own addresses, which the cassettes were recorded from. */
const URLS: GitHubUrls = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};

/** A client answered from `cassette`. */
export function replayClient(cassette: string): GithubClient {
  return new GithubClient({
    fetch: replayFetch(cassette),
    urls: URLS,
    token: new Token('gho_FAKE'),
  });
}

/** The local copy ready at #78's head. */
export const READY: LocalState = {
  kind: 'ready',
  head: APP_PULL.head,
  base: APP_PULL.base,
  mergeBase: APP_PULL.base,
  offline: false,
};

/** rozed-dev/e2e#78's tab, as the tab feature says it, shown at its head. */
export function e2eInfo(
  local: LocalState = { kind: 'fetching', progress: null, attempt: 1 },
): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: APP_PULL.number,
    acting: { kind: 'account', login: 'rozed-bot' },
    shown: APP_PULL.head,
    provisional: false,
    local,
  };
}

/** A tab's tree, reading with `reads`, with what it sends the window and logs collected. */
export function treeTab(
  reads: Partial<TreeReads>,
  wholeLimit?: number,
  retryWait?: (failures: number) => number,
) {
  const sent: TreeState[] = [];
  const lines: string[] = [];
  const tree = new TreeTab({
    id: 't1',
    reads: {
      clone: reads.clone ?? (() => undefined),
      github:
        reads.github ?? (() => Promise.reject(new Error('this test reads nothing from GitHub'))),
    },
    publish: (state) => sent.push(state),
    log: (line) => lines.push(line),
    wholeLimit,
    retryWait,
  });
  onTestFinished(() => tree.close());
  /** Waits until what it last sent passes `ready`, and returns it. */
  const settled = async (ready: (state: TreeState) => boolean): Promise<TreeState> => {
    await expect
      .poll(() => sent.at(-1) !== undefined && ready(sent.at(-1)!), { timeout: 20_000 })
      .toBe(true);
    return sent.at(-1)!;
  };
  return { tree, sent, lines, settled };
}
