// Which feed of releases Lo checks, if any. A packaged Lo checks only when it carries
// `app-update.yml`, which only a release build writes, so a zip made from a branch never does, and
// then only github.com's releases of withlo/lo, whatever the file says. A build run from source
// checks only when `LO_UPDATES_FEED` names a feed on this machine, for its tests; a packaged Lo
// never reads the variable. Nothing here calls Electron, so it runs under unit tests.

import { join } from 'node:path';

type Environment = Readonly<Record<string, string | undefined>>;

/** The file a release build of Lo carries among its resources, naming the feed to check. */
export const UPDATE_CONFIG = 'app-update.yml';

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

/**
 * Why a copy of Lo doesn't check for updates, as a check asked for says: it was built from source,
 * or it's packaged but isn't a release.
 */
export type Unchecked = 'source' | 'unreleased';

/**
 * The feed Lo checks, or why it checks none. A packaged Lo checks github.com's when it carries
 * `app-update.yml` in its `resources` folder, as `exists` finds it, and ignores `LO_UPDATES_FEED`.
 * A build run from source checks only the feed `LO_UPDATES_FEED` names, which must be
 * `http://127.0.0.1:<port>/`: anything else throws, so a test that mistypes it finds out.
 */
export function feedFor(options: {
  packaged: boolean;
  resources: string;
  exists(path: string): boolean;
  env: Environment;
}): { readonly feed: Feed } | { readonly unchecked: Unchecked } {
  if (options.packaged) {
    return options.exists(join(options.resources, UPDATE_CONFIG))
      ? { feed: GITHUB_FEED }
      : { unchecked: 'unreleased' };
  }
  const address = options.env.LO_UPDATES_FEED;
  if (address === undefined || address === '') return { unchecked: 'source' };
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
