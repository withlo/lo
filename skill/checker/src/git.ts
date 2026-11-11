/**
 * Running the user's git, in the repository the checker runs in. Git is found on `PATH` by an
 * absolute path, never in the folder it runs in, which may be a pull request's checkout. Commits and
 * paths never go on its command line: they go on its input, where nothing can read them as an
 * option. Git never reaches the network, so an object the repository lacks stays missing, and
 * nothing asks for a password.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { Readable } from 'node:stream';

/** Git couldn't be run, or failed, and why, in words. */
export class GitError extends Error {
  override name = 'GitError';
}

/** Git couldn't be found, or started at all. */
export class NoGit extends GitError {
  override name = 'NoGit';
}

/** Reading an object would take git past the most it may write in one run. */
export class TooMuch extends GitError {
  override name = 'TooMuch';
}

/**
 * The environment git runs in: the user's, with the network closed. A partial clone fetches an
 * object it lacks when it's read; neither of the first two lines lets it, the second for a git too
 * old for the first. On Windows, the last keeps git from running programs in the folder it's in.
 */
export function gitEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    GIT_NO_LAZY_FETCH: '1',
    // Every protocol is refused, since none is listed.
    GIT_ALLOW_PROTOCOL: 'none',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    NoDefaultCurrentDirectoryInExePath: '1',
  };
}

/** Whether `path` is a program to run: a file, and where files are marked so, executable. */
function isProgram(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!windows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where git is: the first `git`, or on Windows `git.exe`, in a folder that `env`'s `PATH` names by
 * an absolute path. An empty or relative entry names the folder git would run in, which may be a
 * pull request's checkout holding a `git` of its own, so it's skipped.
 */
export function findGit(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  found: (path: string) => boolean = (path) => isProgram(path, platform === 'win32'),
): string | undefined {
  const windows = platform === 'win32';
  const paths = windows ? win32 : posix;
  // Windows writes it Path, and compares names without case.
  const name = Object.keys(env).find((key) => (windows ? key.toUpperCase() : key) === 'PATH');
  const value = name === undefined ? undefined : env[name];
  for (const entry of (value ?? '').split(paths.delimiter)) {
    const folder = windows ? entry.replace(/^"(.*)"$/, '$1') : entry;
    if (folder === '' || !paths.isAbsolute(folder)) continue;
    const program = paths.join(folder, windows ? 'git.exe' : 'git');
    if (found(program)) return program;
  }
  return undefined;
}

/** The most bytes of output a command's answer may have, past which it's refused. */
const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** How to run git: which program, where, and in which environment. */
export interface Git {
  /** Git's absolute path. */
  program: string;
  /** The folder git runs in, which sets the repository. */
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Git in `cwd`, as the user has it, with the network closed. Throws when there's no git. */
export function gitIn(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Git {
  const program = findGit(env);
  if (program === undefined) throw new NoGit("Git isn't installed, or isn't on your PATH.");
  return { program, cwd, env: gitEnvironment(env) };
}

/** Starts git with `args`, which hold neither a commit nor a path. */
function start(git: Git, args: readonly string[]): ChildProcess {
  return spawn(git.program, args, {
    cwd: git.cwd,
    env: git.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Why git didn't start, in words. */
function startFailure(error: unknown): GitError {
  return new NoGit(`Git didn't start: ${error instanceof Error ? error.message : String(error)}.`);
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
 * A repository's objects, asked for by id only, so nothing the overview says reaches git as a
 * name. One long-running `git cat-file --batch-check` says what each object is and its size, and
 * one `git cat-file --batch` writes objects whole. Only the bytes asked for are kept of what it
 * writes, and it may write at most `limit` bytes in all: past that, reading fails.
 */
export class Objects {
  readonly #sizes: Batch;
  readonly #contents: Batch;
  readonly #limit: number;
  #streamed = 0;

  constructor(git: Git, limit: number) {
    this.#sizes = new Batch(git, '--batch-check');
    this.#contents = new Batch(git, '--batch');
    this.#limit = limit;
  }

  /** How many bytes of objects git has written so far. */
  get streamed(): number {
    return this.#streamed;
  }

  /** What the object `id` is, or undefined when the repository has no such object. */
  info(id: string): Promise<ObjectInfo | undefined> {
    return this.#sizes.ask(id, async (output) => parseHeader(await output.line()));
  }

  /**
   * The first `keep` bytes of the object `info` describes, as a copy of their own. Git writes it
   * whole, and the rest is let go of as it comes. An object that would take git past its limit
   * isn't asked for at all.
   */
  read(info: ObjectInfo, keep: number): Promise<Uint8Array> {
    return this.#contents.ask(
      info.id,
      (output) => readObject(output, info, keep),
      () => {
        if (this.#streamed + info.size > this.#limit) {
          throw new TooMuch(
            `Checking the overview would read more than ${mebibytes(this.#limit)} from git, the most the checker reads for one overview. Name fewer large files.`,
          );
        }
        this.#streamed += info.size;
      },
    );
  }

  /** Stops git. Asking after this fails. */
  close(): void {
    this.#sizes.close();
    this.#contents.close();
  }
}

/** Reads the object `info` describes from `output`, keeping its first `keep` bytes. */
async function readObject(output: Output, info: ObjectInfo, keep: number): Promise<Uint8Array> {
  const header = parseHeader(await output.line());
  if (header?.id !== info.id || header.type !== info.type || header.size !== info.size) {
    throw new GitError(`git cat-file answered for ${info.id} with another object.`);
  }
  const kept = Math.min(keep, info.size);
  const bytes = await output.take(kept);
  // The rest, and the line break after it.
  await output.skip(info.size - kept + 1);
  return bytes;
}

function mebibytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/**
 * One long-running `git cat-file`, answering one request at a time. A request whose answer goes
 * wrong stops it, since what it writes next can't be trusted to follow, and the next request starts
 * another.
 */
class Batch {
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
   * Asks for the object `id`, and reads the answer with `answer`. `before` runs first, and when it
   * throws, nothing is asked.
   */
  ask<T>(id: string, answer: (output: Output) => Promise<T>, before?: () => void): Promise<T> {
    const work = async (): Promise<T> => {
      if (!isId(id)) throw new GitError(`${JSON.stringify(id)} isn't an object's id.`);
      before?.();
      try {
        const output = this.#running();
        this.#child?.stdin?.write(`${id}\n`);
        return await answer(output);
      } catch (error) {
        this.#stop();
        throw error;
      }
    };
    const result = this.#queue.then(work, work);
    this.#queue = result.catch(() => undefined);
    return result;
  }

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
function parseHeader(line: Uint8Array): ObjectInfo | undefined {
  const text = Buffer.from(line).toString('latin1');
  const [id = '', type = '', size = ''] = text.split(' ');
  if (type === 'missing' || type === 'ambiguous') return undefined;
  if (!isId(id) || !/^\d{1,15}$/.test(size)) {
    throw new GitError(`git cat-file answered ${JSON.stringify(text.slice(0, 80))}.`);
  }
  return { id, type, size: Number(size) };
}

/** The longest line `cat-file` writes: a header. */
const LINE_LIMIT = 4096;

/**
 * What a process writes, read a line or a number of bytes at a time. Bytes being skipped are let
 * go of as they arrive, so skipping a large object holds none of it.
 */
class Output {
  readonly #failure: () => Promise<GitError>;
  #chunks: Buffer[] = [];
  #length = 0;
  #skipping = 0;
  #ended = false;
  #wake: (() => void) | undefined;

  constructor(stream: Readable, failure: () => Promise<GitError>) {
    this.#failure = failure;
    stream.on('data', (chunk: Buffer) => {
      let rest = chunk;
      if (this.#skipping > 0) {
        const dropped = Math.min(this.#skipping, rest.length);
        this.#skipping -= dropped;
        rest = rest.subarray(dropped);
      }
      if (rest.length > 0) {
        this.#chunks.push(rest);
        this.#length += rest.length;
      }
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
  async line(): Promise<Uint8Array> {
    for (;;) {
      let seen = 0;
      for (const chunk of this.#chunks) {
        const at = chunk.indexOf(0x0a);
        if (at !== -1) {
          const line = await this.take(seen + at + 1);
          return line.subarray(0, line.length - 1);
        }
        seen += chunk.length;
      }
      if (seen > LINE_LIMIT) throw new GitError('git cat-file answered with too long a line.');
      await this.#more();
    }
  }

  /** The next `count` bytes, as a copy of their own. */
  async take(count: number): Promise<Uint8Array> {
    while (this.#length < count) await this.#more();
    const taken = new Uint8Array(count);
    let at = 0;
    while (at < count) {
      const chunk = this.#chunks[0]!;
      const used = Math.min(chunk.length, count - at);
      taken.set(chunk.subarray(0, used), at);
      at += used;
      if (used === chunk.length) this.#chunks.shift();
      else this.#chunks[0] = chunk.subarray(used);
    }
    this.#length -= count;
    return taken;
  }

  /** Lets the next `count` bytes go, holding none of them. */
  async skip(count: number): Promise<void> {
    let left = count;
    while (left > 0 && this.#chunks.length > 0) {
      const chunk = this.#chunks[0]!;
      const used = Math.min(chunk.length, left);
      if (used === chunk.length) this.#chunks.shift();
      else this.#chunks[0] = chunk.subarray(used);
      this.#length -= used;
      left -= used;
    }
    this.#skipping = left;
    while (this.#skipping > 0) await this.#more();
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
