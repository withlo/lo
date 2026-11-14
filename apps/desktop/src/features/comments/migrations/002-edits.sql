-- An edit's draft keeps `base`, the comment's text on GitHub when the edit started: the edit goes
-- only while GitHub still has that text, so it never overwrites an edit made elsewhere since, a
-- restart included. Other drafts have none.

ALTER TABLE comments_drafts ADD COLUMN base TEXT;
