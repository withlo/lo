// What the tab feature's main tests share: git with a cache of its own and a remote standing in
// for GitHub, GitHub replayed from a cassette with a real client and poller, and what a tab sends
// the window, collected.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  chooseAccount,
  GithubClient,
  GithubError,
  Poller,
  RepoRef,
  Token,
  type GitHubUrls,
  type PollEvent,
  type RepoAccount,
} from '@lo/github';
import { MemoryPollCache, replayFetch } from '@lo/testing';
import { gitProgram, writeAppRemote } from '@lo/testing/git';
import { onTestFinished } from 'vitest';

import { createGit, type MainGit } from '../../../../main/git.ts';
import type { AccountState, GithubEvent } from '../../../accounts/service.ts';
import type { Files, Local, PullView } from '../../contract.ts';
import type { TabGithub, TabPublish } from '../pull.ts';

/** A stand-in token, never a real one. */
export const TOKEN = 'gho_FAKE_TAB_ACCOUNT';

/** GitHub's own addresses, which the cassettes were recorded from. */
const URLS: GitHubUrls = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};

/** A new folder, removed when the test ends. */
export function folder(prefix = 'lo-tab-'): string {
  const path = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

let remote: string | undefined;

/** The e2e pull request's remote, made once for the test file. */
export function appRemote(): string {
  remote ??= writeAppRemote(realpathSync(mkdtempSync(join(tmpdir(), 'lo-tab-remote-'))));
  return remote;
}

/**
 * Git for main, with the test's git, fetching from `remoteUrl`, its cache in `root` (a new folder
 * unless given), found and open. It stops when the test ends.
 */
export async function testGit(
  remoteUrl = appRemote(),
  root = join(folder(), 'cache'),
): Promise<MainGit> {
  const git = createGit({
    settings: { program: gitProgram(), test: { remote: remoteUrl } },
    root,
    env: process.env,
    platform: process.platform,
    log: () => undefined,
    cleanUp: () => Promise.resolve(),
  });
  onTestFinished(() => git.stop());
  await git.check();
  return git;
}

export interface ReplayGithubOptions {
  /** The accounts signed in: rozed-bot unless said otherwise. */
  readonly logins?: readonly string[];
  /** What the poller keeps, to share between tests of a restart. */
  readonly cache?: MemoryPollCache;
  /** The `fetch` every request goes through: the cassette's replay unless said otherwise. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * GitHub as the accounts feature provides it, answered from `cassette`: each account a real client
 * and poller, with the poller's cache in memory. Which accounts see a repository is asked of
 * GitHub, as `Accounts` asks it, and owners' choices are remembered in `remembered`.
 */
export function replayGithub(cassette: string, options: ReplayGithubOptions = {}) {
  const fetch = options.fetch ?? replayFetch(cassette);
  const logins = [...(options.logins ?? ['rozed-bot'])];
  const cache = options.cache ?? new MemoryPollCache();
  const remembered = new Map<string, string>();
  const listeners = new Set<(event: GithubEvent) => void>();
  const clients = new Map(
    logins.map((login) => [
      login,
      new GithubClient({ fetch, urls: URLS, token: new Token(TOKEN) }),
    ]),
  );
  const client = (login: string): GithubClient => {
    const found = clients.get(login);
    if (!found) throw new GithubError({ kind: 'unauthorized', message: `${login} is signed out` });
    return found;
  };
  /** Each poller's listeners for its events, so a test can send what a poll would. */
  const heard = new Map<string, Set<(event: PollEvent) => void>>();
  const pollers = new Map(
    logins.map((login) => {
      const poller = new Poller({
        accounts: {
          client: (asked) => Promise.resolve(client(asked)),
          account: (asked) => (clients.has(asked) ? {} : undefined),
          isSignedOut: () => false,
          onChange: () => () => undefined,
        },
        login,
        cache,
      });
      const listeners = new Set<(event: PollEvent) => void>();
      heard.set(login, listeners);
      // The poller itself, but for its listeners, which the test hears of too.
      const watched = new Proxy(poller, {
        get(target, property) {
          if (property === 'onEvent') {
            return (listener: (event: PollEvent) => void) => {
              listeners.add(listener);
              const stop = target.onEvent(listener);
              return () => {
                listeners.delete(listener);
                stop();
              };
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return [login, watched] as const;
    }),
  );
  onTestFinished(() => {
    for (const poller of pollers.values()) poller.stop();
  });
  /** Removes an account, as the accounts feature does, then says so. */
  const removeAccount = (login: string) => {
    logins.splice(logins.indexOf(login), 1);
    clients.delete(login);
    pollers.get(login)?.stop();
    pollers.delete(login);
    for (const listener of listeners) listener({ kind: 'removed', login });
  };
  /** Sends `event` to what listens to `login`'s poller, as a poll that found it would. */
  const pollEvent = (login: string, event: PollEvent) => {
    for (const listener of heard.get(login) ?? []) listener(event);
  };
  const github = {
    anonymous: new GithubClient({ fetch, urls: URLS }),
    accounts: () =>
      Promise.resolve(
        logins.map((login): AccountState => ({
          account: { login, userId: 353226052, source: 'deviceFlow', scopes: [], addedAt: 0 },
          signedOut: undefined,
          cantSave: false,
          needsKeyring: false,
        })),
      ),
    client: (login: string) => Promise.resolve(client(login)),
    poller: (login: string) => {
      const found = pollers.get(login);
      return found ? Promise.resolve(found) : Promise.reject(new Error(`no account ${login}`));
    },
    async accountForRepo(repo: RepoRef): Promise<RepoAccount> {
      const visible: string[] = [];
      let current = repo;
      for (const login of logins) {
        try {
          const name = await client(login).get(`/repos/${repo.owner}/${repo.name}`, (json) =>
            json !== null && typeof json === 'object' && 'full_name' in json
              ? String(json.full_name)
              : repo.toString(),
          );
          current = RepoRef.parse(name) ?? repo;
          visible.push(login);
        } catch (error) {
          if (!(error instanceof GithubError && error.detail.kind === 'notFound')) throw error;
        }
      }
      const owner = remembered.get(current.owner.toLowerCase());
      const choice = chooseAccount(visible, { owner });
      return { repo: current, choice, visible, remembered: { owner }, problems: [] };
    },
    rememberAccountForOwner(owner: string, login: string) {
      remembered.set(owner.toLowerCase(), login);
      return Promise.resolve();
    },
    onEvent(listener: (event: GithubEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies TabGithub & { onEvent: unknown };
  return {
    github,
    fetch,
    pollers,
    pollEvent,
    removeAccount,
    remembered,
    cache,
    emit: (event: GithubEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

/** What a tab sends the window, collected in order, with the latest of each. */
export function published() {
  const pulls: PullView[] = [];
  const files: Files[] = [];
  const locals: Local[] = [];
  const publish: TabPublish = {
    pull: (view) => pulls.push(view),
    files: (list) => files.push(list),
    local: (local) => locals.push(local),
  };
  return {
    publish,
    pulls,
    files,
    locals,
    get pull(): PullView | undefined {
      return pulls.at(-1);
    },
    get local(): Local['state'] | undefined {
      return locals.at(-1)?.state;
    },
  };
}
