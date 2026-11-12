-- What Lo keeps of pull requests' overviews, read from GitHub, so one shows at once, offline too:
-- the commit each pull request's overview ref held when Lo last read it, and the files of overviews
-- by their IDs. Both are saved answers from GitHub, so clearing the cache empties them.

-- The overview commit each pull request's ref last held, as main read it: by its repository,
-- `owner/name`, and number, matching ignoring case as on GitHub. `overview` is the commit as the
-- window gets it, as JSON.
CREATE TABLE overview_refs (
  repository TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL,
  overview TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (repository, number)
) STRICT;

-- Overviews' files, by their git IDs: `artifact.md` and figures, each checked against its ID when
-- it's kept and again when it's read. Past a cap on their sizes, those used least recently go.
CREATE TABLE overview_blobs (
  id TEXT NOT NULL PRIMARY KEY,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  -- Milliseconds since the Unix epoch.
  used_at INTEGER NOT NULL
) STRICT;

CREATE INDEX overview_blobs_used ON overview_blobs (used_at);
