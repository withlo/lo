-- The repositories' definitions, as Lo last read them, so an overview shows them at once, offline
-- too; the files each kept overview holds, so those of a closed pull request's stay; and stacks'
-- overviews, kept as pull requests' are. All are saved answers from GitHub, so clearing the cache
-- empties them.

-- What `refs/lo/terms` held in each repository when main last read it, by `owner/name`, matching
-- ignoring case as on GitHub: `found` as the window gets it, as JSON, and `bytes`, `terms.json`
-- as GitHub sent it once it hashed to its ID, when the ref held one Lo reads.
CREATE TABLE overview_stores (
  repository TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
  found TEXT NOT NULL,
  bytes BLOB,
  -- Milliseconds since the Unix epoch.
  seen_at INTEGER NOT NULL
) STRICT;

-- Whether the pull request was closed or merged, as Lo last saw it. The files of its kept overview
-- are never forgotten to make room.
ALTER TABLE overview_refs ADD COLUMN closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1));

-- The files each pull request's kept overview holds that Lo reads, `artifact.md` and its figures,
-- by their IDs.
CREATE TABLE overview_ref_files (
  repository TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (repository, number, id)
) STRICT;

CREATE INDEX overview_ref_files_id ON overview_ref_files (id);

-- The overview commit each stack's ref last held, as main read it, as `overview_refs` keeps pull
-- requests': by its repository and its stack's id, `number`. `closed` is always 0: a stack's
-- overview's files can go to make room.
CREATE TABLE overview_stack_refs (
  repository TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL,
  overview TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  seen_at INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed = 0),
  PRIMARY KEY (repository, number)
) STRICT;
