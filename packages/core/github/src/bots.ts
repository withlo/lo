// A bot's avatar. GitHub draws a GitHub App's bot with the app's own picture, at an address only
// GitHub knows (`https://avatars.githubusercontent.com/in/<app id>`): the bot's login, as an
// avatar's address, names someone else's picture or a made-up pattern. GraphQL names a bot by its
// app's slug (`cursor`), and REST names its account `<slug>[bot]`, whose `avatar_url` says where
// the picture is.

import type { GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { unchecked } from './json.ts';

/** An app's slug, as GraphQL names its bot: letters, digits and hyphens. */
const SLUG = /^[A-Za-z0-9-]{1,39}$/;

/** What Lo reads of a bot's account (`GET /users/<slug>[bot]`). */
interface BotAccount {
  type?: unknown;
  avatar_url?: unknown;
}

/**
 * Where bot `login`'s avatar is, as GitHub's answer for its account says, or nothing for a login
 * that can't be a bot's, an account GitHub doesn't have (`404`), or one that isn't a bot. `login`
 * is the app's slug, as GraphQL gives it; with `[bot]` after it, as REST gives it, it's the same
 * bot. The address is GitHub's, unchecked: whoever loads it checks where it is. Throws a
 * `GithubError` when GitHub can't be asked, or answers otherwise.
 */
export async function botAvatar(client: GithubClient, login: string): Promise<string | undefined> {
  const slug = login.endsWith('[bot]') ? login.slice(0, -'[bot]'.length) : login;
  if (!SLUG.test(slug)) return undefined;
  let account: BotAccount;
  try {
    account = await client.get(
      `/users/${encodeURIComponent(`${slug}[bot]`)}`,
      unchecked<BotAccount>,
    );
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound') return undefined;
    throw error;
  }
  if (account.type !== 'Bot' || typeof account.avatar_url !== 'string') return undefined;
  return account.avatar_url;
}
