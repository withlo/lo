import { GithubClient, pullRequest, PullRef, RepoRef, Token, type RecentPull } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { describe, expect, it } from 'vitest';

import { AnswerCache, RECENT_PULLS } from './cache.ts';
import { AccountTable } from './rows.ts';
import { account, accountsDatabase } from './test/support.ts';

const BUILD = 'build-1';

/** A cache with two accounts, `bot` and `other`, and their rows. */
async function cache(build = BUILD) {
  const database = accountsDatabase();
  const rows = new AccountTable(database);
  await rows.save(account('bot', 1));
  await rows.save(account('other', 1));
  return { cache: new AnswerCache(database, build), rows, database };
}

const pull = (number: number) => new PullRef('rozed-dev', 'playground', number).key;

/** A pull request's REST summary, as the poller keeps it. */
function summary(title: string) {
  return {
    number: 1,
    title,
    state: 'open',
    draft: false,
    merged_at: null,
    updated_at: '2026-11-06T08:15:07Z',
    head: { ref: 'stack-a', sha: 'b046244d' },
    base: { ref: 'main', sha: '6ce218eb' },
  };
}

function recent(repo: string, number: number, openedAt: number, title?: string): RecentPull {
  return { pull: new PullRef('rozed-dev', repo, number), title, login: 'bot', openedAt };
}

describe('AnswerCache', () => {
  it('answers round trip', async () => {
    const { cache: answers } = await cache();
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: 1000, stamp: '"etag"' } },
    ]);
    expect(await answers.get('BOT', pull(1), 'PullSummary')).toEqual({
      value: summary('a'),
      fetchedAt: 1000,
      stamp: '"etag"',
    });
    // Replacing it.
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('b'), fetchedAt: 2000 } },
    ]);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toEqual({
      value: summary('b'),
      fetchedAt: 2000,
    });
  });

  it('graphql answers round trip', async () => {
    const client = new GithubClient({
      fetch: replayFetch('graphql_pull_request_1'),
      token: new Token('gho_FAKE'),
    });
    const details = await pullRequest(client, 'rozed-dev', 'playground', 1);
    const { cache: answers } = await cache();
    await answers.put('bot', pull(1), [
      { name: 'PullRequest', entry: { value: details, fetchedAt: 1000 } },
    ]);
    expect((await answers.get('bot', pull(1), 'PullRequest'))?.value).toEqual(details);
  });

  it('answers are per account, target and query', async () => {
    const { cache: answers } = await cache();
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary("bot's"), fetchedAt: 1000 } },
    ]);
    const repo = new RepoRef('rozed-dev', 'playground').key;
    expect(await answers.get('other', pull(1), 'PullSummary')).toBeUndefined();
    expect(await answers.get('bot', pull(2), 'PullSummary')).toBeUndefined();
    expect(await answers.get('bot', repo, 'PullSummary')).toBeUndefined();
    expect(await answers.get('bot', pull(1), 'PullRequest')).toBeUndefined();
    // Owners and names match case-insensitively, as on GitHub: a target's key ignores case.
    const shouted = new PullRef('ROZED-DEV', 'Playground', 1).key;
    expect(await answers.get('bot', shouted, 'PullSummary')).toBeDefined();
  });

  it('an answer knows its age and a touch renews it', async () => {
    const { cache: answers } = await cache();
    const threeHoursAgo = 1_800_000_000_000 - 3 * 3_600_000;
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: threeHoursAgo, stamp: 's' } },
    ]);
    expect((await answers.get('bot', pull(1), 'PullSummary'))?.fetchedAt).toBe(threeHoursAgo);

    await answers.touch('bot', pull(1), 'PullSummary', 1_800_000_000_000);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toEqual({
      value: summary('a'),
      fetchedAt: 1_800_000_000_000,
      stamp: 's',
    });
    // A touch can give it a new stamp, or none.
    await answers.touch('bot', pull(1), 'PullSummary', 1_800_000_001_000, { stamp: 't' });
    expect((await answers.get('bot', pull(1), 'PullSummary'))?.stamp).toBe('t');
    await answers.touch('bot', pull(1), 'PullSummary', 1_800_000_002_000, { stamp: undefined });
    expect(await answers.get('bot', pull(1), 'PullSummary')).toEqual({
      value: summary('a'),
      fetchedAt: 1_800_000_002_000,
    });
    // Touching what isn't there does nothing.
    await answers.touch('bot', pull(9), 'PullSummary', 1);
    expect(await answers.get('bot', pull(9), 'PullSummary')).toBeUndefined();
  });

  it('an answer another build wrote reads as missing', async () => {
    const { cache: answers, database } = await cache();
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: 1000 } },
    ]);
    const newer = new AnswerCache(database, 'build-2');
    expect(await newer.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    // Nor does a touch bring it back.
    await newer.touch('bot', pull(1), 'PullSummary', 2000);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toMatchObject({ fetchedAt: 1000 });
    // The newer build's answer replaces the row.
    await newer.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: { title: 'a', mergeable: true }, fetchedAt: 2000 } },
    ]);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    expect((await newer.get('bot', pull(1), 'PullSummary'))?.value).toEqual({
      title: 'a',
      mergeable: true,
    });
  });

  it('answers stored together are all stored or none', async () => {
    const { cache: answers, database } = await cache();
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('old'), fetchedAt: 1000 } },
    ]);
    database.exec(`
      CREATE TRIGGER refuse BEFORE INSERT ON accounts_answers WHEN NEW.name = 'Refused'
      BEGIN SELECT RAISE(ABORT, 'refused'); END
    `);
    await expect(
      answers.put('bot', pull(1), [
        { name: 'PullSummary', entry: { value: summary('new'), fetchedAt: 2000 } },
        { name: 'Refused', entry: { value: 1, fetchedAt: 2000 } },
      ]),
    ).rejects.toThrow('refused');
    expect(await answers.get('bot', pull(1), 'PullSummary')).toEqual({
      value: summary('old'),
      fetchedAt: 1000,
    });

    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('new'), fetchedAt: 2000, stamp: 'e' } },
    ]);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toEqual({
      value: summary('new'),
      fetchedAt: 2000,
      stamp: 'e',
    });
  });

  it('removing forgets one answer', async () => {
    const { cache: answers } = await cache();
    for (const number of [1, 2]) {
      await answers.put('bot', pull(number), [
        { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: 1000 } },
      ]);
    }
    await answers.remove('bot', pull(1), 'PullSummary');
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    expect(await answers.get('bot', pull(2), 'PullSummary')).toBeDefined();
  });

  it('clearing the cache leaves accounts and recent PRs alone', async () => {
    const { cache: answers, rows } = await cache();
    await rows.setOwnerAccount('rozed-dev', 'bot');
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: 1000 } },
    ]);
    const opened = recent('playground', 1, 1000, 'a');
    await answers.recordRecent(opened);

    answers.clear();
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    expect(await rows.accounts()).toHaveLength(2);
    expect(await rows.ownerAccount('rozed-dev')).toBe('bot');
    expect(answers.recent(10)).toEqual([opened]);
  });

  it('removing an account removes its answers', async () => {
    const { cache: answers, rows } = await cache();
    for (const login of ['bot', 'other']) {
      await answers.put(login, pull(1), [
        { name: 'PullSummary', entry: { value: summary(login), fetchedAt: 1000 } },
      ]);
    }
    await rows.delete('bot');
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
    expect(await answers.get('other', pull(1), 'PullSummary')).toBeDefined();
  });

  it('recent PRs keep the newest and go with their account', async () => {
    const { cache: answers, rows } = await cache();
    for (let number = 1; number <= RECENT_PULLS + 5; number++) {
      await answers.recordRecent({
        pull: new PullRef('rozed-dev', 'playground', number),
        title: undefined,
        login: number % 2 === 0 ? 'bot' : 'other',
        openedAt: number,
      });
    }
    const kept = answers.recent(1000);
    expect(kept).toHaveLength(RECENT_PULLS);
    expect(kept[0]?.pull.number).toBe(RECENT_PULLS + 5);
    expect(kept.at(-1)?.pull.number).toBe(6);

    await rows.delete('OTHER');
    expect(answers.recent(1000).every((each) => each.login === 'bot')).toBe(true);
  });

  it('recent PRs are newest first', async () => {
    const { cache: answers } = await cache();
    await answers.recordRecent(recent('playground', 1, 100, 'one'));
    await answers.recordRecent(recent('playground', 2, 200));
    expect(answers.recent(10)).toEqual([
      recent('playground', 2, 200),
      recent('playground', 1, 100, 'one'),
    ]);
    // Reopening moves it to the top and keeps the title it had.
    await answers.recordRecent(recent('playground', 1, 300));
    expect(answers.recent(1)).toEqual([recent('playground', 1, 300, 'one')]);
  });

  it('a pull request opened by an old name can be forgotten under it', async () => {
    const { cache: answers } = await cache();
    await answers.recordRecent(recent('playground', 2, 100));
    await answers.recordRecent(recent('renamed', 2, 200));
    await answers.recordRecent(recent('playground', 3, 300));

    answers.forgetRecent(new PullRef('Rozed-Dev', 'Playground', 2));

    expect(answers.recent(10)).toEqual([recent('playground', 3, 300), recent('renamed', 2, 200)]);
  });

  it('keeps a pull request once, as its repository was last named', async () => {
    const { cache: answers } = await cache();
    await answers.recordRecent(recent('playground', 4, 100, 'four'));
    await answers.recordRecent({
      pull: new PullRef('Rozed-Dev', 'PlayGround', 4),
      title: undefined,
      login: 'other',
      openedAt: 200,
    });
    expect(answers.recent(10)).toEqual([
      {
        pull: new PullRef('Rozed-Dev', 'PlayGround', 4),
        title: 'four',
        login: 'other',
        openedAt: 200,
      },
    ]);
  });

  it('reads an answer it can no longer parse as missing', async () => {
    const { cache: answers, database } = await cache();
    await answers.put('bot', pull(1), [
      { name: 'PullSummary', entry: { value: summary('a'), fetchedAt: 1000 } },
    ]);
    database.exec(`UPDATE accounts_answers SET value = '{"title":'`);
    expect(await answers.get('bot', pull(1), 'PullSummary')).toBeUndefined();
  });
});
