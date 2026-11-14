-- A draft written on an overview's code block keeps `home`, the block, as JSON: the commit the
-- overview describes, the file and lines the block points at, and the lines the comment was written
-- under there. Its box opens there again, whatever its place. Other drafts have none.

ALTER TABLE comments_drafts ADD COLUMN home TEXT;
