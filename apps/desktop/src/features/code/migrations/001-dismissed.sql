-- The repositories whose banner saying language servers are off the reader dismissed, by name as
-- GitHub gives it, in lowercase, so the banner asks once a repository, through restarts.
CREATE TABLE code_dismissed (
  repo TEXT PRIMARY KEY,
  at INTEGER NOT NULL
) STRICT;
