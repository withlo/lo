import { expect, test } from 'vitest';

import { botAvatar } from './bots.ts';
import { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { Token } from './token.ts';

/** A client whose GitHub answers `answer` for every account, and the paths it was asked for. */
function client(answer: (path: string) => Response): { client: GithubClient; asked: string[] } {
  const asked: string[] = [];
  const fetch = (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    asked.push(url.pathname);
    return Promise.resolve(answer(url.pathname));
  };
  return { client: new GithubClient({ fetch, token: new Token('gho_FAKE') }), asked };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test("reads a bot's avatar from its account, by the app's slug or the bot's login", async () => {
  const cursor = {
    login: 'cursor[bot]',
    type: 'Bot',
    avatar_url: 'https://avatars.githubusercontent.com/in/1210556?v=4',
  };
  const github = client(() => json(cursor));
  expect(await botAvatar(github.client, 'cursor')).toBe(cursor.avatar_url);
  expect(await botAvatar(github.client, 'cursor[bot]')).toBe(cursor.avatar_url);
  expect(github.asked).toEqual(['/users/cursor%5Bbot%5D', '/users/cursor%5Bbot%5D']);
});

test('asks nothing for a login that no bot has', async () => {
  const github = client(() => json({}));
  for (const login of ['', 'a/b', '../user', 'cursor[bot][bot]', 'x'.repeat(40), 'cur sor']) {
    expect(await botAvatar(github.client, login)).toBeUndefined();
  }
  expect(github.asked).toEqual([]);
});

test("has no avatar for an account that isn't a bot, or one without an address", async () => {
  const person = client(() =>
    json({ type: 'User', avatar_url: 'https://avatars.githubusercontent.com/u/1' }),
  );
  expect(await botAvatar(person.client, 'octocat')).toBeUndefined();
  const blank = client(() => json({ type: 'Bot', avatar_url: null }));
  expect(await botAvatar(blank.client, 'cursor')).toBeUndefined();
});

test("throws GitHub's error when there's no such account", async () => {
  const github = client(() => json({ message: 'Not Found' }, 404));
  await expect(botAvatar(github.client, 'gone')).rejects.toBeInstanceOf(GithubError);
});
