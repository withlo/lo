-- A repository's merge queues, in a tab of their own: one for each repository and account, which
-- keeps the account it reads as in `login` and the branch whose queue it shows in `branch`. A kind
-- is checked when the table is made, so the table is made again with the new kind, and every row
-- copied over as it was.
CREATE TABLE tab_tabs_next (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pull', 'settings', 'queue')),
  owner TEXT,
  repo TEXT,
  number INTEGER,
  title TEXT,
  state TEXT CHECK (state IN ('open', 'draft', 'merged', 'closed')),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  login TEXT,
  repository TEXT,
  layer INTEGER CHECK (layer IS NULL OR layer > 0),
  branch TEXT,
  CHECK ((owner IS NULL) = (repo IS NULL)),
  CHECK ((kind = 'settings') = (owner IS NULL)),
  CHECK ((kind = 'pull') = (number IS NOT NULL)),
  CHECK ((kind = 'queue') = (branch IS NOT NULL)),
  CHECK (kind <> 'queue' OR login IS NOT NULL)
) STRICT;

INSERT INTO tab_tabs_next (
  id, position, kind, owner, repo, number, title, state, active, login, repository, layer
)
SELECT id, position, kind, owner, repo, number, title, state, active, login, repository, layer
FROM tab_tabs;

DROP TABLE tab_tabs;

ALTER TABLE tab_tabs_next RENAME TO tab_tabs;
