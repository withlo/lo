-- What a pull request's tab keeps of how it opened: the account it acts as, and its repository's
-- name as GitHub last gave it, so it comes back acting as it did, and shows what it fetched before
-- while GitHub can't be reached.
ALTER TABLE tab_tabs ADD COLUMN login TEXT;
ALTER TABLE tab_tabs ADD COLUMN repository TEXT;
