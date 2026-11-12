-- What Lo saw of each pull request's revisions on this computer: every head an account's poller saw,
-- and when it first saw it, which is one of the sources revisions are built from; and the newest
-- revision on screen when an account last left a pull request, "last seen here". Neither is a saved
-- answer from GitHub, so clearing the cache keeps them. Removing an account removes its rows, and a
-- pull request's rows go a while after it closes, which `revisions_closed` notes. Pull requests are
-- named `owner/repo#number` and logins as written, both matching ignoring case, as on GitHub.

CREATE TABLE revisions_seen (
  login TEXT NOT NULL COLLATE NOCASE,
  pull TEXT NOT NULL COLLATE NOCASE,
  head TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (login, pull, head)
) STRICT;

CREATE INDEX revisions_seen_pull ON revisions_seen (pull);

CREATE TABLE revisions_lastseen (
  login TEXT NOT NULL COLLATE NOCASE,
  pull TEXT NOT NULL COLLATE NOCASE,
  head TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (login, pull)
) STRICT;

-- When a pull request closed or merged, as its push history last said, while it's closed.
CREATE TABLE revisions_closed (
  pull TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  -- Milliseconds since the Unix epoch.
  closed_at INTEGER NOT NULL
) STRICT;
