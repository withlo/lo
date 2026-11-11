/**
 * Running a fetch under watch: saying what it's doing, for the app, and stopping it, with every
 * process it started, when it waits too long or brings too much.
 *
 * What a fetch is doing comes from two places:
 *
 * - git's progress lines: GitHub's own, prefixed `remote: `, while it prepares what to send, then
 *   git's "Receiving objects" and "Resolving deltas". Until the objects come in, the fetch has a
 *   time limit. From then on, git writes a line only when it gets further, so the fetch may take
 *   as long as it needs while lines keep coming.
 * - git's trace2 events, written to a file of the fetch's own, which say when GitHub first answers
 *   (`negotiated-version`): the end of connecting. They hold the commands git runs, never the
 *   token, which only a variable holds.
 * - The pack git writes as it comes in, `objects/pack/tmp_pack_*`, which grows as the bytes
 *   arrive. git says how many bytes have come in only once the first object has, which may be
 *   all of a large file, so the pack's size is what the limits on size and stalling go by too.
 *
 * git runs in a process group of its own, so stopping it stops what it started too:
 * `git-remote-https`, which waits on the network, and `index-pack`. Each is asked to stop, then
 * killed, before the fetch returns, however it returns. When git exits by itself, whatever it left
 * in its group is killed too, since a `git-remote-https` still waiting would hold git's output
 * open.
 */

import { open, readdir, rm, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import { type FetchFailure, GitError } from './errors.ts';
import type { GitCommand } from './git.ts';
import { type FetchLimits, formatDuration, startLimit } from './limits.ts';
import {
  type Activity,
  describeProgress,
  parseProgressLine,
  type Progress,
  type ProgressSource,
} from './progress.ts';
import type { Child, Exit } from './spawn.ts';

/** How often the watch checks the limits and git's trace, in milliseconds. */
const POLL = 50;

/** How often the progress function hears what the fetch is doing, when nothing changes. */
export const TELL_EVERY = 1000;

/** How long git has to stop by itself, once asked to, before it's killed. */
export const STOP_GRACE = 1000;

/**
 * Which limit a stopped fetch ran out: GitHub didn't answer in time (`connect`), no objects came
 * in in time (`start`), once objects came in git got no further for too long (`stall`), or more
 * came in than the fetch may bring (`size`).
 */
export type StopReason = 'connect' | 'start' | 'stall' | 'size';

/** A fetch Lo stopped, and why. */
export interface Stopped {
  readonly reason: StopReason;
  /** The limit that ran out: milliseconds, or bytes for `size`. */
  readonly limit: number;
  /** What it was doing, such as "GitHub was still preparing what to send (counting objects, 45% of 1234)". */
  readonly doing: string;
  /** The ID of the git process Lo stopped, which some of the files it leaves name. */
  readonly pid: number;
}

/** A size in megabytes, as Lo writes it in messages. */
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/**
 * The error for fetching `what`, stopped: a network failure when GitHub never answered,
 * `timedOut` when GitHub took too long to start sending or the fetch then got no further for too
 * long, saying which and what it was doing then, and `tooLarge` when it brought too much.
 */
export function stoppedError(stopped: Stopped, what: string): GitError {
  const limit = formatDuration(stopped.limit);
  const { doing } = stopped;
  let failure: FetchFailure;
  let message: string;
  switch (stopped.reason) {
    case 'connect':
      failure = 'network';
      message = `GitHub didn't answer within ${limit}, so Lo stopped connecting`;
      break;
    case 'start':
      failure = 'timedOut';
      message = `GitHub took longer than ${limit} to start sending, so Lo stopped it while ${doing}`;
      break;
    case 'stall':
      failure = 'timedOut';
      message = `it got no further for ${limit}, so Lo stopped it while ${doing}`;
      break;
    case 'size':
      failure = 'tooLarge';
      message = `it's more than ${formatMegabytes(stopped.limit)}, so Lo stopped downloading it`;
      break;
    default:
      return stopped.reason satisfies never;
  }
  return new GitError({ kind: 'fetch', what, failure, message });
}

/**
 * How far a fetch has got: git started and GitHub hasn't answered yet (connecting); GitHub
 * answered, and is working out what to send and preparing it (preparing); the objects are coming
 * in (receiving); git is going through them, and then updating refs (resolving).
 */
const Stage = { Connecting: 0, Preparing: 1, Receiving: 2, Resolving: 3 } as const;
type Stage = (typeof Stage)[keyof typeof Stage];

/** What a watched fetch is doing. Times are milliseconds from `now()`. */
export class FetchState {
  readonly #started: number;
  readonly #now: () => number;
  stage: Stage = Stage.Connecting;
  /** The last progress line of the stage, if any. */
  progress: Progress | undefined;
  /** When git last got further, once the objects come in. */
  advanced: number | undefined;
  /** The most bytes git has said came in, or its pack on disk has held. */
  received = 0;
  /** The most bytes the pack git writes has held on disk. */
  #written = 0;
  /**
   * Whether git's trace has said anything, which it does as soon as git starts. Without it, Lo
   * can't tell connecting from waiting, and only the limit on starting holds.
   */
  traced = false;
  /** What the fetch did since the progress function last heard. */
  untold: Activity[] = [];

  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#started = now();
  }

  get elapsed(): number {
    return this.#now() - this.#started;
  }

  /** Takes in a progress line. Returns whether what the fetch is doing changed. */
  onProgress(source: ProgressSource, progress: Progress): boolean {
    let stage: Stage;
    if (source === 'remote') {
      // GitHub only says how it prepares a pack before sending it.
      if (this.stage > Stage.Preparing) return false;
      stage = Stage.Preparing;
    } else if (progress.stage === 'Receiving objects' || progress.stage === 'Unpacking objects') {
      // `unpack-objects` says "Unpacking objects" where `index-pack` says "Receiving".
      stage = Stage.Receiving;
    } else if (progress.stage === 'Resolving deltas') {
      stage = Stage.Resolving;
    } else {
      stage = this.stage;
    }
    if (stage > this.stage) this.stage = stage;
    // Once objects come in, git writes a line only when it gets further: when the percentage of
    // objects or deltas done changes, and once a second while objects or bytes come in.
    if (source === 'local' && this.stage >= Stage.Receiving) this.advanced = this.#now();
    this.received = Math.max(this.received, progress.bytes ?? 0);
    const changed = !sameProgress(this.progress, progress);
    this.progress = progress;
    if (changed) this.untold.push(this.activity());
    return changed;
  }

  /**
   * Takes in how many bytes the pack git writes holds on disk. The pack starts coming in before
   * git's first line about it, which waits for the first object, so its growth is getting further
   * too. Returns whether what the fetch is doing changed.
   */
  onWritten(bytes: number): boolean {
    if (bytes <= this.#written) return false;
    this.#written = bytes;
    this.received = Math.max(this.received, bytes);
    this.advanced = this.#now();
    if (this.stage >= Stage.Receiving) return false;
    this.stage = Stage.Receiving;
    // GitHub's last line was about preparing, which is over.
    this.progress = undefined;
    this.untold.push(this.activity());
    return true;
  }

  /** Takes in one of git's trace2 events, a line of JSON. Returns whether what it's doing changed. */
  onTrace(line: string): boolean {
    this.traced = true;
    // Sent once git has read the server's first answer.
    if (this.stage === Stage.Connecting && line.includes('"negotiated-version"')) {
      this.stage = Stage.Preparing;
      this.untold.push(this.activity());
      return true;
    }
    return false;
  }

  /**
   * The limit the fetch ran out, if any: until the objects come in, how long it may take to
   * connect and to start; from then on, how long it may go without getting further, however long
   * it has taken so far; and throughout, how much it may bring, when `maxBytes` says.
   */
  over(
    limits: FetchLimits,
    whole: boolean,
    maxBytes?: number,
  ): { reason: StopReason; limit: number } | undefined {
    if (maxBytes !== undefined && this.received > maxBytes) {
      return { reason: 'size', limit: maxBytes };
    }
    if (this.advanced !== undefined) {
      const still = this.#now() - this.advanced >= limits.stall;
      return still ? { reason: 'stall', limit: limits.stall } : undefined;
    }
    const { elapsed } = this;
    if (this.stage === Stage.Connecting && this.traced && elapsed >= limits.connect) {
      return { reason: 'connect', limit: limits.connect };
    }
    const limit = startLimit(limits, whole);
    return elapsed >= limit ? { reason: 'start', limit } : undefined;
  }

  activity(): Activity {
    const { elapsed, progress } = this;
    switch (this.stage) {
      case Stage.Connecting:
        return { kind: 'connecting', elapsed };
      case Stage.Preparing:
        return { kind: 'preparing', elapsed, progress };
      case Stage.Receiving:
      case Stage.Resolving:
        // Until git's first line, only the pack's size on disk says how far it has got.
        return {
          kind: 'transferring',
          elapsed,
          progress: progress ?? { stage: 'Receiving objects', done: 0, bytes: this.received },
        };
      default:
        return this.stage satisfies never;
    }
  }

  /**
   * What the fetch is doing, for an error: "connecting to GitHub", "GitHub was still preparing
   * what to send (counting objects, 45% of 1234)", "receiving objects, 45% of 5608"…
   */
  doing(): string {
    const progress = this.progress === undefined ? undefined : describeProgress(this.progress);
    switch (this.stage) {
      case Stage.Connecting:
        return 'connecting to GitHub';
      case Stage.Preparing:
        return progress === undefined
          ? 'GitHub was still working out what to send'
          : `GitHub was still preparing what to send (${progress})`;
      case Stage.Receiving:
        return progress ?? 'receiving objects';
      case Stage.Resolving:
        return progress ?? 'resolving deltas';
      default:
        return this.stage satisfies never;
    }
  }
}

function sameProgress(a: Progress | undefined, b: Progress): boolean {
  return a?.stage === b.stage && a.done === b.done && a.total === b.total && a.bytes === b.bytes;
}

/** The file git writes its trace2 events to, read as it grows, and removed when it's done. */
export class TraceFile {
  readonly path: string;
  readonly #file: FileHandle;
  #offset = 0;
  /** The start of a line git hasn't finished writing. */
  #pending = '';

  private constructor(path: string, file: FileHandle) {
    this.path = path;
    this.#file = file;
  }

  /**
   * The trace at `path`, empty. git appends to it, so a file left there by a fetch that never
   * finished, whose name this one reuses, is emptied first: its events are another fetch's.
   */
  static async create(path: string): Promise<TraceFile> {
    try {
      return new TraceFile(path, await open(path, 'w+', 0o600));
    } catch (error) {
      throw GitError.io(`making ${path}`, error);
    }
  }

  /** Hands each line git has finished writing since the last call to `line`. */
  async read(line: (text: string) => void): Promise<void> {
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await this.#file.read(buffer, 0, buffer.length, this.#offset);
      if (bytesRead === 0) break;
      this.#offset += bytesRead;
      this.#pending += buffer.subarray(0, bytesRead).toString('utf8');
    }
    const lines = this.#pending.split('\n');
    this.#pending = lines.pop() ?? '';
    for (const each of lines) line(each);
  }

  async remove(): Promise<void> {
    await this.#file.close().catch(() => undefined);
    await rm(this.path, { force: true });
  }
}

export interface WatchOptions {
  readonly limits: FetchLimits;
  /** Whether it may bring a repository's whole contents at once, which may take longer to start. */
  readonly whole: boolean;
  /** Where git writes its trace, emptied first and removed afterwards. */
  readonly trace: string;
  /** Told what the fetch is doing whenever that changes, and every second. */
  readonly progress?: ((activity: Activity) => void) | undefined;
  /** What git reads on its stdin, such as the object IDs `git fetch --stdin` fetches. */
  readonly input?: string | undefined;
  /** The most bytes the fetch may bring, past which it's stopped. */
  readonly maxBytes?: number | undefined;
  /**
   * The folder git writes the fetch's pack in, `objects/pack`, whose size on disk counts as what
   * has come in.
   */
  readonly packs?: string | undefined;
  /**
   * Cleans up after a git Lo stopped, given its process ID, once it and everything it started
   * have exited: whether a limit ran out or the progress function threw.
   */
  readonly afterStop?: ((pid: number) => Promise<void>) | undefined;
  /** Gets a line when Lo stops a fetch. */
  readonly log?: ((line: string) => void) | undefined;
  /** Stops the fetch once it aborts, which then fails with its reason. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * How a watched fetch ended: git exited by itself, whatever its status, having brought `received`
 * bytes as far as Lo could tell, or Lo stopped it.
 */
export type Watched =
  | {
      readonly kind: 'finished';
      readonly exit: Exit;
      readonly messages: string;
      readonly received: number;
    }
  | { readonly kind: 'stopped'; readonly stopped: Stopped; readonly messages: string };

/**
 * Runs `command`, a `git fetch` with `--progress`, under watch: tells `options.progress` what it's
 * doing, and stops it when it runs out a limit. Lines that aren't progress are its messages. The
 * progress function is never told anything after this returns; if it throws, or `options.signal`
 * aborts, git is stopped and the error goes on. Either way, a git Lo stopped is cleaned up after
 * with `options.afterStop`.
 */
export async function watch(command: GitCommand, options: WatchOptions): Promise<Watched> {
  options.signal?.throwIfAborted();
  const trace = await TraceFile.create(options.trace);
  const pack = options.packs === undefined ? undefined : await PackFiles.start(options.packs);
  let child: Child | undefined;
  // Whether what git left has been cleaned up after, or is being: it's done once.
  let cleaned = false;
  try {
    child = command
      .env('GIT_TRACE2_EVENT', trace.path)
      .env('GIT_TRACE2_EVENT_BRIEF', '1')
      .start({ input: options.input !== undefined });
    const running = child;
    const state = new FetchState();
    let messages = '';
    let line = '';
    const take = (text: string) => {
      const parsed = parseProgressLine(text);
      if (parsed !== undefined) state.onProgress(parsed.source, parsed.progress);
      else if (text.trim() !== '') messages += `${text.trimEnd()}\n`;
    };
    // git ends a progress update with \r and a finished stage with \n.
    running.onStderr((text: string) => {
      const pieces = (line + text).split(/[\r\n]/);
      line = pieces.pop() ?? '';
      for (const piece of pieces) take(piece);
    });
    running.stdout.resume();
    running.stdin?.end(options.input);
    let exited = false;
    void running.gone.then(
      () => {
        exited = true;
      },
      () => {
        exited = true;
      },
    );
    const tell = () => {
      const untold = state.untold;
      state.untold = [];
      if (options.progress === undefined) return;
      if (untold.length === 0) untold.push(state.activity());
      for (const activity of untold) options.progress(activity);
    };
    tell();
    let told = Date.now();
    let stopped: Stopped | undefined;
    for (;;) {
      await Promise.race([running.gone.catch(() => undefined), sleep(POLL)]);
      if (exited) break;
      options.signal?.throwIfAborted();
      await trace.read((event) => state.onTrace(event));
      if (pack !== undefined) state.onWritten(await pack.size());
      const over = state.over(options.limits, options.whole, options.maxBytes);
      if (over !== undefined) {
        stopped = { ...over, doing: state.doing(), pid: running.pid ?? 0 };
        await stopGroup(running);
        break;
      }
      if (state.untold.length > 0 || Date.now() - told >= TELL_EVERY) {
        tell();
        told = Date.now();
      }
    }
    // Whatever git left in its group, such as a `git-remote-https` that holds its output open.
    running.stop('SIGKILL');
    const exit = await running.exited;
    take(line);
    if (stopped === undefined) {
      if (state.untold.length > 0) tell();
      // A fetch that finished between two looks wrote packs the watch never saw.
      const written = pack === undefined ? 0 : await pack.size();
      return { kind: 'finished', exit, messages, received: Math.max(state.received, written) };
    }
    const said = messages.trim() === '' ? '' : `; git said: ${messages.trim()}`;
    options.log?.(
      `stopped ${command.display} after ${formatDuration(state.elapsed)}, while ${stopped.doing}${said}`,
    );
    cleaned = true;
    await options.afterStop?.(stopped.pid);
    return { kind: 'stopped', stopped, messages };
  } catch (error) {
    if (child !== undefined && !cleaned) {
      await stopGroup(child);
      await child.exited.catch(() => undefined);
      if (child.pid !== undefined) await options.afterStop?.(child.pid);
    }
    throw error;
  } finally {
    await trace.remove();
  }
}

/**
 * The packs a fetch writes in a folder, `objects/pack`, from when it starts: each `tmp_pack_*`
 * `index-pack` writes as it comes in, and each pack it has finished and named, since a fetch may
 * bring more than one. Those already there when it starts are another fetch's.
 */
export class PackFiles {
  readonly #folder: string;
  readonly #before: ReadonlySet<string>;

  private constructor(folder: string, before: ReadonlySet<string>) {
    this.#folder = folder;
    this.#before = before;
  }

  static async start(folder: string): Promise<PackFiles> {
    return new PackFiles(folder, new Set(await PackFiles.#names(folder)));
  }

  static async #names(folder: string): Promise<string[]> {
    const names = await readdir(folder).catch(() => []);
    return names.filter(
      (name) =>
        name.startsWith('tmp_pack_') || (name.startsWith('pack-') && name.endsWith('.pack')),
    );
  }

  /** How many bytes the fetch's packs hold on disk so far. */
  async size(): Promise<number> {
    let total = 0;
    for (const name of await PackFiles.#names(this.#folder)) {
      if (this.#before.has(name)) continue;
      // A pack being written is renamed once it's done, so it's counted once, by either name.
      total += (await stat(join(this.#folder, name)).catch(() => undefined))?.size ?? 0;
    }
    return total;
  }
}

/**
 * Stops `child`'s process group: asks first, with SIGTERM, so that git removes its lock files and
 * temporary files itself, then kills whatever is still running {@link STOP_GRACE} later.
 */
async function stopGroup(child: Child): Promise<void> {
  child.stop('SIGTERM');
  await Promise.race([child.gone.catch(() => undefined), sleep(STOP_GRACE)]);
  child.stop('SIGKILL');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
