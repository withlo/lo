// GitHub's command-line tool, `gh`, which Lo can import accounts from. Lo asks gh itself rather
// than reading its files or keychain items, whose format is gh's own business: `gh auth status`
// lists its accounts without their tokens, and `gh auth token` prints one account's token, which Lo
// reads through a pipe and never writes, logs or repeats.
//
// gh is found as git is: each `gh` on `PATH`, then the system's usual folders, and one that someone
// besides this user or root could change is passed over, since it would be handed the user's
// tokens. It runs with an environment of Lo's making, never main's, so no token in Lo's environment
// (`GH_TOKEN`, `GITHUB_TOKEN`) reaches it and it reports the accounts it keeps; with an argument
// list, never through a shell; and with a time limit, so a gh that hangs can't hold Lo up.

import { realpath } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

import {
  Child,
  defaultPlaces,
  GitError,
  isExecutableFile,
  whyDistrusted,
  type Places,
} from '@lo/git';
import { Token } from '@lo/github';

type Environment = Readonly<Record<string, string | undefined>>;

/** The GitHub whose accounts Lo imports. */
const HOST = 'github.com';

/** How long gh has to answer: `gh auth status` checks each token with GitHub. */
const TIMEOUT = 30_000;

/** The most gh may print listing its accounts, or printing a token. */
const STATUS_LIMIT = 1024 * 1024;
const TOKEN_LIMIT = 64 * 1024;

/**
 * The variables gh takes from Lo's environment: where its config and keyring are, the network's
 * proxy and certificate authorities, and nothing that holds a token or picks another host.
 */
const INHERITED = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'LANG',
  'GH_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  // Where Linux's keyring answers.
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const;

/**
 * gh's whole environment: the few variables it takes from Lo's, and Lo's own settings, which stop it
 * prompting, paging, coloring or checking for updates.
 */
export function ghEnvironment(env: Environment): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of INHERITED) {
    const value = env[name];
    if (value !== undefined) kept[name] = value;
  }
  return {
    ...kept,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
  };
}

/** Why gh couldn't be found or run, or what it said went wrong, in words for the person. */
export class GhError extends Error {
  override name = 'GhError';
}

/** Where gh is, or why Lo has none. */
export type GhLookup =
  | { readonly kind: 'found'; readonly program: string }
  | { readonly kind: 'missing'; readonly message: string };

/** An account gh is signed in to on github.com, as `gh auth status` lists it. */
export interface GhAccount {
  readonly login: string;
  /** Whether it's the account gh uses for github.com. */
  readonly active: boolean;
  /** What gh found checking its token: `success` when it works. */
  readonly state: string;
  /** The scopes gh says its token has. */
  readonly scopes: readonly string[];
  /** Whether its token expires within hours, as gh renews it. */
  readonly refreshable: boolean;
}

export interface GhOptions {
  /** Lo's environment: `PATH` says where to look, and gh keeps a few of its variables. */
  readonly env: Environment;
  readonly platform: NodeJS.Platform;
  /**
   * The gh to run rather than one Lo finds, for tests: an absolute path, or `none` for no gh at
   * all. It's held to the same rule as one Lo finds.
   */
  readonly program?: string | undefined;
  /** Where to look besides `PATH`, and who may write there: git's places unless said otherwise. */
  readonly places?: Places | undefined;
  /** How long gh may take, in milliseconds. */
  readonly timeout?: number | undefined;
}

/** gh, as Lo finds and runs it. Nothing is remembered between calls, so a gh installed since is found. */
export class Gh {
  readonly #options: GhOptions;
  readonly #places: Places;
  readonly #stopping = new AbortController();

  constructor(options: GhOptions) {
    this.#options = options;
    this.#places = options.places ?? defaultPlaces(options.platform);
  }

  /**
   * Finds gh: each on `PATH`, then the system's usual folders. The first that runs and that only
   * this user or root can change wins. Without one, it says why: the first passed over, else that
   * there's none.
   */
  async find(): Promise<GhLookup> {
    const { program } = this.#options;
    if (program === 'none') return missing();
    const candidates =
      program === undefined
        ? [...(this.#options.env.PATH ?? '').split(delimiter), ...this.#places.folders]
            .filter((folder) => isAbsolute(folder))
            .map((folder) => join(folder, 'gh'))
        : [program];
    const tried = new Set<string>();
    let passedOver: GhLookup | undefined;
    for (const candidate of candidates) {
      const real = await realpath(candidate).catch(() => undefined);
      if (real === undefined || tried.has(real)) continue;
      tried.add(real);
      if (!(await isExecutableFile(candidate))) continue;
      const distrusted = await whyDistrusted(candidate, this.#places.groups);
      if (distrusted !== undefined) {
        passedOver ??= {
          kind: 'missing',
          message: `Lo found gh at ${candidate}, but ${distrusted}, so Lo won't run it.`,
        };
        continue;
      }
      return { kind: 'found', program: candidate };
    }
    return passedOver ?? missing();
  }

  /** gh's version, such as `2.62.0`, or nothing when it doesn't say. */
  async version(program: string): Promise<string | undefined> {
    const said = await this.#run(program, ['--version'], 'say its version', 64 * 1024).catch(
      () => undefined,
    );
    return /^gh version (\d+\.\d+(?:\.\d+)?)/.exec(said?.toString('utf8') ?? '')?.[1];
  }

  /** The github.com accounts gh is signed in to. */
  async accounts(program: string): Promise<GhAccount[]> {
    const listed = await this.#run(
      program,
      ['auth', 'status', '--json', 'hosts', '--hostname', HOST],
      'list its accounts',
      STATUS_LIMIT,
    );
    return parseStatus(listed.toString('utf8'));
  }

  /**
   * The token gh keeps for `login` on github.com, read from its output, which nothing else sees.
   * Throws a {@link GhError} when gh has none, saying what gh said, never the token.
   */
  async token(program: string, login: string): Promise<Token> {
    const printed = await this.#run(
      program,
      ['auth', 'token', '--hostname', HOST, `--user=${login}`],
      `read ${login}'s token`,
      TOKEN_LIMIT,
    );
    const token = new Token(printed.toString('utf8'));
    if (token.isEmpty) throw new GhError(`gh has no token for ${login}.`);
    return token;
  }

  /** Stops every gh running, and runs none from now on. Run once, as Lo quits. */
  stop(): void {
    this.#stopping.abort(new GhError('Lo is quitting.'));
  }

  /** Runs gh with `args`, for what it prints, which is at most `limit` bytes. */
  async #run(program: string, args: string[], what: string, limit: number): Promise<Buffer> {
    const signal = this.#stopping.signal;
    signal.throwIfAborted();
    const timeout = this.#options.timeout ?? TIMEOUT;
    const { env } = this.#options;
    const home = env.HOME !== undefined && isAbsolute(env.HOME) ? env.HOME : '/';
    let finished;
    try {
      const child = new Child(program, {
        args,
        env: ghEnvironment(env),
        cwd: home,
        input: false,
        display: `gh ${args[0] ?? ''}`,
      });
      finished = await child.finish(undefined, { timeout, maxBytes: limit, signal });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof GitError && error.detail.kind === 'tooSlow') {
        throw new GhError(`gh didn't ${what} within ${timeout / 1000} s, so Lo stopped it.`, {
          cause: error,
        });
      }
      if (error instanceof GitError && error.detail.kind === 'tooLarge') {
        throw new GhError(`gh printed more than Lo expected when asked to ${what}.`, {
          cause: error,
        });
      }
      throw new GhError(`Lo couldn't run gh at ${program}.`, { cause: error });
    }
    // A gh stopped as Lo quits ends without an error of its own.
    if (signal.aborted) throw signal.reason;
    if (finished.code !== 0) {
      const said = summarize(finished.stderr);
      if (said.includes('unknown flag: --json')) {
        throw new GhError('Lo needs a newer gh to list its accounts. Update gh and try again.');
      }
      throw new GhError(said === '' ? `gh couldn't ${what}.` : `gh couldn't ${what}: ${said}`);
    }
    return finished.stdout;
  }
}

function missing(): GhLookup {
  return { kind: 'missing', message: "Lo can't find gh, GitHub's command-line tool." };
}

/** Anything that looks like a GitHub token, which never reaches an error message. */
const TOKEN_SHAPED = /\b(?:gh[opsur]_|github_pat_)[A-Za-z0-9_]+/g;

/** The last line gh wrote to stderr, short, with anything shaped like a token taken out. */
export function summarize(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((each) => each.trim())
    .findLast((each) => each !== '');
  if (line === undefined) return '';
  const clean = line.replaceAll(TOKEN_SHAPED, '<redacted>');
  return clean.length > 300 ? `${clean.slice(0, 299)}…` : clean;
}

/** A login as GitHub allows them, which is all Lo takes from gh. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** Where gh says a token came from when it's from the environment, which isn't an account gh keeps. */
const FROM_ENVIRONMENT = new Set([
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
]);

/**
 * The github.com accounts in what `gh auth status --json hosts` printed, each once, leaving out a
 * token from the environment and anything that isn't a login. Throws a {@link GhError} when it
 * isn't the JSON gh prints.
 */
export function parseStatus(printed: string): GhAccount[] {
  let json: unknown;
  try {
    json = JSON.parse(printed);
  } catch {
    json = undefined;
  }
  const hosts = field(json, 'hosts');
  if (hosts === undefined || typeof hosts !== 'object' || hosts === null) {
    throw new GhError("gh's list of accounts isn't what Lo expects.");
  }
  const entries = field(hosts, HOST);
  const accounts: GhAccount[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const login = field(entry, 'login');
    if (typeof login !== 'string' || !LOGIN.test(login)) continue;
    const source = field(entry, 'tokenSource');
    if (typeof source === 'string' && FROM_ENVIRONMENT.has(source)) continue;
    if (accounts.some((account) => account.login.toLowerCase() === login.toLowerCase())) continue;
    const state = field(entry, 'state');
    const scopes = field(entry, 'scopes');
    accounts.push({
      login,
      active: field(entry, 'active') === true,
      state: typeof state === 'string' ? state.slice(0, 40) : 'unknown',
      scopes:
        typeof scopes === 'string'
          ? scopes
              .split(',')
              .map((scope) => scope.trim())
              .filter((scope) => scope !== '')
          : [],
      refreshable: field(entry, 'refreshable') === true,
    });
  }
  return accounts;
}

/** `value[name]`, when `value` is an object that has it as its own. */
function field(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, name)) return undefined;
  return Reflect.get(value, name);
}
