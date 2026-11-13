-- Text typed into comment boxes and not yet posted, kept on this computer so that quitting Lo, or a
-- crash, loses none of it: by the account writing it, the pull request, and the comment box's place,
-- as JSON (a new thread's revision, path and lines, say). A place of a kind this version of Lo
-- doesn't know, written by a later one, is kept as it is. `sent` holds the text sent when GitHub's
-- answer to sending it was lost, until Lo has looked whether it posted. Removing an account removes
-- its rows.

CREATE TABLE comments_drafts (
  account TEXT NOT NULL COLLATE NOCASE,
  owner TEXT NOT NULL COLLATE NOCASE,
  repo TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL,
  place TEXT NOT NULL,
  body TEXT NOT NULL,
  sent TEXT,
  -- Milliseconds since the Unix epoch.
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (account, owner, repo, number, place)
) STRICT;
