-- The tabs open in the window, in the strip's order, and the one on screen. Recent pull requests
-- isn't kept: it stands in for an empty strip. A pull request's tab keeps its title and state as
-- last seen, so the strip shows them before the tab has loaded.
CREATE TABLE tab_tabs (
  id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pull', 'settings')),
  owner TEXT,
  repo TEXT,
  number INTEGER,
  title TEXT,
  state TEXT CHECK (state IN ('open', 'draft', 'merged', 'closed')),
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  CHECK ((kind = 'pull') = (owner IS NOT NULL AND repo IS NOT NULL AND number IS NOT NULL))
) STRICT;
