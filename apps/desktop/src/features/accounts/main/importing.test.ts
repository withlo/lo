import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultPlaces, type Places } from '@lo/git';
import { GITHUB_URLS, type AuthenticatedUser, type Grant } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import { Gh } from './gh.ts';
import { NoKeychain } from './grants.ts';
import { importFromGh, listGh, rereadFromGh } from './importing.ts';
import { fakeGh, GH_TOKEN_FOR_BOT, GH_TOKEN_FOR_SOMEONE_ELSE } from './test/gh.ts';

const nowhere: Places = { folders: [], groups: defaultPlaces(process.platform).groups };

/** The stand-in gh, found on `PATH`, and what Lo logs. */
function setUp(options: { status?: string } = {}) {
  const fake = fakeGh(options);
  const gh = new Gh({
    env: {
      PATH: `${fake.folder}:/usr/bin:/bin`,
      HOME: fake.folder,
      // Never handed on to gh.
      GH_TOKEN: 'gho_FAKE_FROM_THE_ENVIRONMENT',
    },
    platform: process.platform,
    places: nowhere,
  });
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  return { ...fake, gh, logged, log };
}

/** What the stand-in gh was asked, one line per run. */
function asked(folder: string): string[] {
  try {
    return readFileSync(join(folder, 'asked'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Keeps what it's given, as the accounts would. */
function keeper() {
  const kept: { user: AuthenticatedUser; grant: Grant }[] = [];
  const add = (user: AuthenticatedUser, grant: Grant) => {
    kept.push({ user, grant });
    return Promise.resolve();
  };
  return { kept, add };
}

/** Keeps nothing, as a system with no keyring would. */
const refusing = () =>
  Promise.reject(
    new Error('storing the token: nope', { cause: new NoKeychain('No keyring answered.') }),
  );

describe('importing from gh', () => {
  it('lists ghs accounts', async () => {
    const { gh, log } = setUp();
    expect(await listGh(gh, ['ROZED-BOT'], log)).toEqual({
      kind: 'found',
      program: expect.stringMatching(/\/gh$/),
      version: '2.103.3',
      accounts: [
        {
          login: 'rozed-bot',
          active: true,
          usable: true,
          state: 'success',
          scopes: ['read:org', 'repo', 'workflow'],
          missing: [],
          shortLived: false,
          inLo: true,
        },
        {
          login: 'someone-else',
          active: false,
          usable: true,
          state: 'success',
          scopes: ['gist', 'read:org', 'repo'],
          missing: ['workflow'],
          shortLived: false,
          inLo: false,
        },
        {
          login: 'broken',
          active: false,
          usable: false,
          state: 'error',
          scopes: [],
          missing: ['repo', 'read:org', 'workflow'],
          shortLived: false,
          inLo: false,
        },
      ],
    });
  });

  it('says why there is nothing to list', async () => {
    const none = new Gh({ env: {}, platform: process.platform, program: 'none' });
    expect(await listGh(none, [], () => undefined)).toEqual({
      kind: 'missing',
      message: "Lo can't find gh, GitHub's command-line tool.",
    });
    const { gh, log } = setUp({ status: 'not json' });
    expect(await listGh(gh, [], log)).toMatchObject({
      kind: 'failed',
      message: "gh's list of accounts isn't what Lo expects.",
    });
  });

  it('imports an account after checking its token', async () => {
    const { gh, log, logged } = setUp();
    const fetch = replayFetch('user');
    const { kept, add } = keeper();
    expect(await importFromGh({ gh, fetch, urls: GITHUB_URLS, add, log }, ['ROZED-BOT'])).toEqual([
      { ok: true, login: 'rozed-bot' },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.user.user.login).toBe('rozed-bot');
    expect(kept[0]?.grant.token.expose()).toBe(GH_TOKEN_FOR_BOT);
    // gh's token has no refresh token: gh renews its own.
    expect(kept[0]?.grant.refresh).toBeUndefined();
    // It went to GitHub's API, as the account's.
    expect(fetch.seen.map(({ url }) => url)).toEqual(['https://api.github.com/user']);
    expect(fetch.seen[0]?.headers.get('authorization')).toBe(`token ${GH_TOKEN_FOR_BOT}`);
    expect(logged.join('\n')).not.toContain(GH_TOKEN_FOR_BOT);
  });

  it('refuses a token that belongs to someone else', async () => {
    const { gh, log, logged } = setUp();
    // GitHub says the token is rozed-bot's.
    const fetch = replayFetch('user');
    const { kept, add } = keeper();
    const results = await importFromGh({ gh, fetch, urls: GITHUB_URLS, add, log }, [
      'someone-else',
    ]);
    expect(results).toEqual([
      { ok: false, login: 'someone-else', message: "gh's token for someone-else is rozed-bot's." },
    ]);
    expect(kept).toEqual([]);
    expect(JSON.stringify(results) + logged.join('\n')).not.toContain(GH_TOKEN_FOR_SOMEONE_ELSE);
  });

  it('imports only what gh lists and can use, and never asks gh for another', async () => {
    const { gh, log, folder } = setUp();
    const fetch = replayFetch('user');
    const { kept, add } = keeper();
    expect(
      await importFromGh({ gh, fetch, urls: GITHUB_URLS, add, log }, ['nobody', 'broken']),
    ).toEqual([
      { ok: false, login: 'nobody', message: "gh isn't signed in to nobody." },
      {
        ok: false,
        login: 'broken',
        message: "gh can't use broken's token just now: gh says error.",
      },
    ]);
    expect(kept).toEqual([]);
    expect(fetch.seen).toEqual([]);
    expect(asked(folder)).toEqual(['auth status --json hosts --hostname github.com']);
  });

  it('says so when gh is gone, or Lo has no keychain to keep the token', async () => {
    const none = new Gh({ env: {}, platform: process.platform, program: 'none' });
    const fetch = replayFetch('user');
    expect(
      await importFromGh(
        { gh: none, fetch, urls: GITHUB_URLS, add: () => Promise.resolve(), log: () => undefined },
        ['rozed-bot'],
      ),
    ).toEqual([
      { ok: false, login: 'rozed-bot', message: "Lo can't find gh, GitHub's command-line tool." },
    ]);
    const { gh, log } = setUp();
    expect(
      await importFromGh({ gh, fetch, urls: GITHUB_URLS, add: refusing, log }, ['rozed-bot']),
    ).toEqual([{ ok: false, login: 'rozed-bot', message: 'No keyring answered.' }]);
  });
});

describe('reading a token from gh again', () => {
  it("reads gh's newer token, once GitHub says it's the account's", async () => {
    const { gh, log, logged } = setUp();
    const reread = rereadFromGh({ gh, fetch: replayFetch('user'), urls: GITHUB_URLS, log });
    expect((await reread('rozed-bot'))?.expose()).toBe(GH_TOKEN_FOR_BOT);
    // gh's token for someone-else is rozed-bot's, so it's no token for someone-else.
    const again = rereadFromGh({ gh, fetch: replayFetch('user'), urls: GITHUB_URLS, log });
    expect(await again('someone-else')).toBeUndefined();
    expect(logged).toEqual([
      "reading someone-else's token from gh again: gh's token for someone-else is rozed-bot's.",
    ]);
  });

  it('answers nothing without gh', async () => {
    const logged: string[] = [];
    const none = new Gh({ env: {}, platform: process.platform, program: 'none' });
    const reread = rereadFromGh({
      gh: none,
      fetch: replayFetch('user'),
      urls: GITHUB_URLS,
      log: (message) => logged.push(message),
    });
    expect(await reread('rozed-bot')).toBeUndefined();
    expect(logged).toEqual([
      "reading rozed-bot's token from gh again: Lo can't find gh, GitHub's command-line tool.",
    ]);
  });
});
