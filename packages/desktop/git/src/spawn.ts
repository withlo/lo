/**
 * Starting git, and anything else this package runs, as a child process of its own.
 *
 * - Every child gets the environment it's given and nothing else: never the parent's, which holds
 *   tokens and settings git would read, and never an empty one, which some launchers take to mean
 *   "inherit everything".
 * - Every child leads a process group of its own, so stopping it stops what it started too, such
 *   as the `git-remote-https` a fetch waits on, and a terminal's Ctrl-C, which goes to the
 *   terminal's foreground group, never reaches it.
 * - Its pipes are made for it alone. Node starts children with `posix_spawn` and
 *   `POSIX_SPAWN_CLOEXEC_DEFAULT` on macOS, and with pipes marked close-on-exec as they're made on
 *   Linux, so a long-lived child, such as a clone's `cat-file --batch`, never holds an end of
 *   another child's pipe and keeps whoever reads it waiting.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

import { GitError } from './errors.ts';

/** How a child ended: its exit code, or the signal that stopped it. */
export interface Exit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** A finished child whose exit status the caller interprets. */
export interface Finished extends Exit {
  readonly stdout: Buffer;
  /** The end of what it wrote to stderr: about {@link STDERR_KEPT} characters at most. */
  readonly stderr: string;
}

/**
 * The most output a command may write unless it says otherwise: far more than any listing or file
 * Lo reads, and little enough that a command can't take all of the app's memory.
 */
export const OUTPUT_LIMIT = 256 * 1024 * 1024;

/** How much of a child's stderr is kept: the end, which says why it stopped. */
export const STDERR_KEPT = 64 * 1024;

export interface StartOptions {
  readonly args: readonly string[];
  /** The child's whole environment. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** Whether the child reads input: its stdin is a pipe, else it reads nothing. */
  readonly input: boolean;
  /** What logs and errors call the child, such as `git cat-file --batch`. Never its environment. */
  readonly display: string;
}

/** A running child, in a process group of its own. */
export class Child {
  readonly display: string;
  /** The child's stdin, when it was started to read input. */
  readonly stdin: Writable | undefined;
  readonly stdout: Readable;
  /** Resolves once the child has exited and its output has ended. Rejects if it couldn't start. */
  readonly exited: Promise<Exit>;
  readonly #child: ChildProcess;
  #stderr = '';
  #inputError: Error | undefined;

  constructor(program: string, options: StartOptions) {
    if (Object.keys(options.env).length === 0) {
      throw new Error('a child process needs an environment of its own');
    }
    this.display = options.display;
    let child: ChildProcess;
    try {
      child = spawn(program, options.args, {
        env: { ...options.env },
        cwd: options.cwd,
        detached: true,
        stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      throw GitError.io(`running ${this.display}`, error);
    }
    this.#child = child;
    this.stdin = child.stdin ?? undefined;
    // git may exit without reading all of its input, so a broken pipe isn't an error: its exit
    // status already says what happened.
    this.stdin?.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') {
        this.#inputError ??= error;
      }
    });
    const { stdout, stderr } = child;
    if (stdout === null || stderr === null) throw new Error('the child has no output pipes');
    this.stdout = stdout;
    stderr.setEncoding('utf8');
    stderr.on('data', (text: string) => {
      this.#stderr += text;
      // Keep the end, which says why the child stopped.
      if (this.#stderr.length > STDERR_KEPT) this.#stderr = this.#stderr.slice(-STDERR_KEPT / 2);
    });
    this.exited = new Promise<Exit>((resolve, reject) => {
      child.once('error', (error) => {
        // The child never started.
        if (child.pid === undefined) reject(GitError.io(`running ${this.display}`, error));
      });
      child.once('close', (code, signal) => {
        if (this.#inputError) {
          reject(GitError.io(`writing to ${this.display}`, this.#inputError));
        } else {
          resolve({ code, signal });
        }
      });
    });
    // Whoever started the child hears of a failure when it waits for it; until then, it's no
    // unhandled rejection.
    this.exited.catch(() => undefined);
  }

  /** The child's process ID, which is also its process group's. */
  get pid(): number | undefined {
    return this.#child.pid;
  }

  /** The program and arguments the child was started with. */
  get spawnargs(): readonly string[] {
    return this.#child.spawnargs;
  }

  /** What the child has written to stderr so far, or its end. */
  get stderr(): string {
    return this.#stderr;
  }

  /**
   * Sends `signal` to the child and every process in its group. It never throws: a group that's
   * gone has nothing left to stop.
   */
  stop(signal: NodeJS.Signals = 'SIGKILL'): void {
    const { pid } = this.#child;
    if (pid === undefined) return;
    try {
      process.kill(-pid, signal);
    } catch {
      // The group is gone.
    }
  }

  /**
   * Writes `input` to the child's stdin and ends it, while its output is read, and waits for it to
   * finish. A command that answers each line as it reads it, such as `cat-file --batch-check`,
   * would otherwise fill its output pipe and stop reading. Past `maxBytes` of output, it stops
   * the child and fails as `tooLarge`.
   */
  async finish(
    input?: Uint8Array | string,
    options: { signal?: AbortSignal | undefined; maxBytes?: number | undefined } = {},
  ): Promise<Finished> {
    const { signal, maxBytes = OUTPUT_LIMIT } = options;
    const chunks: Buffer[] = [];
    let length = 0;
    let tooLarge = false;
    this.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > maxBytes) {
        tooLarge = true;
        this.stop();
        return;
      }
      chunks.push(chunk);
    });
    const stop = () => this.stop();
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    try {
      this.stdin?.end(input);
      const exit = await this.exited;
      if (tooLarge) {
        throw new GitError({ kind: 'tooLarge', command: this.display, limit: maxBytes });
      }
      return { ...exit, stdout: Buffer.concat(chunks), stderr: this.#stderr };
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }
}
