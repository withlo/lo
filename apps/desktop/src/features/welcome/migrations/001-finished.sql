-- When the reader finished the welcome, by "Done", by "Skip" or by opening a pull request from it,
-- so it opens by itself only until then. One row at most.
CREATE TABLE welcome_finished (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at INTEGER NOT NULL
) STRICT;
