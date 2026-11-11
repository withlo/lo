/**
 * Running the user's git, in the repository the checker runs in. Commits and paths never go on its
 * command line: they go on its input, where nothing can read them as an option. Git never reaches
 * the network, so an object the repository lacks stays missing, and nothing asks for a password.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/** Git couldn't be run, or failed, and why, in words. */
export class GitError extends Error {
  override name = 'GitError';
}

/** Git couldn't be started at all. */
export class NoGit extends GitError {
  override name = 'NoGit';
}

/**
 * The environment git runs in: the user's, with the network closed. A partial clone fetches an
 * object it lacks when it's read; neither line lets it, the second for a git too old for the first.
 */
export function gitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_NO_LAZY_FETCH: '1',
    // Every protocol is refused, since none is listed.
    GIT_ALLOW_PROTOCOL: 'none',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
  };
}

/** The most bytes of output a command's answer may have, past which it's refused. */
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** How to run git: where, and in which environment. */
export interface Git {
  /** The folder git runs in, which sets the repository. */
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Git in `cwd`, as the user has it, with the network closed. */
export function gitIn(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Git {
  return { cwd, env: gitEnvironment(env) };
}

/** Starts git with `args`, which hold neither a commit nor a path. */
function start(git: Git, args: readonly string[]): ChildProcess {
  return spawn('git', args, { cwd: git.cwd, env: git.env, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Why git didn't start, in words. */
function startFailure(error: unknown): GitError {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return new NoGit(
    code === 'ENOENT'
      ? "Git isn't installed, or isn't on your PATH."
      : `Git didn't start: ${error instanceof Error ? error.message : String(error)}.`,
  );
}

/**
 * Runs git with `args`, giving it `input`, and returns what it writes. Rejects with git's own
 * words when it fails.
 */
export function run(git: Git, args: readonly string[], input?: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = start(git, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let length = 0;
    child.stdout?.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > OUTPUT_LIMIT) child.kill();
      else out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => reject(startFailure(error)));
    child.on('close', (code) => {
      if (length > OUTPUT_LIMIT) {
        reject(new GitError(`git ${args[0] ?? ''} wrote more than Lo reads.`));
      } else if (code === 0) {
        resolve(Buffer.concat(out));
      } else {
        const said = Buffer.concat(err).toString('utf8').trim();
        reject(new GitError(said || `git ${args[0] ?? ''} failed without saying why.`));
      }
    });
    // A git that exits before reading it all closes its input early: that's its exit to report.
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

/** An object's name: its full id, in hexadecimal, as a SHA-1 or SHA-256 repository writes it. */
const ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function isId(name: string): boolean {
  return ID.test(name);
}

/** What `git cat-file` says an object is. */
export interface ObjectInfo {
  id: string;
  type: string;
  size: number;
}

/**
 * One long-running `git cat-file --batch` or `--batch-check`, answering one object at a time: what
 * it is, and with `--batch`, its contents. It's asked for objects by id only, perhaps with a
 * suffix of this module's own, so nothing the overview says reaches git as a name.
 */
export class Objects {
  readonly #git: Git;
  readonly #mode: '--batch' | '--batch-check';
  #child: ChildProcess | undefined;
  #output: Output | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  constructor(git: Git, mode: '--batch' | '--batch-check') {
    this.#git = git;
    this.#mode = mode;
  }

  /**
   * What the object `id` is, peeled to a commit when `suffix` says so, and its contents when this
   * reads them; or undefined when the repository has no such object. An object larger than `limit`
   * is refused, never read.
   */
  ask(
    id: string,
    suffix: '' | '^{commit}' = '',
    limit = OUTPUT_LIMIT,
  ): Promise<(ObjectInfo & { data?: Buffer }) | undefined> {
    const work = async () => {
      if (!isId(id)) throw new GitError(`${JSON.stringify(id)} isn't an object's id.`);
      try {
        const output = this.#running();
        this.#child?.stdin?.write(`${id}${suffix}\n`);
        const info = parseHeader((await output.line()).toString('utf8'));
        if (!info) return undefined;
        if (this.#mode === '--batch-check') return info;
        // Its contents would be on their way, and can't be skipped.
        if (info.size > limit) {
          throw new GitError(`An object of ${info.size} bytes is larger than Lo reads.`);
        }
        const data = await output.bytes(info.size + 1);
        return { ...info, data: data.subarray(0, info.size) };
      } catch (error) {
        // What git writes next can't be trusted to follow: the next object is asked of another.
        this.#stop();
        throw error;
      }
    };
    const result = this.#queue.then(work, work);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  /** Stops git. Asking after this fails. */
  close(): void {
    this.#closed = true;
    this.#stop();
  }

  #stop(): void {
    this.#child?.stdin?.destroy();
    this.#child?.kill();
    this.#child = undefined;
    this.#output = undefined;
  }

  #running(): Output {
    if (this.#closed) throw new GitError('The repository was closed.');
    if (this.#output) return this.#output;
    const child = start(this.#git, ['cat-file', this.#mode]);
    const err: Buffer[] = [];
    let failed: GitError | undefined;
    const closed = new Promise<void>((resolve) => {
      child.on('close', () => resolve());
      child.on('error', (error) => {
        failed = startFailure(error);
        resolve();
      });
    });
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
    child.stdin?.on('error', () => {});
    this.#child = child;
    this.#output = new Output(child.stdout!, async () => {
      await closed;
      const said = Buffer.concat(err).toString('utf8').trim();
      return failed ?? new GitError(said || 'git cat-file stopped without saying why.');
    });
    return this.#output;
  }
}

/** An object's header from `cat-file`, or undefined when it says the object is missing. */
function parseHeader(line: string): ObjectInfo | undefined {
  const [id = '', type = '', size = ''] = line.split(' ');
  if (type === 'missing' || type === 'ambiguous') return undefined;
  if (!isId(id) || !/^\d{1,15}$/.test(size)) {
    throw new GitError(`git cat-file answered ${JSON.stringify(line.slice(0, 80))}.`);
  }
  return { id, type, size: Number(size) };
}

/** What a process writes, read a line or a number of bytes at a time. */
class Output {
  readonly #failure: () => Promise<GitError>;
  #chunks: Buffer[] = [];
  #length = 0;
  #ended = false;
  #wake: (() => void) | undefined;

  constructor(stream: Readable, failure: () => Promise<GitError>) {
    this.#failure = failure;
    stream.on('data', (chunk: Buffer) => {
      this.#chunks.push(chunk);
      this.#length += chunk.length;
      this.#wake?.();
    });
    const end = (): void => {
      this.#ended = true;
      this.#wake?.();
    };
    stream.on('end', end);
    stream.on('close', end);
    stream.on('error', end);
  }

  /** The next line, without its line break. */
  async line(): Promise<Buffer> {
    for (;;) {
      const joined = this.#joined();
      const at = joined.indexOf(0x0a);
      if (at !== -1) return this.#take(at + 1).subarray(0, at);
      await this.#more();
    }
  }

  /** The next `count` bytes. */
  async bytes(count: number): Promise<Buffer> {
    while (this.#length < count) await this.#more();
    return this.#take(count);
  }

  #joined(): Buffer {
    if (this.#chunks.length > 1) this.#chunks = [Buffer.concat(this.#chunks)];
    return this.#chunks[0] ?? Buffer.alloc(0);
  }

  #take(count: number): Buffer {
    const joined = this.#joined();
    const taken = Buffer.from(joined.subarray(0, count));
    const rest = joined.subarray(count);
    this.#chunks = rest.length > 0 ? [rest] : [];
    this.#length -= count;
    return taken;
  }

  async #more(): Promise<void> {
    // Once git has exited, and said why.
    if (this.#ended) throw await this.#failure();
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    this.#wake = undefined;
  }
}
