-- Where an account marked each of a pull request's files viewed, on this computer: the head on
-- screen when Lo marked it, or the head a poll saw a mark set elsewhere at. GitHub resets a viewed
-- mark to "changed since viewed" when a push changes the file, without saying since when, so this is
-- what lets the file open to what changed since. It isn't a saved answer from GitHub, so clearing
-- the cache keeps it. Removing an account removes its rows, and a pull request's rows go a while
-- after it closes, as `revisions_closed` notes. Paths are as GitHub lists them, and match exactly.

CREATE TABLE revisions_viewed (
  login TEXT NOT NULL COLLATE NOCASE,
  pull TEXT NOT NULL COLLATE NOCASE,
  path TEXT NOT NULL,
  head TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  marked_at INTEGER NOT NULL,
  PRIMARY KEY (login, pull, path)
) STRICT;

CREATE INDEX revisions_viewed_pull ON revisions_viewed (pull);
