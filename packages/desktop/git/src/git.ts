/** Running git: commands on a repository, in the environment `environment.ts` describes. */

import { GitError } from './errors.ts';
import {
  configArguments,
  gitEnvironment,
  GITHUB,
  type Folders,
  parseRemote,
  type Remote,
} from './environment.ts';
import { streamRecords } from './records.ts';
import { Child, type Finished, OUTPUT_LIMIT } from './spawn.ts';
import type { Token } from './token.ts';
import { formatVersion, type GitVersion } from './version.ts';

/** The git Lo runs: one found new enough, and the variables it keeps from Lo's environment. */
export class Git {
  readonly program: string;
  readonly version: GitVersion;
  /** The variables every git takes from Lo's environment: no secrets, and no proxies. */
  readonly inherited: Readonly<Record<string, string>>;

  constructor(program: string, version: GitVersion, inherited: Readonly<Record<string, string>>) {
    this.program = program;
    this.version = version;
    this.inherited = { ...inherited };
  }

  toString(): string {
    return `git ${formatVersion(this.version)} at ${this.program}`;
  }
}

/** The repository a command works on: a bare clone, a checkout of one, or none at all. */
export type Location = { readonly gitDir: string; readonly workTree?: string } | 'none';

/** What a fetch signs in with, and how it reaches the remote. */
export interface Fetching {
  /** The token git signs in to the remote with, and gives no one else. */
  readonly token?: Token | undefined;
  /**
   * The proxy to reach the remote through, as curl takes it, such as `http://proxy:3128`: the
   * route Lo's own requests to GitHub take.
   */
  readonly proxy?: string | undefined;
}

/**
 * What a build run from source allows its tests, and nothing else ever does: main sets it only
 * when the app isn't packaged.
 */
export interface TestSettings {
  /**
   * Where fetches go instead of GitHub: a server on this machine, over `https:` or `http:`, or a
   * `file:` folder of repositories.
   */
  readonly remote?: string | undefined;
  /** More `name=value` settings for every git, after Lo's own, so they win. */
  readonly config?: readonly string[] | undefined;
}

export interface RunnerSettings extends Folders {
  /** Gets a line for each git that fails. Lines carry the command, never its environment. */
  readonly log?: ((line: string) => void) | undefined;
  /** What only tests may change. Without it, git fetches from GitHub with Lo's settings alone. */
  readonly test?: TestSettings | undefined;
}

/**
 * The variables a command may set for itself: where git writes its trace, and how much of it.
 * Every other variable is Lo's to set or drop, since each could turn a guard off.
 */
export const COMMAND_VARIABLES = ['GIT_TRACE2_EVENT', 'GIT_TRACE2_EVENT_BRIEF'] as const;

/** Runs git commands for one cache: in its home folder, under its ceiling, against its remote. */
export class Runner {
  readonly git: Git;
  readonly remote: Remote;
  readonly #settings: RunnerSettings;

  constructor(git: Git, settings: RunnerSettings) {
    this.git = git;
    const { test } = settings;
    this.remote = parseRemote(test?.remote ?? GITHUB, { test: test !== undefined });
    this.#settings = settings;
  }

  /**
   * A git command on the repository at `location`, which git is always told, so it never looks
   * for one. With `fetching`, git may download from the remote and signs in to it with the token,
   * and only then.
   */
  command(location: Location, options: { fetching?: Fetching } = {}): GitCommand {
    return new GitCommand(this.git, this.#settings, this.remote, location, options.fetching);
  }
}

export interface RunOptions {
  /** For a fetch: what it fetches, such as "pull request #12", which its errors name. */
  readonly what?: string | undefined;
  /** Stops git, and everything it started, when it's aborted. */
  readonly signal?: AbortSignal | undefined;
  /**
   * The most output git may write, past which Lo stops it and fails as `tooLarge`:
   * {@link OUTPUT_LIMIT} unless it says otherwise.
   */
  readonly maxBytes?: number | undefined;
}

/**
 * A git command being built. It remembers its arguments for logs and errors, which never show its
 * environment, so they never show the token.
 */
export class GitCommand {
  readonly #git: Git;
  readonly #settings: RunnerSettings;
  readonly #remote: Remote;
  readonly #location: Location;
  readonly #fetching: Fetching | undefined;
  readonly #args: string[] = [];
  readonly #shown: string[] = [];
  readonly #env: Record<string, string> = {};

  constructor(
    git: Git,
    settings: RunnerSettings,
    remote: Remote,
    location: Location,
    fetching: Fetching | undefined,
  ) {
    this.#git = git;
    this.#settings = settings;
    this.#remote = remote;
    this.#location = location;
    this.#fetching = fetching;
  }

  /** Adds arguments, which logs and errors show. */
  arg(...args: string[]): this {
    this.#args.push(...args);
    this.#shown.push(...args);
    return this;
  }

  /**
   * Adds folders of Lo's own, such as a new clone's. Logs and errors count them rather than name
   * them. A repository's paths never go in arguments: git reads them from its input.
   */
  path(...paths: string[]): this {
    this.#args.push(...paths);
    this.#shown.push(paths.length === 1 ? '<path>' : `<${paths.length} paths>`);
    return this;
  }

  /**
   * Sets one of {@link COMMAND_VARIABLES} for this git alone, such as where git writes its trace.
   * Logs and errors never show it.
   */
  env(name: string, value: string): this {
    if (!(COMMAND_VARIABLES as readonly string[]).includes(name)) {
      throw new Error(`${name} isn't a variable a git command may set`);
    }
    this.#env[name] = value;
    return this;
  }

  /** The command as logs and errors show it: `git` and the arguments added to it. */
  get display(): string {
    return ['git', ...this.#shown].join(' ');
  }

  /** Starts the command. The caller reads its output and waits for it, or stops it. */
  start(options: { input?: boolean } = {}): Child {
    const location = this.#location;
    const repo =
      location === 'none'
        ? []
        : [
            `--git-dir=${location.gitDir}`,
            ...(location.workTree === undefined ? [] : [`--work-tree=${location.workTree}`]),
          ];
    const fetching = this.#fetching;
    // A token that can't be given to git safely isn't given at all: git signs in as nobody.
    const token = fetching?.token?.usable ? fetching.token : undefined;
    const config = (this.#settings.test?.config ?? []).flatMap((setting) => ['-c', setting]);
    const env = gitEnvironment(
      this.#git.inherited,
      this.#settings,
      this.#remote,
      fetching === undefined ? undefined : { token: token?.expose(), proxy: fetching.proxy },
    );
    const workTree = location === 'none' ? undefined : location.workTree;
    return new Child(this.#git.program, {
      args: [
        ...repo,
        ...configArguments(this.#remote, token !== undefined),
        ...config,
        ...this.#args,
      ],
      env: { ...this.#env, ...env },
      cwd: workTree ?? this.#settings.home,
      input: options.input ?? false,
      display: this.display,
    });
  }

  /** Runs the command with `input` on its stdin, and returns how it went, whatever its exit status. */
  async finish(input?: Uint8Array | string, options: RunOptions = {}): Promise<Finished> {
    const started = Date.now();
    const child = this.start({ input: input !== undefined });
    const finished = await child.finish(input, options);
    if (finished.code !== 0) {
      const status = finished.code ?? String(finished.signal);
      this.#settings.log?.(
        `${this.display} exited with ${status} after ${Date.now() - started} ms`,
      );
    }
    return finished;
  }

  /** Runs the command and returns its output, or an error with git's message. */
  async run(input?: Uint8Array | string, options: RunOptions = {}): Promise<Buffer> {
    const finished = await this.finish(input, options);
    if (options.signal?.aborted) throw options.signal.reason;
    if (finished.code !== 0) {
      throw GitError.fromGit(this.display, failureMessage(finished), options.what);
    }
    return finished.stdout;
  }

  /**
   * Runs the command and yields each record of its `-z` output as it comes. Fails, after the last
   * record, if git did; stops git if the caller stops reading.
   */
  async *records(input?: Uint8Array | string, options: RunOptions = {}): AsyncGenerator<Buffer> {
    const child = this.start({ input: input !== undefined });
    const stop = () => child.stop();
    options.signal?.addEventListener('abort', stop, { once: true });
    let done = false;
    try {
      child.stdin?.end(input);
      yield* streamRecords(limited(child.stdout, options.maxBytes ?? OUTPUT_LIMIT, this.display));
      const exit = await child.exited;
      done = true;
      if (options.signal?.aborted) throw options.signal.reason;
      if (exit.code !== 0) {
        const message = failureMessage({ ...exit, stderr: child.stderr });
        throw GitError.fromGit(this.display, message, options.what);
      }
    } finally {
      options.signal?.removeEventListener('abort', stop);
      if (!done) {
        child.stop();
        await child.exited.catch(() => undefined);
      }
    }
  }
}

/** `chunks`, failing as `tooLarge` once they add up to more than `limit` bytes. */
async function* limited(
  chunks: AsyncIterable<Uint8Array>,
  limit: number,
  command: string,
): AsyncGenerator<Uint8Array> {
  let length = 0;
  for await (const chunk of chunks) {
    length += chunk.byteLength;
    if (length > limit) throw new GitError({ kind: 'tooLarge', command, limit });
    yield chunk;
  }
}

/** What to say when git fails: its message, or how it ended when it said nothing. */
export function failureMessage(finished: Pick<Finished, 'code' | 'signal' | 'stderr'>): string {
  const stderr = finished.stderr.trim();
  if (stderr !== '') return stderr;
  return finished.code === null
    ? `git was stopped by ${finished.signal}`
    : `git exited with ${finished.code}`;
}
