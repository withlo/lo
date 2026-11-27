-- Where each bot's picture is, kept from run to run once GitHub has said (`main/bots.ts`): its path
-- on the avatars' host, an app's (`/in/<app id>`) or an account's (`/u/<id>`), by the bot's slug in
-- lowercase. `at` is when GitHub said it, in milliseconds since the Unix epoch: the newest are
-- kept.

CREATE TABLE comments_bots (
  slug TEXT PRIMARY KEY,
  picture TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
