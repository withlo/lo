/**
 * Reading a clone's objects through one long-lived `git cat-file --batch-command`, which answers
 * one request after another without starting a git for each. Like every git but a fetch, it runs
 * with lazy fetching off, so an object the clone lacks is missing, never a download: it never
 * needs the token, and nothing restarts it when the token is renewed.
 */

import type { Readable } from 'node:stream';

import { GitError } from './errors.ts';
import type { GitCommand } from './git.ts';
import { type Oid, parseOid } from './oid.ts';
import { type Child, OUTPUT_LIMIT } from './spawn.ts';

/** What an object is, from its header. */
export interface ObjectInfo {
  readonly oid: Oid;
  /** `blob`, `tree`, `commit` or `tag`. */
  readonly type: string;
  readonly size: number;
}

/** An object read whole. */
export interface GitObject extends ObjectInfo {
  readonly data: Buffer;
}

/** The names the reader asks for: an object ID, or the tree a commit names. */
const NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})(?:\^\{tree\})?$/;

/** The reader's process stopped answering: it exited, and `stderr` may say why. */
class Died extends Error {
  readonly stderr: string;

  constructor(stderr: string) {
    super('git cat-file stopped answering');
    this.stderr = stderr;
  }
}

/** A clone's object reader. It starts on the first request, and one request runs at a time. */
export class ObjectReader {
  readonly #command: () => GitCommand;
  #running: Running | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;

  /** A reader that starts `command()`, a `git cat-file --batch-command` on the clone. */
  constructor(command: () => GitCommand) {
    this.#command = command;
  }

  /** What object `name` is, or `undefined` when the clone lacks it. */
  info(name: string): Promise<ObjectInfo | undefined> {
    return this.#request(name, async (running) => {
      running.send(`info ${name}\n`);
      return parseHeader(await running.output.line(), name, running.display);
    });
  }

  /**
   * Object `name` with its contents, or `undefined` when the clone lacks it. One larger than
   * `maxBytes` is never read: it fails as `tooLarge`.
   */
  read(name: string, maxBytes = OUTPUT_LIMIT): Promise<GitObject | undefined> {
    return this.#request(name, async (running) => {
      running.send(`info ${name}\n`);
      const info = parseHeader(await running.output.line(), name, running.display);
      if (info === undefined) return undefined;
      if (info.size > maxBytes) {
        throw new GitError({ kind: 'tooLarge', command: running.display, limit: maxBytes });
      }
      running.send(`contents ${info.oid}\n`);
      const header = parseHeader(await running.output.line(), info.oid, running.display);
      // Gone between the two requests, as when cleanup removed the clone.
      if (header === undefined) return undefined;
      // The contents, then a line break.
      const data = await running.output.bytes(header.size + 1);
      return { ...header, data: data.subarray(0, header.size) };
    });
  }

  /** Stops the reader. Requests after this fail. */
  close(): void {
    this.#closed = true;
    this.#running?.stop();
    this.#running = undefined;
  }

  /**
   * Runs `work` with the reader, after the requests before it. A reader that died is started
   * again, and the request tried once more if it said nothing as it died. A reader whose answer
   * made no sense is stopped, since what it says next can't be trusted to follow.
   */
  #request<T>(name: string, work: (running: Running) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (!NAME.test(name)) {
        throw new GitError({ kind: 'invalid', what: 'object name', value: name });
      }
      for (let attempt = 0; ; attempt++) {
        if (this.#closed) {
          throw new GitError({
            kind: 'git',
            command: 'git cat-file --batch-command',
            message: 'the repository was closed',
          });
        }
        const running = this.#running ?? this.#start();
        try {
          return await work(running);
        } catch (error) {
          if (error instanceof GitError && error.detail.kind === 'tooLarge') throw error;
          running.stop();
          if (this.#running === running) this.#running = undefined;
          if (!(error instanceof Died)) throw error;
          if (attempt === 0 && error.stderr.trim() === '' && !this.#closed) continue;
          const message = error.stderr.trim() || 'git exited without saying why';
          throw GitError.fromGit(running.display, message);
        }
      }
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #start(): Running {
    const running = new Running(this.#command().start({ input: true }));
    this.#running = running;
    return running;
  }
}

/** A running reader: its process, and what it writes. */
class Running {
  readonly display: string;
  readonly output: Output;
  readonly #child: Child;

  constructor(child: Child) {
    this.#child = child;
    this.display = child.display;
    this.output = new Output(child.stdout, async () => {
      await child.exited.catch(() => undefined);
      return child.stderr;
    });
  }

  send(request: string): void {
    this.#child.stdin?.write(request);
  }

  stop(): void {
    this.#child.stdin?.destroy();
    this.#child.stop();
  }
}

/**
 * What the reader writes, read a line or a number of bytes at a time. Each byte is looked at once
 * when finding a line's end, and copied once when it's taken.
 */
class Output {
  readonly #stderr: () => Promise<string>;
  /** What has come in and hasn't been taken. */
  #chunks: Buffer[] = [];
  #length = 0;
  #ended = false;
  #wake: (() => void) | undefined;

  constructor(stream: Readable, stderr: () => Promise<string>) {
    this.#stderr = stderr;
    stream.on('data', (chunk: Buffer) => {
      this.#chunks.push(chunk);
      this.#length += chunk.length;
      this.#wake?.();
    });
    const end = () => {
      this.#ended = true;
      this.#wake?.();
    };
    stream.on('end', end);
    stream.on('close', end);
    stream.on('error', end);
  }

  /** The next line, without its line break. */
  async line(): Promise<Buffer> {
    // How much of what has come in is known to hold no line break.
    let scanned = 0;
    for (;;) {
      let offset = 0;
      for (const chunk of this.#chunks) {
        if (offset + chunk.length > scanned) {
          const at = chunk.indexOf(0x0a, Math.max(0, scanned - offset));
          if (at !== -1) return this.#take(offset + at + 1).subarray(0, offset + at);
        }
        offset += chunk.length;
      }
      scanned = this.#length;
      await this.#more();
    }
  }

  /** The next `count` bytes. */
  async bytes(count: number): Promise<Buffer> {
    while (this.#length < count) await this.#more();
    return this.#take(count);
  }

  /** Waits for more to come in, or fails once nothing more will. */
  async #more(): Promise<void> {
    if (this.#ended) throw new Died(await this.#stderr());
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    this.#wake = undefined;
  }

  /** Takes the first `count` bytes of what has come in. */
  #take(count: number): Buffer {
    const taken: Buffer[] = [];
    let left = count;
    while (left > 0) {
      const chunk = this.#chunks[0];
      if (chunk === undefined) break;
      if (chunk.length <= left) {
        taken.push(chunk);
        this.#chunks.shift();
        left -= chunk.length;
      } else {
        taken.push(chunk.subarray(0, left));
        this.#chunks[0] = chunk.subarray(left);
        left = 0;
      }
    }
    this.#length -= count;
    return taken.length === 1 && taken[0] !== undefined ? taken[0] : Buffer.concat(taken);
  }
}

/**
 * Reads the header the reader answers `name` with: `<oid> <type> <size>`, or `<name> missing`
 * for an object the clone lacks.
 */
function parseHeader(line: Buffer, name: string, display: string): ObjectInfo | undefined {
  const text = line.toString('latin1');
  if (text === `${name} missing`) return undefined;
  const [oid = '', type = '', size = '', ...rest] = text.split(' ');
  if (rest.length > 0 || !/^[a-z]+$/.test(type) || !/^\d+$/.test(size)) {
    throw new GitError({
      kind: 'git',
      command: display,
      message: `printed an unexpected answer ${JSON.stringify(text)}`,
    });
  }
  return { oid: parseOid(oid), type, size: Number(size) };
}
