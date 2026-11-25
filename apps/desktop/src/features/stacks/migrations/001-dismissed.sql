-- The offers the reader dismissed for one stack or one layer, so each stays away through restarts:
-- `notice` names the offer (`convert`, to convert a branch stack to a GitHub stack, kept for each
-- of the stack's layers; `start`, to hide the changes of the layer below, kept for the layer), for
-- pull request `number` of `repo`, by name as GitHub gives it, in lowercase.
CREATE TABLE stacks_dismissed (
  notice TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (notice, repo, number)
) STRICT;
