-- The window's own state, kept across restarts, in one row: the layout every pull request's tab
-- draws its row with, and where the window was, how big, and whether it filled the screen. Each is
-- JSON, read through its schema as it's read, so what won't read is the first layout, or the
-- window's first place.
CREATE TABLE tab_window (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  layout TEXT,
  place TEXT
) STRICT;
