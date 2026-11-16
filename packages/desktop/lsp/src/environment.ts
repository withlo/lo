/**
 * The environment a language server runs in, built from nothing rather than taken from Lo's and
 * trimmed, so nothing of Lo's reaches it: no token, no SSH agent, no proxy, none of the user's
 * settings.
 *
 * - `HOME` is a folder of the server's own, and `TMPDIR` a folder inside it, so the server reads
 *   none of the user's files there (`~/.gitconfig`, `~/.npmrc`, `~/.cargo/config.toml`, shell
 *   profiles) and keeps its caches where nothing else looks.
 * - `PATH` holds the folders the server's adapter names, then the system's own (`/usr/bin`,
 *   `/bin`). Each is an absolute path outside the checkout, as given and as the system resolves
 *   it, so nothing in the checkout chooses a program, and none is empty, which would mean the
 *   folder the server runs in: the checkout. `HOME` is held to the same.
 * - git's variables, from `@lo/git`, set up any git the server runs: Lo's safe settings as
 *   protected configuration, no system or global config, no prompts and no lazy fetching. They're
 *   the only `GIT_*` variables it gets.
 * - The adapter's own variables, such as `GOPROXY=off`. None may set what's above, a proxy, the
 *   SSH agent or anything named like a secret or credential. Nor may one load code into a program
 *   or a shell (`LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, `BASH_ENV`,
 *   `RUSTC_WRAPPER`, `GOFLAGS`, `CLASSPATH` and the like) or configure npm, unless the adapter
 *   names it in `allowed`, saying it sets it on purpose.
 * - `LANG=C.UTF-8`, so servers read source as UTF-8.
 */

import { isAbsolute, join, relative, sep } from 'node:path';

/** The system's folders, which end every server's `PATH`. */
export const SYSTEM_PATH = ['/usr/bin', '/bin'] as const;

export interface EnvironmentOptions {
  /** The server's own folder, its `HOME`. */
  readonly home: string;
  /** The checkout the server runs on, as given and as the system resolves it. */
  readonly roots: readonly string[];
  /** The folders of the toolchain the server needs, first on its `PATH`. */
  readonly path: readonly string[];
  /** The adapter's own variables. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /**
   * The names among `variables` that load code or configure a program, which the adapter sets on
   * purpose. Never a proxy, the SSH agent, git's or a secret.
   */
  readonly allowed?: readonly string[] | undefined;
  /** The variables that set up the git a server runs, each `GIT_*`, from `@lo/git`. */
  readonly git: Readonly<Record<string, string>>;
}

/** The variables this module sets itself. */
const OWN = new Set(['HOME', 'PATH', 'TMPDIR', 'LANG']);

/** Names no adapter's variable may have. */
const NEVER = [
  // Lo's settings for git come only from `@lo/git`.
  /^GIT_/,
  // Proxies, in every spelling programs read.
  /^(?:https?|ftp|all|no)_proxy$/i,
  // The SSH agent, and the programs that ask for a password.
  /^SSH_(?:AUTH_SOCK|AGENT_PID|ASKPASS)/,
  /ASKPASS/,
  // Anything named like a secret or a credential, such as `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID` or
  // npm's `_auth`.
  /TOKEN|SECRET|PASSW(?:OR)?D|PASSPHRASE|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|_AUTH|COOKIE/i,
  /(?:^|_)(?:KEY|PASS|PWD|AUTH|DSN|SESSION)(?:_|$)/i,
];

/** Names that load code into a program or a shell, or configure one: only when an adapter allows them. */
const RISKY = [
  // The dynamic loaders'.
  /^(?:LD|DYLD)_/,
  // Code a runtime loads before its program, or where it looks for modules.
  /^NODE_(?:OPTIONS|PATH|REPL_EXTERNAL_MODULE)$/,
  /^ELECTRON_/,
  /^PYTHON(?:STARTUP|PATH|HOME|INSPECT|USERBASE)$/,
  /^PERL5?(?:OPT|LIB)$/,
  /^RUBY(?:OPT|LIB)$/,
  /^(?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|JAVA_OPTS|CLASSPATH)$/,
  /^(?:GRADLE_OPTS|GRADLE_USER_HOME|MAVEN_OPTS)$/,
  /^(?:DOTNET_STARTUP_HOOKS|DOTNET_ADDITIONAL_DEPS|CORECLR_.+)$/,
  // Programs a toolchain runs in place of its own, and flags it passes them.
  /^(?:RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTC|RUSTDOC|CARGO_BUILD_RUSTC_WRAPPER)$/,
  /^GOFLAGS$/,
  // Where the C library and Ruby load code from.
  /^(?:GCONV_PATH|GEM_PATH|GEM_HOME|BUNDLE_GEMFILE|RUBYGEMS_GEMDEPS)$/,
  // What a shell runs as it starts, and how it reads.
  /^(?:BASH_ENV|ENV|ZDOTDIR|PROMPT_COMMAND|PS4|SHELLOPTS|BASHOPTS|IFS|CDPATH)$/,
  /^BASH_FUNC_/,
  // npm's own settings, which can name a shell, a script or a registry.
  /^npm_config_/i,
];

/** A variable's name, as the shell spells one. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Whether `path` is `root` or inside it. */
export function isInside(root: string, path: string): boolean {
  const between = relative(root, path);
  return between !== '..' && !between.startsWith(`..${sep}`) && !isAbsolute(between);
}

/** The folder a server's `TMPDIR` names, inside its `HOME`. */
export function temporaryFolder(home: string): string {
  return join(home, 'tmp');
}

/**
 * The whole environment of a language server. It throws on a folder or variable it refuses, which
 * is a mistake in Lo's own code: an adapter's or the app's.
 */
export function serverEnvironment(options: EnvironmentOptions): Record<string, string> {
  const { home, roots, path, variables = {}, allowed = [], git } = options;
  const inside = (folder: string) => roots.some((root) => isInside(root, folder));
  if (!isAbsolute(home) || inside(home)) {
    throw new Error(`a server's home must be an absolute path outside its checkout: ${home}`);
  }
  for (const folder of path) {
    if (!isAbsolute(folder) || folder.includes(':') || folder.includes('\0')) {
      throw new Error(`a folder on a server's PATH must be an absolute path: ${folder}`);
    }
    if (inside(folder)) {
      throw new Error(`a folder on a server's PATH must be outside its checkout: ${folder}`);
    }
  }
  const env: Record<string, string> = {};
  const gitNames = Object.keys(git);
  if (gitNames.length === 0) throw new Error('a server needs git’s variables');
  for (const name of gitNames) {
    if (!name.startsWith('GIT_') || !NAME.test(name)) {
      throw new Error(`git's variables are each GIT_*: ${name}`);
    }
    env[name] = checkedValue(name, git[name]);
  }
  for (const name of Object.keys(variables)) {
    const risky = RISKY.some((pattern) => pattern.test(name)) && !allowed.includes(name);
    if (!NAME.test(name) || OWN.has(name) || NEVER.some((pattern) => pattern.test(name)) || risky) {
      throw new Error(`a server may not be given the variable ${name}`);
    }
    env[name] = checkedValue(name, variables[name]);
  }
  return {
    ...env,
    HOME: home,
    TMPDIR: temporaryFolder(home),
    PATH: [...new Set([...path, ...SYSTEM_PATH])].join(':'),
    LANG: 'C.UTF-8',
  };
}

function checkedValue(name: string, value: string | undefined): string {
  if (value === undefined || value.includes('\0')) {
    throw new Error(`the variable ${name} has no value a program can take`);
  }
  return value;
}
