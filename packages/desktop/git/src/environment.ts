/**
 * The environment every git runs in, built from nothing rather than inherited and patched:
 *
 * - Only `PATH`, `TMPDIR`, `DEVELOPER_DIR` and the certificate authorities' variables come from
 *   Lo's environment. Everything else is dropped, including every `GIT_*` variable, so nothing
 *   adds config (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`), points git at another repository,
 *   template, program or attribute source (`GIT_DIR`, `GIT_TEMPLATE_DIR`, `GIT_EXEC_PATH`,
 *   `GIT_SSH_COMMAND`, `GIT_ATTR_SOURCE`) or prompts (`SSH_ASKPASS`). Proxies are dropped too: a
 *   fetch gets the one Lo's own requests to GitHub take, so git and Lo go the same way.
 * - `HOME` is a folder of Lo's, so git and its HTTP library read none of the user's files there
 *   (`~/.gitconfig`, `~/.config/git/attributes`, `~/.netrc`).
 * - No system or global config, no credential helper but Lo's, and no prompts. The only credential
 *   git gets is the token, and only on a fetch: a helper scoped to the remote's own address reads
 *   it from a variable set on that git alone. A proxy that asks for a password, or a host a
 *   request is redirected to, matches no helper, and git fails rather than prompting. Redirects
 *   are off anyway: Lo fetches each repository by its canonical name.
 * - Every git but a fetch runs with lazy fetching off (`GIT_NO_LAZY_FETCH`), so reading the
 *   clone never reaches the network: a missing object is an error, not a download.
 * - No hooks, no file system monitor, no attributes (not the system's or the user's files, and not
 *   a repository's own `.gitattributes`), no replace refs, no submodules, and literal pathspecs.
 * - Nothing a server offers sends git to another host: no bundle URIs, promisor remotes or
 *   packfile URIs.
 * - Only the remote's protocol, HTTPS, and no address that carries a password.
 * - Every command names its repository, and git never looks for one in the cache's folder or above
 *   it (`GIT_CEILING_DIRECTORIES`), so a clone that's half deleted is an error, never a reason to
 *   use some repository further up.
 * - `LC_ALL=C`, so the messages Lo reads are in English.
 *
 * The user's git config is never read or written, and nothing in it or in Lo's environment (URL
 * rewrites, credential helpers, filters, hooks) changes what git fetches or runs.
 */

import { devNull } from 'node:os';

import { GitError } from './errors.ts';

/** An environment, as `process.env` is. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** The variables git takes from Lo's environment. */
const INHERITED = [
  'PATH',
  'TMPDIR',
  // Which Xcode Apple's `/usr/bin/git` runs git from.
  'DEVELOPER_DIR',
  // Certificate authorities, for networks that inspect TLS.
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
] as const;

/** Keeps the variables git takes from `env`, and drops the rest. */
export function inheritedEnvironment(env: Environment): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = env[name];
    if (value !== undefined) kept[name] = value;
  }
  return kept;
}

/** The empty tree's ID, which git knows without having it. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** The variable the credential helper reads the token from, set only on a fetch. */
export const TOKEN_VARIABLE = 'LO_GIT_TOKEN';

/**
 * The credential helper: a shell function git runs with the action (`get`, `store` or `erase`) as
 * its argument. It answers `get` with the token in {@link TOKEN_VARIABLE}, and nothing else.
 */
export const CREDENTIAL_HELPER =
  `!f() { test "$1" = get || exit 0; ` +
  `printf 'username=x-access-token\\npassword=%s\\n' "$${TOKEN_VARIABLE}"; }; f`;

/** Where fetches go, and so the one place git may reach and the token may go. */
export interface Remote {
  /** The address repositories are under, as `<base>/<owner>/<repo>.git`: `https://github.com`. */
  readonly base: string;
  /** git's name for the transport it takes: `https`, or in tests `http` or `file`. */
  readonly protocol: 'https' | 'http' | 'file';
  /** The address the credential helper answers for: the base's scheme, host and port. */
  readonly origin: string | undefined;
}

/** GitHub, which Lo fetches every repository from. */
export const GITHUB = 'https://github.com';

/** The hosts a test's server may be on: this machine. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The remote at `base`. It's GitHub, `https://github.com` exactly, since the credential helper
 * answers for whatever address the remote has. Only with `test`, which a packaged build never
 * sets, may it be a server on this machine, over `https:` or `http:`, or a `file:` folder. An
 * address with a user, a password, a path, a query or a fragment is refused.
 */
export function parseRemote(base: string, options: { test?: boolean } = {}): Remote {
  const url = URL.parse(base);
  // An address's user and password never reach an error.
  const shown = base.replace(/\/\/[^/@]*@/, '//<redacted>@');
  const refuse = () => new GitError({ kind: 'invalid', what: 'remote address', value: shown });
  if (!url || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw refuse();
  }
  if (url.protocol === 'https:' && url.host === 'github.com' && url.pathname === '/') {
    return { base: GITHUB, protocol: 'https', origin: GITHUB };
  }
  if (!options.test) throw refuse();
  const trimmed = base.replace(/\/+$/, '');
  if (url.protocol === 'file:') return { base: trimmed, protocol: 'file', origin: undefined };
  const local = LOOPBACK.has(url.hostname) && url.pathname === '/';
  if (local && url.protocol === 'https:')
    return { base: url.origin, protocol: 'https', origin: url.origin };
  if (local && url.protocol === 'http:')
    return { base: url.origin, protocol: 'http', origin: url.origin };
  throw refuse();
}

/**
 * Lo's own settings, which every git gets on its command line. With `signIn`, git may give the
 * token to the remote, and only to it.
 */
export function configArguments(remote: Remote, signIn: boolean): string[] {
  const settings = [
    // No credential helper, prompt or redirect: only Lo's helper, added below for the remote's
    // address, gives git a credential.
    'credential.helper=',
    'core.askPass=',
    'http.followRedirects=false',
  ];
  if (signIn && remote.origin !== undefined) {
    settings.push(`credential.${remote.origin}.helper=${CREDENTIAL_HELPER}`);
  }
  settings.push(
    // Paths are the bytes in the tree. A Mac's git otherwise composes a decomposed name it's
    // given, and reads the composed one's file.
    'core.precomposeUnicode=false',
    // Symlinks in a checkout become plain files holding their target, so nothing in a checkout
    // points outside it.
    'core.symlinks=false',
    // Nor does a checkout write a path a Mac's or Windows' file system would take for `.git` or
    // something else it shouldn't.
    'core.protectHFS=true',
    'core.protectNTFS=true',
    // No garbage collection or maintenance in the background, behind Lo's back.
    'gc.auto=0',
    'maintenance.auto=false',
    // The stall guard: give up on a connection that sends nothing for a minute, rather than
    // hanging. It doesn't cover connecting, and GitHub's keep-alives count as something, so
    // fetches also have limits of their own.
    'http.lowSpeedLimit=1',
    'http.lowSpeedTime=60',
    // Nothing in a repository or Lo's environment makes git run a program: no hooks (a checkout
    // runs post-checkout) and no file system monitor.
    `core.hooksPath=${devNull}`,
    'core.fsmonitor=false',
    // No attributes: not the user's file, and not a repository's own `.gitattributes`, whatever a
    // clone's config says. `--attr-source` reads them from the empty tree instead.
    `core.attributesFile=${devNull}`,
    // Nothing a server offers, or a clone's settings name, makes git fetch from another host:
    // no bundles, no other promisor remotes, no packfile URIs.
    'transfer.bundleURI=false',
    'fetch.bundleURI=',
    'promisor.acceptFromServer=None',
    'fetch.uriProtocols=',
    // The remote's protocol only: no ssh, git or ext transports, and no local paths.
    'protocol.allow=never',
    `protocol.${remote.protocol}.allow=always`,
    // No address with a password in it.
    'transfer.credentialsInUrl=die',
    // A bare repository is used only when a command names it, never one found inside a checkout.
    'safe.bareRepository=explicit',
    // A repository's submodules are other repositories, which Lo never fetches or checks out.
    'submodule.recurse=false',
    'fetch.recurseSubmodules=false',
  );
  return [...settings.flatMap((setting) => ['-c', setting]), `--attr-source=${EMPTY_TREE}`];
}

/** Where git works, besides its repository. */
export interface Folders {
  /** The empty folder git gets as its `HOME`, and runs in when it has no work tree. */
  readonly home: string;
  /** git never looks for a repository in this folder or above it: the cache's own. */
  readonly ceiling: string;
}

/**
 * The whole environment of a git: `inherited`, from Lo's environment, and Lo's own variables.
 * Only a fetch (`fetch`) may download, and only a fetch gets the token and the proxy.
 */
export function gitEnvironment(
  inherited: Readonly<Record<string, string>>,
  folders: Folders,
  remote: Remote,
  fetch: { token?: string | undefined; proxy?: string | undefined } | undefined,
): Record<string, string> {
  const env: Record<string, string> = {
    ...inherited,
    HOME: folders.home,
    GIT_CEILING_DIRECTORIES: folders.ceiling,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    // Nor the system's attributes, such as `/etc/gitattributes`.
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_LITERAL_PATHSPECS: '1',
    // Wins over any config, a test's included: git takes no other protocol.
    GIT_ALLOW_PROTOCOL: remote.protocol,
    LC_ALL: 'C',
  };
  if (fetch === undefined) {
    env.GIT_NO_LAZY_FETCH = '1';
    return env;
  }
  if (fetch.token !== undefined) env[TOKEN_VARIABLE] = fetch.token;
  if (fetch.proxy !== undefined) {
    // The spellings git and curl read. `http_proxy` has only a lowercase one.
    env.http_proxy = fetch.proxy;
    env.https_proxy = fetch.proxy;
  }
  return env;
}
