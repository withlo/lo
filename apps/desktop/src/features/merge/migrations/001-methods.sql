-- The merge method last used in each repository, which the merge panel picks first there: the one
-- GitHub took a merge with, whichever account sent it. A repository is named `owner/repo`, matching
-- ignoring case, as on GitHub. It isn't a saved answer from GitHub, so clearing the cache keeps it.

CREATE TABLE merge_methods (
  repo TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  method TEXT NOT NULL CHECK (method IN ('MERGE', 'SQUASH', 'REBASE')),
  -- Milliseconds since the Unix epoch.
  used_at INTEGER NOT NULL
) STRICT;
