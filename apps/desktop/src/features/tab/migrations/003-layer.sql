-- The layer a pull request's tab shows when it isn't the pull request the tab opened on, so the tab
-- comes back at it. The title and state kept with the tab are that layer's.
ALTER TABLE tab_tabs ADD COLUMN layer INTEGER CHECK (layer IS NULL OR layer > 0);
