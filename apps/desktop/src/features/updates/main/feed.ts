// Which feed of releases Lo checks, if any. A packaged Lo checks only when it carries
// `app-update.yml`, which only a release build writes, so a zip made from a branch never does, and
// then only github.com's releases of withlo/lo, whatever the file says. A build run from source
// checks only when `LO_UPDATES_FEED` names a feed on this machine, for its tests; a packaged Lo
// never reads the variable. Nothing here calls Electron, so it runs under unit tests.

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * A feed of releases, as electron-updater's GitHub provider takes one: github.com's releases of
 * withlo/lo, or, for tests, the same paths on a server on this machine. Never private and never
 * with a token, so electron-updater sends no `Authorization` header, whatever `GH_TOKEN` and
 * `GITHUB_TOKEN` hold.
 */
export interface Feed {
  readonly provider: 'github';
  readonly owner: 'withlo';
  readonly repo: 'lo';
  readonly private: false;
  /** The server on this machine, as `127.0.0.1:<port>`: none for github.com. */
  readonly host?: string;
  readonly protocol?: 'http';
}

/** github.com's releases of withlo/lo: the only feed a packaged Lo checks. */
export const GITHUB_FEED: Feed = Object.freeze({
  provider: 'github',
  owner: 'withlo',
  repo: 'lo',
  private: false,
});

/** Why a copy of Lo doesn't check for updates, as a check asked for says. */
export const UNCHECKED = {
  source: 'This copy of Lo was built from source, so it doesn’t check for updates.',
  unreleased: 'This copy of Lo isn’t a release, so it doesn’t check for updates.',
} as const;

/**
 * The feed Lo checks, or why it checks none. A packaged Lo checks github.com's when it carries
 * `app-update.yml` (`configured`), and ignores `LO_UPDATES_FEED`. A build run from source checks
 * only the feed `LO_UPDATES_FEED` names, which must be `http://127.0.0.1:<port>/`: anything else
 * throws, so a test that mistypes it finds out.
 */
export function feedFor(options: {
  packaged: boolean;
  configured: boolean;
  env: Environment;
}): { readonly feed: Feed } | { readonly unchecked: string } {
  if (options.packaged) {
    return options.configured ? { feed: GITHUB_FEED } : { unchecked: UNCHECKED.unreleased };
  }
  const address = options.env.LO_UPDATES_FEED;
  if (address === undefined || address === '') return { unchecked: UNCHECKED.source };
  const url = URL.parse(address);
  const local =
    url !== null &&
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.port !== '' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    // `URL` drops what it takes for the default port, and a trailing `?` or `#`.
    address === url.href;
  if (!local) {
    throw new Error(
      `LO_UPDATES_FEED must be a feed on this machine, http://127.0.0.1:<port>/, not ${JSON.stringify(address)}.`,
    );
  }
  return { feed: { ...GITHUB_FEED, host: url.host, protocol: 'http' } };
}
