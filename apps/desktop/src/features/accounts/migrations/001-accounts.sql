-- The accounts Lo is signed in to, their grants, and what Lo keeps for each: which account opens
-- an owner's or a repository's pull requests, what its poller read, and the pull requests it
-- opened. Logins, owners and repository names match ignoring case, as on GitHub. Removing an
-- account removes everything kept for it, but its grant, which goes first.

CREATE TABLE accounts_accounts (
  login TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  user_id INTEGER NOT NULL,
  name TEXT,
  avatar_url TEXT,
  -- The scopes GitHub said its token had, as a JSON array of strings.
  scopes TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('deviceFlow', 'gh')),
  -- Seconds since the Unix epoch.
  added_at INTEGER NOT NULL
) STRICT;

-- Accounts whose token GitHub refused, which stay signed out until they sign in again.
CREATE TABLE accounts_refused (
  login TEXT NOT NULL PRIMARY KEY COLLATE NOCASE
    REFERENCES accounts_accounts (login) ON DELETE CASCADE,
  -- Seconds since the Unix epoch.
  at INTEGER NOT NULL
) STRICT;

-- The account chosen for an owner's repositories.
CREATE TABLE accounts_owners (
  owner TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  login TEXT NOT NULL COLLATE NOCASE REFERENCES accounts_accounts (login) ON DELETE CASCADE
) STRICT;

CREATE INDEX accounts_owners_login ON accounts_owners (login);

-- The account chosen for one repository, which wins over its owner's.
CREATE TABLE accounts_repos (
  owner TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL COLLATE NOCASE,
  login TEXT NOT NULL COLLATE NOCASE REFERENCES accounts_accounts (login) ON DELETE CASCADE,
  PRIMARY KEY (owner, name)
) STRICT;

CREATE INDEX accounts_repos_login ON accounts_repos (login);

-- Each account's grant, its access and refresh tokens, encrypted whole by the system's keychain
-- (Electron's safeStorage). Never a token in the clear. It isn't tied to the account's row, since
-- a sign-in keeps the grant before the row.
CREATE TABLE accounts_grants (
  login TEXT NOT NULL PRIMARY KEY COLLATE NOCASE,
  sealed BLOB NOT NULL
) STRICT;

-- What each account's poller read, by target (a pull request's or a repository's key) and name,
-- written by one build of Lo: another build's rows read as missing.
CREATE TABLE accounts_answers (
  login TEXT NOT NULL COLLATE NOCASE REFERENCES accounts_accounts (login) ON DELETE CASCADE,
  target TEXT NOT NULL,
  name TEXT NOT NULL,
  build TEXT NOT NULL,
  -- JSON.
  value TEXT NOT NULL,
  -- Milliseconds since the Unix epoch.
  fetched_at INTEGER NOT NULL,
  stamp TEXT,
  PRIMARY KEY (login, target, name)
) STRICT;

-- The pull requests opened most recently, each once, as GitHub last named its repository.
CREATE TABLE accounts_recent (
  owner TEXT NOT NULL COLLATE NOCASE,
  repo TEXT NOT NULL COLLATE NOCASE,
  number INTEGER NOT NULL,
  title TEXT,
  login TEXT NOT NULL COLLATE NOCASE REFERENCES accounts_accounts (login) ON DELETE CASCADE,
  -- Milliseconds since the Unix epoch.
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (owner, repo, number)
) STRICT;

CREATE INDEX accounts_recent_opened ON accounts_recent (opened_at);
CREATE INDEX accounts_recent_login ON accounts_recent (login);
