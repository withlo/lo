-- Auto-merge that approve and ship turned on after you approved, which Lo watches while it runs, a
-- restart included: GitHub keeps auto-merge on when someone pushes, and unless the base branch's
-- rules want a new approval after a push, the push merges with yours. So once one comes, Lo turns
-- auto-merge off. A row goes once the pull request merges or closes, auto-merge is off or isn't
-- Lo's any more, or Lo turned it off. Names match ignoring case, as on GitHub. It isn't a saved
-- answer from GitHub, so clearing the cache keeps it.

CREATE TABLE merge_shipped (
  -- The account approve and ship ran as, which turned auto-merge on.
  login TEXT NOT NULL COLLATE NOCASE,
  owner TEXT NOT NULL COLLATE NOCASE,
  repo TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL CHECK (number > 0),
  -- The head you approved, which auto-merge was turned on to expect, or a later one your latest
  -- review approves.
  head TEXT NOT NULL,
  -- Who turned it on, as GitHub spells the account once it answered.
  enabled_by TEXT NOT NULL,
  -- The method it was turned on with. NULL on a branch with a merge queue, where GitHub reports a
  -- merge commit whatever was asked, so the method isn't compared there.
  method TEXT CHECK (method IN ('MERGE', 'SQUASH', 'REBASE')),
  -- The branch it merges into.
  base TEXT NOT NULL,
  -- When approve and ship turned it on, in milliseconds since the Unix epoch.
  shipped_at INTEGER NOT NULL,
  PRIMARY KEY (login, owner, repo, number)
) STRICT;
