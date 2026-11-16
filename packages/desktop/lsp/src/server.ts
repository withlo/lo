/**
 * One language server: its process, the protocol over its stdio, the files it has open, its
 * requests, its state, its memory and its log, from start to stop.
 *
 * Main speaks the protocol; the window never sees the server's output, its checkout's folder or a
 * URI. Lo asks only for what it shows (hovers, definitions, references, inlay hints and document
 * symbols) about files it opened with their text from git, and answers the server's own requests
 * itself, refusing anything that would edit, show or ask.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { ErrorCodes, type Message, type MessageReader, ResponseError } from 'vscode-jsonrpc';
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import type {
  DefinitionParams,
  DocumentSymbolParams,
  HoverParams,
  InlayHintParams,
  ReferenceParams,
  ServerCapabilities,
} from 'vscode-languageserver-protocol';

import { initializeAnswer, initializeParams } from './capabilities.ts';
import { Documents } from './documents.ts';
import { isInside, serverEnvironment, temporaryFolder } from './environment.ts';
import { FLOOD_BYTES, FLOOD_LINES, FLOOD_MESSAGES, FLOOD_WINDOW, FrameMeter } from './framing.ts';
import { Log } from './log.ts';
import { type Member, type ReadFamily, readFamily, stillRunning, withServices } from './family.ts';
import { type Place, writeInHome } from './place.ts';
import {
  checkArguments,
  checkProgram,
  familyGone,
  signalFamily,
  sleep,
  startProcess,
} from './process.ts';
import { type Answer, Queue } from './queue.ts';
import { reply } from './requests.ts';
import { type Failure, failureMessage, type Progress, type State } from './state.ts';
import { fileUri, folderUri, treePath } from './uri.ts';

/** What Lo needs to start a server. */
export interface ServerSpec {
  /** What the reader calls it, such as "TypeScript". */
  readonly name: string;
  /** The server's own program, by absolute path: a compiled program, never a launcher script. */
  readonly program: string;
  readonly args: readonly string[];
  /** The checkout it runs on: its workspace's one folder, and where it runs, unless it's rootless. */
  readonly root: string;
  /**
   * Whether it's told of no workspace, only of the files Lo opens, for a server that would read a
   * workspace's build files and run what they name, as SourceKit-LSP would: it answers from the
   * files Lo opens alone. It runs in its home, not the checkout, and moves to another checkout
   * without being told, since it was told of none. It has no {@link workspace} either.
   */
  readonly rootless?: boolean | undefined;
  /** A folder of its own, its `HOME`, made if it isn't there. */
  readonly home: string;
  /** The folders of the toolchain it needs, first on its `PATH`. */
  readonly path: readonly string[];
  /** Its adapter's own variables, such as `GOPROXY=off`. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** The names among `variables` that load code or configure a program, set on purpose. */
  readonly allowed?: readonly string[] | undefined;
  /** Variables naming folders and files in its home, by their paths there, such as Go's caches. */
  readonly homeFolders?: Readonly<Record<string, string>> | undefined;
  /** The variables that set up the git it runs, each `GIT_*`, from `@lo/git`. */
  readonly git: Readonly<Record<string, string>>;
  /** What it gets for `workspace/configuration`, by section. */
  readonly settings?: unknown;
  /** Its `initializationOptions`. */
  readonly initializationOptions?: unknown;
  /**
   * What it's given that depends on its checkout and home, worked out once its home is made, just
   * before it starts: arguments before `args`, more variables, files Lo writes in its home, and
   * settings and initialization options in place of these.
   */
  readonly place?: Place | undefined;
  /**
   * Whether it starts again to go to another checkout, rather than moving there, for a server whose
   * project Lo works out from its checkout as it starts.
   */
  readonly stays?: boolean | undefined;
  /**
   * The programs the system starts for it outside its family, by their file names, such as the
   * `SourceKitService` that `launchd` starts for SourceKit-LSP: a process of one of these names
   * whose `HOME` is this server's home is counted in its memory and stopped with it, as its family
   * is. Lo gives a repository's servers of one adapter the same home, one after another, so a
   * service an earlier one left there is counted and stopped too, as what Lo left. `family.ts`
   * says how a process's `HOME` is read.
   */
  readonly services?: readonly string[] | undefined;
  /** The most resident memory its process group may hold, in bytes. */
  readonly memoryCap?: number | undefined;
  /** Lo's version, which it hears in `clientInfo`. */
  readonly version?: string | undefined;
  /**
   * Makes the workspace the server is told of, in its home, for a server that mustn't be told of
   * the checkout itself, such as C#'s, which would load the checkout's own projects. It runs once
   * the home is made, before the server starts, with the checkout and the home as they resolve,
   * and the server runs in the workspace's folder, not the checkout.
   */
  readonly workspace?: ((paths: WorkspacePaths) => Promise<Workspace>) | undefined;
}

/** Where a server runs, as the system resolves each, for its {@link ServerSpec.workspace}. */
export interface WorkspacePaths {
  /** The checkout it answers about. */
  readonly root: string;
  /** Its home. */
  readonly home: string;
}

/** The workspace Lo makes for a server, in its home, in place of the checkout. */
export interface Workspace {
  /** The folder it's told is its workspace, in `initialize`: one inside its home. */
  readonly folder: string;
  /** What it's sent once it's initialized, such as Roslyn's `project/open`. */
  readonly notifications: readonly { readonly method: string; readonly params: object }[];
}

/** How long each part of a server's life may take, in milliseconds, and its memory cap. */
export interface Limits {
  /** The most resident memory a server's group may hold, in bytes, unless its spec says. */
  readonly memoryCap: number;
  /** How often its family's memory is read. */
  readonly memoryEvery: number;
  /** How many reads of its memory in a row may fail before it's stopped, unwatched. */
  readonly memoryMisses: number;
  /** How long it has to answer `initialize`. */
  readonly initialize: number;
  /** How long a stop waits for its answer to `shutdown`. */
  readonly shutdown: number;
  /** How long a stop waits, after `exit`, for it to exit. */
  readonly exit: number;
  /**
   * How long a read of its family may take, before a stop signals what it knows of. A stop reads
   * it beside `shutdown`, taking none of the stop's time of its own, and again with its group
   * frozen, just before `SIGTERM`.
   */
  readonly family: number;
  /** How long its family has after `SIGTERM`, before `SIGKILL`. */
  readonly term: number;
  /** How long a kill may spend freezing its family, a round of reading at a time. */
  readonly freeze: number;
  /** How long a stop waits for it to go after `SIGKILL`. */
  readonly kill: number;
  /** The most messages it may send within {@link Limits.floodWindow}. */
  readonly floodMessages: number;
  /** The most output it may write within {@link Limits.floodWindow}, in bytes, stderr included. */
  readonly floodBytes: number;
  /** The most lines it may write to stderr within {@link Limits.floodWindow}. */
  readonly floodLines: number;
  readonly floodWindow: number;
  /** How many deadlines it may miss within {@link Limits.missWindow} before it's `notAnswering`. */
  readonly misses: number;
  readonly missWindow: number;
}

/**
 * A stop takes at most {@link longestStop}: 4.75 s, leaving a quarter of a second of a feature's
 * 5 s to stop. Nothing the server sends is read once `shutdown` is answered or given up on, so no
 * flood can hold it up.
 */
export const LIMITS: Limits = {
  memoryCap: 4 * 1024 ** 3,
  memoryEvery: 5000,
  memoryMisses: 3,
  initialize: 60_000,
  shutdown: 1000,
  exit: 1000,
  family: 250,
  term: 2000,
  freeze: 400,
  kill: 100,
  floodMessages: FLOOD_MESSAGES,
  floodBytes: FLOOD_BYTES,
  floodLines: FLOOD_LINES,
  floodWindow: FLOOD_WINDOW,
  misses: 3,
  missWindow: 60_000,
};

/** The requests Lo makes, with what each takes besides the file. */
export interface Methods {
  'textDocument/hover': HoverParams;
  'textDocument/definition': DefinitionParams;
  'textDocument/references': ReferenceParams;
  'textDocument/inlayHint': InlayHintParams;
  'textDocument/documentSymbol': DocumentSymbolParams;
}

export type Method = keyof Methods;

const METHODS: ReadonlySet<string> = new Set<Method>([
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/inlayHint',
  'textDocument/documentSymbol',
]);

/** A request's parameters, with the file it's about as a path in the tree. */
export type Asked<M extends Method> = Omit<
  Methods[M],
  'textDocument' | 'workDoneToken' | 'partialResultToken'
> & { readonly path: string };

export interface RequestOptions {
  /** How long the server has to answer, in milliseconds. */
  readonly deadline: number;
  /** Gives up on the request when it aborts. */
  readonly signal?: AbortSignal | undefined;
  /** What the request is for, such as one view's hover: a newer one with the same key replaces it. */
  readonly key?: string | undefined;
}

/** What tests may change about how a server runs. */
export type Tuning = Partial<Limits> & {
  /** How its family is read, for its memory and to stop it. */
  readonly readFamily?: ReadFamily | undefined;
};

/**
 * The longest a stop can take with `limits`: `shutdown`, with a read of the family beside it, then
 * `exit`, then a read of the family with its group frozen, then `term` after `SIGTERM`, then a
 * kill's `freeze` and `kill`.
 */
export function longestStop(limits: Limits): number {
  const { shutdown, exit, family, term, freeze, kill } = limits;
  return Math.max(shutdown, family) + exit + family + term + freeze + kill;
}

/** Starts a server, and returns it at once, `starting`. */
export function startServer(spec: ServerSpec, tuning: Tuning = {}): Server {
  const { readFamily: read = readFamily, ...limits } = tuning;
  return new Server(spec, { ...LIMITS, ...limits }, read);
}

/** How long a server may run on after its output ends, before it counts as failed. */
const CLOSED_GRACE = 1000;

/** The most rounds a kill reads and freezes its family in, until a round finds nothing new. */
const FREEZE_ROUNDS = 8;

/** How many progress tokens a server may have open. */
const PROGRESS_TOKENS = 64;
/** The longest progress title kept, in characters. */
const TITLE_LENGTH = 200;

export class Server {
  readonly name: string;
  /** Resolves `true` once the server has answered `initialize`, or `false` if it never will. */
  readonly ready: Promise<boolean>;
  readonly #spec: ServerSpec;
  readonly #limits: Limits;
  readonly #readFamily: ReadFamily;
  #state: State = { kind: 'starting' };
  readonly #listeners = new Set<(state: State) => void>();
  readonly #log = new Log();
  readonly #documents = new Documents();
  readonly #queue: Queue;
  /** The checkout's folder, as the system resolves it and as given. */
  #roots: string[] = [];
  /** Its home, as the system resolves it, once it's made. */
  #home: string | undefined;
  /** The workspace Lo made for it in its home, if its spec makes one. */
  #workspace: Workspace | undefined;
  /** What it's told, from its spec or where it runs. */
  #settings: unknown;
  #initializationOptions: unknown;
  #child: ChildProcess | undefined;
  #connection: MessageConnection | undefined;
  #capabilities: ServerCapabilities | undefined;
  /** Resolves once the server has spawned, or once it's clear it won't. */
  readonly #launched: Promise<void>;
  /** Resolves once its process has exited, or at once if it never ran. */
  readonly #exited: Promise<void>;
  #exit: { readonly code: number | null; readonly signal: string | null } | undefined;
  #stopRequested = false;
  #stopping: Promise<void> | undefined;
  /** The end of its group after a failure. */
  #cleanup: Promise<void> | undefined;
  /**
   * The kill under way, once one has begun: from then on it alone signals the family, so nothing
   * lets the group it froze go on.
   */
  #killing: Promise<void> | undefined;
  /** Each process outside its group that a stop or a kill has read, by ID, for a kill to find. */
  readonly #outside = new Map<number, Member>();
  #memory: number | undefined;
  #memoryTimer: ReturnType<typeof setInterval> | undefined;
  #readingMemory = false;
  /** How many reads of its memory in a row have failed. */
  #memoryUnread = 0;
  /** Whether it broke a limit, and so is being killed. */
  #breached = false;
  /** Whether what it writes to stdout, and to stderr, is no longer read. */
  #deaf = false;
  #muted = false;
  #misses: number[] = [];
  readonly #tokens = new Set<string | number>();
  readonly #progress = new Map<string | number, Progress>();
  #spawnedAt: number | undefined;
  #endedAt: number | undefined;
  #resolveReady: (ready: boolean) => void = () => undefined;
  #resolveExited: () => void = () => undefined;

  constructor(spec: ServerSpec, limits: Limits, read: ReadFamily) {
    this.name = spec.name;
    this.#spec = spec;
    this.#settings = spec.settings;
    this.#initializationOptions = spec.initializationOptions;
    this.#limits = limits;
    const services = spec.services ?? [];
    this.#readFamily =
      services.length === 0 ? read : withServices(read, services, () => this.#home);
    this.ready = new Promise((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#exited = new Promise((resolve) => {
      this.#resolveExited = resolve;
    });
    this.#queue = new Queue(
      (method, params, token) => {
        if (this.#connection === undefined) throw new Error('the server isn’t running');
        return this.#connection.sendRequest(method, params, token);
      },
      { missed: () => this.#missed(), answered: () => this.#answered() },
    );
    this.#launched = this.#launch();
  }

  get state(): State {
    return this.#state;
  }

  /** Calls `listener` with each new state, and returns what stops it. */
  onState(listener: (state: State) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The server's process ID, which is its group's too, once it has started. */
  get pid(): number | undefined {
    return this.#child?.pid;
  }

  /** How long its process has run, or ran, in milliseconds. */
  get uptime(): number {
    if (this.#spawnedAt === undefined) return 0;
    return (this.#endedAt ?? performance.now()) - this.#spawnedAt;
  }

  /** Its group's resident memory when last read, in bytes. */
  get memory(): number | undefined {
    return this.#memory;
  }

  /** What it said it can do, in its answer to `initialize`. */
  get capabilities(): ServerCapabilities | undefined {
    return this.#capabilities;
  }

  /** Its log's lines, oldest first. */
  get log(): readonly string[] {
    return this.#log.lines;
  }

  /**
   * Opens the tree's `path` on the server with `text`, its blob's text from git, unless it's open,
   * closing the file least recently asked about past the limit. It says whether the file is open:
   * a server opens files only once it has answered `initialize`, and until it stops.
   */
  open(path: string, languageId: string, text: string): boolean {
    const root = this.#roots[0];
    if (!this.#answering() || root === undefined) return false;
    const uri = fileUri(root, path);
    if (this.#documents.touch(uri)) return true;
    for (const closed of this.#documents.add(uri)) {
      this.#notify('textDocument/didClose', { textDocument: { uri: closed } });
    }
    this.#notify('textDocument/didOpen', { textDocument: { uri, languageId, version: 1, text } });
    return true;
  }

  /**
   * Asks the server `method` about the open file at `params.path`. It resolves with the server's
   * answer, unchecked, or why there's none, by the deadline at the latest.
   */
  async request<M extends Method>(
    method: M,
    params: Asked<M>,
    options: RequestOptions,
  ): Promise<Answer> {
    if (!METHODS.has(method)) throw new Error(`Lo doesn’t ask servers ${method}`);
    const root = this.#roots[0];
    if (this.#state.kind === 'starting') return { ok: false, why: 'notReady' };
    if (!this.#answering() || root === undefined) return { ok: false, why: 'stopped' };
    const { path, ...rest } = params;
    const uri = fileUri(root, path);
    if (!this.#documents.touch(uri)) return { ok: false, why: 'notOpen' };
    return this.#queue.ask({
      method,
      params: { ...rest, textDocument: { uri } },
      deadline: options.deadline,
      signal: options.signal,
      key: options.key,
    });
  }

  /**
   * The tree's path for a file a server's answer names, when it's inside the checkout. Anything
   * else, such as a toolchain's sources or a `jdt://` address, has no path.
   */
  pathOf(uri: string): string | undefined {
    return treePath(this.#roots, uri);
  }

  /**
   * Moves the server to the checkout at `root`, another head of the same repository, when it says
   * it takes changes to its workspace's folders. Its files are closed. It says whether it moved;
   * if it didn't, the server is as it was, and a new one is needed for `root`. `still`, asked once
   * `root` is resolved, just before the server is told, keeps it where it is when it says no. One
   * whose spec says it stays never moves. A rootless server, told of no workspace, moves without
   * being told: only its files change.
   */
  async moveTo(root: string, still: () => boolean = () => true): Promise<boolean> {
    // A workspace Lo made is the checkout's, so a server on one starts again on another.
    if (this.#workspace !== undefined) return false;
    const rootless = this.#spec.rootless === true;
    const changes = this.#capabilities?.workspace?.workspaceFolders?.changeNotifications;
    if (this.#spec.stays === true) return false;
    const takes = rootless || changes === true || typeof changes === 'string';
    if (!this.#answering() || !takes) return false;
    const real = await realpath(root);
    if (!this.#answering() || !still()) return false;
    for (const uri of this.#documents.clear()) {
      this.#notify('textDocument/didClose', { textDocument: { uri } });
    }
    const removed = this.#folders();
    this.#roots = [...new Set([real, root])];
    if (!rootless) {
      this.#notify('workspace/didChangeWorkspaceFolders', {
        event: { added: this.#folders(), removed },
      });
    }
    return true;
  }

  /**
   * Stops the server and everything it started: `shutdown` and `exit`, 1 s each, then `SIGTERM` to
   * its family, then `SIGKILL` 2 s later. Its requests are answered `stopped` at once. It resolves
   * once the group is gone, or once it's been killed, within 4.75 s ({@link longestStop}). A
   * server that failed stays `failed`; any other is `stopped`.
   */
  stop(): Promise<void> {
    this.#stopping ??= this.#stop();
    return this.#stopping;
  }

  async #stop(): Promise<void> {
    this.#stopRequested = true;
    const failed = this.#state.kind === 'failed';
    if (!failed) this.#setState({ kind: 'stopping' });
    this.#queue.close('stopped');
    this.#resolveReady(false);
    await this.#launched;
    if (this.#child?.pid !== undefined) {
      if (failed || this.#exit !== undefined) {
        await (this.#cleanup ?? this.#endGroup());
      } else {
        await this.#shutDown();
      }
    }
    if (!failed) this.#setState({ kind: 'stopped' });
  }

  /**
   * Asks the server to shut down and exit, then ends its family. What left its group is read as it
   * shuts down, inside that wait, since once the server exits nothing ties those to it, and again
   * as its family ends, for what it started since.
   */
  async #shutDown(): Promise<void> {
    const connection = this.#connection;
    const group = this.#child?.pid;
    let earlier: readonly Member[] = [];
    if (connection !== undefined && group !== undefined) {
      const { shutdown, exit } = this.#limits;
      const read = this.#others(group);
      try {
        await Promise.race([
          connection.sendRequest('shutdown').catch(() => undefined),
          this.#exited,
          sleep(shutdown),
        ]);
      } catch {
        // The connection has closed.
      }
      // Nothing more it sends matters, so none of it is read, and however much it sends, the stop
      // keeps its time.
      this.#deafen();
      earlier = await read;
      this.#notify('exit');
      await Promise.race([this.#exited, sleep(exit)]);
    }
    await this.#endGroup(earlier);
  }

  /**
   * Stops what's left of the server's family, with any of `known`, read before, that's still the
   * same process: `SIGTERM`, then, if anything outlasts it, a kill. The group is frozen while
   * what's outside it is read, and until `SIGTERM` has been sent, so nothing in it can leave it, or
   * start a process outside it, unseen in between. A kill that begins meanwhile, as when the
   * server's memory passes its cap, takes over: the stop signals nothing more, and waits for it.
   */
  async #endGroup(known: readonly Member[] = []): Promise<void> {
    const group = this.#child?.pid;
    if (group === undefined) return;
    if (this.#killBegun()) return this.#kill();
    signalFamily(group, [], 'SIGSTOP');
    const others = await this.#others(group, known);
    // The group a kill froze meanwhile stays frozen until it's killed.
    if (this.#killBegun()) return this.#kill();
    const pids = others.map((member) => member.pid);
    const sent = signalFamily(group, pids, 'SIGTERM');
    // Each in the group goes on to the `SIGTERM` waiting for it.
    signalFamily(group, [], 'SIGCONT');
    if (sent && !(await familyGone(group, pids, this.#limits.term))) return this.#kill();
    await Promise.race([this.#exited, sleep(this.#limits.kill)]);
    if (this.#killBegun()) await this.#kill();
  }

  /** Whether a kill has begun, which signals the family alone from then on. */
  #killBegun(): boolean {
    return this.#killing !== undefined;
  }

  /**
   * Kills the server's family at once, with what a stop or an earlier read found outside its group
   * that's still the same process. The group is frozen first, then each process found by its
   * parent outside it, round after round until a round finds nothing new, so nothing in the family
   * can start a process that outlives it. Only then is everything frozen killed. There's one kill:
   * asked again, it's the one under way.
   */
  #kill(): Promise<void> {
    this.#killing ??= this.#killFamily();
    return this.#killing;
  }

  async #killFamily(): Promise<void> {
    const group = this.#child?.pid;
    if (group === undefined) return;
    signalFamily(group, [], 'SIGSTOP');
    const frozen = new Map<number, Member>();
    const until = performance.now() + this.#limits.freeze;
    for (let round = 0; round < FREEZE_ROUNDS; round += 1) {
      const left = until - performance.now();
      if (left <= 0) break;
      const known = [...this.#outside.values(), ...frozen.values()];
      const found = await this.#others(group, known, left);
      const fresh = found.filter((member) => !frozen.has(member.pid));
      if (fresh.length === 0) break;
      for (const member of fresh) frozen.set(member.pid, member);
      signalFamily(group, [...frozen.keys()], 'SIGSTOP');
    }
    signalFamily(group, [...frozen.keys()], 'SIGKILL');
    await Promise.race([this.#exited, sleep(this.#limits.kill)]);
  }

  /**
   * The processes descended from the server's group that have left it, such as a daemon in a
   * session of its own, and each of `known` that's still the same process, with what descends from
   * it, and its services, as read within `within`. Once the group is empty, only `known` and its
   * services lead anywhere. Beside the read, each of `known` is read again by its ID alone, so a
   * read that fails or takes longer still gives what was found before that's still the same
   * process, as far as that's known in time.
   */
  async #others(
    group: number,
    known: readonly Member[] = [],
    within = this.#limits.family,
  ): Promise<readonly Member[]> {
    const services = (this.#spec.services ?? []).length > 0;
    if (!signalFamily(group, [], 0) && known.length === 0 && !services) return [];
    const read = this.#readFamily(group, known).then(
      (family) => family.filter((member) => member.group !== group),
      () => undefined,
    );
    const checked = stillRunning(known).catch(() => []);
    const timeUp = sleep(within).then(() => undefined);
    const found = await Promise.race([read, timeUp]);
    if (found === undefined) {
      // An ID that can't be told, in time, to be the same process is left alone.
      return Promise.race([checked, timeUp.then(() => [])]);
    }
    for (const member of found) this.#outside.set(member.pid, member);
    return found;
  }

  /** Checks what the server needs, then starts it. */
  async #launch(): Promise<void> {
    const spec = this.#spec;
    try {
      const root = await realpath(spec.root);
      this.#roots = [...new Set([root, spec.root])];
      // The program that runs is the one checked, by its real path.
      const program = await checkProgram(spec.program, this.#roots);
      checkArguments(spec.program, program, spec.args);
      // The folders as given, then as the system resolves them, are each held to the same rules.
      const given = {
        roots: this.#roots,
        variables: spec.variables,
        allowed: spec.allowed,
        homeFolders: spec.homeFolders,
        git: spec.git,
      };
      serverEnvironment({ ...given, home: spec.home, path: spec.path });
      const path = await Promise.all(spec.path.map((folder) => resolved(folder)));
      // Its home as it will resolve, checked before any of it is made.
      serverEnvironment({ ...given, home: await resolvedAhead(spec.home), path });
      await mkdir(spec.home, { recursive: true, mode: 0o700 });
      const home = await realpath(spec.home);
      this.#home = home;
      serverEnvironment({ ...given, home, path });
      await mkdir(temporaryFolder(home), { recursive: true, mode: 0o700 });
      // What depends on where it runs, held to the same rules.
      const placed = spec.place === undefined ? {} : await spec.place({ root, home });
      if (this.#stopRequested) return;
      const args = [...(placed.args ?? []), ...spec.args];
      checkArguments(spec.program, program, args);
      const variables = { ...spec.variables, ...placed.variables };
      const env = serverEnvironment({ ...given, variables, home, path });
      await writeInHome(home, placed.files ?? {});
      if (placed.settings !== undefined) this.#settings = placed.settings;
      if (placed.initializationOptions !== undefined) {
        this.#initializationOptions = placed.initializationOptions;
      }
      if (this.#stopRequested) return;
      if (spec.rootless === true && spec.workspace !== undefined) {
        throw new Error('a rootless server is told of no workspace, so it has none of Lo’s');
      }
      if (spec.workspace !== undefined) {
        // Its failure is Lo's, never the program's, so it keeps no code a start's error is read by.
        const workspace = await spec.workspace({ root, home }).catch((error: unknown) => {
          throw new Error(error instanceof Error ? error.message : String(error));
        });
        const folder = await realpath(workspace.folder);
        if (!isInside(home, folder) || this.#roots.some((each) => isInside(each, folder))) {
          throw new Error(`a server's workspace must be in its home: ${workspace.folder}`);
        }
        this.#workspace = { ...workspace, folder };
        if (this.#stopRequested) return;
      }
      // A server told of a workspace of Lo's runs in it, so nothing it starts begins in the
      // checkout either. A rootless server runs in its home, for the same reason, and so a folder
      // its options name by a relative path is one of its home's.
      const cwd = spec.rootless === true ? home : (this.#workspace?.folder ?? root);
      const child = startProcess(program, args, { env, cwd });
      this.#child = child;
      child.on('error', (error) => {
        // An error once it runs, such as a signal it can't be sent, changes nothing: its exit
        // says what happened.
        if (child.pid === undefined) {
          this.#fail({ kind: 'start', message: startError(spec.program, error) });
        }
      });
      if (child.pid === undefined) return;
      this.#spawnedAt = performance.now();
      child.once('exit', (code, signal) => this.#ended(code, signal));
      this.#connect(child);
      this.#memoryTimer = setInterval(() => void this.#watchMemory(), this.#limits.memoryEvery);
      this.#memoryTimer.unref();
      void this.#initialize(this.#workspace?.folder ?? root);
    } catch (error) {
      this.#fail({ kind: 'start', message: startError(spec.program, error) });
    }
    // It never ran, so it has nothing to wait for.
    if (this.#child?.pid === undefined) this.#resolveExited();
  }

  /** Speaks the protocol over the child's stdio. */
  #connect(child: ChildProcess): void {
    const { stdin, stdout, stderr } = child;
    if (stdin === null || stdout === null || stderr === null) {
      throw new Error('the server has no pipes');
    }
    // A pipe's error, such as writing to a server that's gone, changes nothing: its exit says what
    // happened.
    for (const stream of [stdin, stdout, stderr]) stream.on('error', () => undefined);
    const { floodMessages, floodBytes, floodLines, floodWindow } = this.#limits;
    const meter = new FrameMeter({
      messages: floodMessages,
      bytes: floodBytes,
      lines: floodLines,
      within: floodWindow,
    });
    // Each piece of stderr has a turn of its own, so however much it writes, main has turns too,
    // and the log handles a piece in a pass over it, however many lines it holds.
    stderr.setEncoding('utf8');
    stderr.on('data', (text: string) => {
      const lines = this.#log.write(text);
      const wrong = meter.counted(Buffer.byteLength(text), lines);
      if (wrong !== undefined) this.#breach({ kind: 'protocol', message: wrong });
      stderr.pause();
      setImmediate(() => {
        if (!this.#muted) stderr.resume();
      });
    });
    stderr.on('end', () => this.#log.end());
    // Measured before the reader reads each piece, so a message too large, too much unread or too
    // many ends the server before the reader holds it; and as each is handed to the connection.
    // The connection handles one message a turn, so it's handed one a turn, and while the meter
    // says too many wait, the server's output waits in its pipe: however much it sends, main holds
    // a bounded amount of it, and has turns for everything else.
    stdout.on('data', (chunk: Buffer) => {
      const wrong = meter.feed(chunk);
      if (wrong !== undefined) this.#breach({ kind: 'protocol', message: wrong });
      else if (meter.behind) stdout.pause();
    });
    const reader = new StreamMessageReader(stdout);
    const waiting: Message[] = [];
    let handing = false;
    let deliver: ((message: Message) => void) | undefined;
    const handOn = (): void => {
      const message = waiting.shift();
      // What it sent before Lo stopped reading is dropped.
      if (message === undefined || this.#deaf) {
        handing = false;
        waiting.length = 0;
        return;
      }
      const wrong = meter.handedOn();
      if (wrong !== undefined) {
        handing = false;
        this.#breach({ kind: 'protocol', message: wrong });
        return;
      }
      if (stdout.isPaused() && !meter.behind) stdout.resume();
      deliver?.(message);
      setImmediate(handOn);
    };
    const metered: MessageReader = {
      onError: reader.onError,
      onClose: reader.onClose,
      onPartialMessage: reader.onPartialMessage,
      listen: (callback) => {
        deliver = callback;
        return reader.listen((message) => {
          if (this.#deaf) return;
          waiting.push(message);
          if (handing) return;
          handing = true;
          setImmediate(handOn);
        });
      },
      dispose: () => reader.dispose(),
    };
    const note = (message: string) => this.#log.add(`Lo: ${message}`);
    const connection = createMessageConnection(metered, new StreamMessageWriter(stdin), {
      error: note,
      warn: note,
      info: () => undefined,
      log: () => undefined,
    });
    this.#connection = connection;
    connection.onRequest((method: string, params: unknown) => {
      const answer = reply(method, params, {
        settings: this.#settings ?? null,
        folders: this.#spec.rootless === true ? null : this.#folders(),
      });
      if (!answer.accepted) {
        note(`refused the server’s ${method}: ${answer.message}`);
        return new ResponseError(ErrorCodes.MethodNotFound, answer.message);
      }
      if (method === 'window/workDoneProgress/create') this.#track(params);
      return answer.result;
    });
    connection.onNotification((method: string, params: unknown) => this.#heard(method, params));
    // The connection takes `$/progress` itself, and hands on what no handler of its own took.
    connection.onUnhandledProgress((params) => this.#progressed(params));
    connection.onError(([error, message]) => {
      // A message it sent that Lo couldn't read. A failed write means it's gone, which its exit says.
      if (message === undefined && this.#exit === undefined) {
        this.#breach({
          kind: 'protocol',
          message: `It sent a message Lo can’t read: ${error.message}`,
        });
      }
    });
    connection.onClose(() => {
      // Its output ended. Unless it exits, it can't answer anything again.
      setTimeout(() => {
        if (this.#exit === undefined) {
          this.#fail({ kind: 'protocol', message: 'It closed its output.' });
        }
      }, CLOSED_GRACE).unref();
    });
    connection.listen();
  }

  /**
   * Sends `initialize`, on the workspace `folder`, then `initialized` once it's answered, and then
   * what the workspace Lo made sends. A rootless server hears of no root.
   */
  async #initialize(folder: string): Promise<void> {
    const connection = this.#connection;
    if (connection === undefined) return;
    const params = initializeParams({
      rootUri: this.#spec.rootless === true ? null : folderUri(folder),
      name: basename(folder),
      version: this.#spec.version,
      initializationOptions: this.#initializationOptions,
    });
    let answer: unknown;
    const late = Symbol('late');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      answer = await Promise.race([
        connection.sendRequest('initialize', params),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(late), this.#limits.initialize);
        }),
      ]);
    } catch (error) {
      const why = error instanceof ResponseError ? error.message : String(error);
      this.#failStarting({ kind: 'initialize', message: `It refused initialize: ${why}` });
      return;
    } finally {
      clearTimeout(timer);
    }
    if (answer === late) {
      const seconds = Math.round(this.#limits.initialize / 1000);
      this.#failStarting({
        kind: 'initialize',
        message: `It didn’t answer initialize within ${seconds} s.`,
      });
      return;
    }
    if (this.#state.kind !== 'starting') return;
    const checked = initializeAnswer(answer);
    if ('wrong' in checked) {
      this.#fail({ kind: 'initialize', message: checked.wrong });
      return;
    }
    this.#capabilities = checked.capabilities;
    this.#notify('initialized', {});
    for (const { method, params: sent } of this.#workspace?.notifications ?? []) {
      this.#notify(method, sent);
    }
    this.#setState(this.#working());
    this.#resolveReady(true);
  }

  /** Fails a server that's still starting: one that has exited or stopped already says why. */
  #failStarting(failure: Failure): void {
    if (this.#state.kind === 'starting') this.#fail(failure);
  }

  /** The server's process has exited. */
  #ended(code: number | null, signal: string | null): void {
    this.#exit = { code, signal };
    this.#endedAt = performance.now();
    clearInterval(this.#memoryTimer);
    this.#log.add(
      code === null
        ? `Lo: it quit on ${signal ?? 'a signal'}.`
        : `Lo: it exited with code ${code}.`,
    );
    this.#fail({ kind: 'exited', code, signal });
    this.#queue.close('stopped');
    this.#connection?.dispose();
    this.#child?.stdin?.destroy();
    this.#child?.stdout?.destroy();
    // A stderr no longer read is never read to its end, which would close it.
    if (this.#muted) this.#child?.stderr?.destroy();
    this.#resolveExited();
  }

  /**
   * Marks the server failed with `failure`, unless it's stopping or ended already, and ends its
   * family, asking first.
   */
  #fail(failure: Failure): void {
    if (!this.#failed(failure)) return;
    // How it exited is noted as it exits.
    if (failure.kind !== 'exited') this.#log.add(`Lo: ${failureMessage(failure)}`);
    const child = this.#child;
    if (child?.pid === undefined) {
      this.#resolveExited();
      return;
    }
    if (this.#exit === undefined) this.#stopReading();
    this.#cleanup = this.#endGroup();
  }

  /**
   * Ends a server that broke a limit, whatever its state, a stop's included: nothing more it sends
   * is read, and its family is killed at once. It's marked failed unless it was stopping.
   */
  #breach(failure: Failure): void {
    if (this.#breached) return;
    this.#breached = true;
    this.#log.add(`Lo: ${failureMessage(failure)}`);
    this.#failed(failure);
    this.#deafen();
    this.#stopReading();
    if (this.#child?.pid !== undefined && this.#exit === undefined) this.#cleanup = this.#kill();
  }

  /** Marks the server failed, unless it's failed, stopping or stopped, and says whether it did. */
  #failed(failure: Failure): boolean {
    const { kind } = this.#state;
    if (kind === 'failed' || kind === 'stopping' || kind === 'stopped') return false;
    this.#setState({ kind: 'failed', failure });
    this.#queue.close('stopped');
    this.#resolveReady(false);
    return true;
  }

  /** Reads nothing more of what the server writes, stderr included, though Lo can still write to it. */
  #deafen(): void {
    this.#deaf = true;
    this.#muted = true;
    this.#child?.stdout?.pause();
    this.#child?.stderr?.pause();
  }

  /** Reads no more messages from the server, and ends the connection. Its stderr is still read. */
  #stopReading(): void {
    this.#deaf = true;
    this.#connection?.dispose();
    this.#child?.stdout?.destroy();
  }

  /**
   * Reads its family's memory, and kills it past its cap, whatever its state. If its memory can't
   * be read several times in a row, it's stopped, since its cap would go unenforced.
   */
  async #watchMemory(): Promise<void> {
    const group = this.#child?.pid;
    if (this.#readingMemory || group === undefined || this.#exit !== undefined) return;
    this.#readingMemory = true;
    try {
      const family = await this.#readFamily(group);
      if (this.#exit !== undefined) return;
      if (family.length === 0) throw new Error('none of its processes were found');
      const memory = family.reduce((sum, member) => sum + (member.resident ?? 0), 0);
      this.#memory = memory;
      this.#memoryUnread = 0;
      const cap = this.#spec.memoryCap ?? this.#limits.memoryCap;
      if (memory > cap) this.#breach({ kind: 'memory', cap });
    } catch (error) {
      this.#memoryUnread += 1;
      if (this.#memoryUnread === 1) this.#log.add(`Lo: couldn’t read its memory: ${String(error)}`);
      if (this.#memoryUnread >= this.#limits.memoryMisses) this.#fail({ kind: 'memoryUnread' });
    } finally {
      this.#readingMemory = false;
    }
  }

  /** A notification from the server. */
  #heard(method: string, params: unknown): void {
    switch (method) {
      case 'window/logMessage':
      case 'window/showMessage': {
        if (!isObject(params) || typeof params.message !== 'string') return;
        const level = params.type === 1 ? 'Error: ' : params.type === 2 ? 'Warning: ' : '';
        this.#log.add(`${level}${params.message}`);
        return;
      }
      default:
        // Diagnostics, telemetry and the rest: Lo shows none of them.
        return;
    }
  }

  /** A progress token the server made. */
  #track(params: unknown): void {
    const token = isObject(params) ? params.token : undefined;
    if (typeof token !== 'string' && typeof token !== 'number') return;
    if (this.#tokens.size < PROGRESS_TOKENS) this.#tokens.add(token);
  }

  /** Work-done progress on one of the server's tokens. */
  #progressed(params: unknown): void {
    if (!isObject(params) || !isObject(params.value)) return;
    const { token, value } = params;
    if ((typeof token !== 'string' && typeof token !== 'number') || !this.#tokens.has(token))
      return;
    const percentage = percent(value.percentage);
    switch (value.kind) {
      case 'begin': {
        const title = typeof value.title === 'string' ? value.title.slice(0, TITLE_LENGTH) : '';
        this.#progress.set(token, { title, percentage });
        break;
      }
      case 'report': {
        const open = this.#progress.get(token);
        if (open === undefined) return;
        this.#progress.set(token, { ...open, percentage: percentage ?? open.percentage });
        break;
      }
      case 'end':
        this.#progress.delete(token);
        this.#tokens.delete(token);
        break;
      default:
        return;
    }
    if (this.#state.kind === 'ready' || this.#state.kind === 'indexing') {
      this.#setState(this.#working());
    }
  }

  /** A request's deadline passed. */
  #missed(): void {
    const now = performance.now();
    this.#misses = this.#misses.filter((at) => now - at < this.#limits.missWindow);
    this.#misses.push(now);
    const { kind } = this.#state;
    if (this.#misses.length >= this.#limits.misses && (kind === 'ready' || kind === 'indexing')) {
      this.#setState({ kind: 'notAnswering' });
    }
  }

  /** The server answered a request in time. */
  #answered(): void {
    if (this.#state.kind !== 'notAnswering') return;
    this.#misses = [];
    this.#setState(this.#working());
  }

  /** `ready`, or `indexing` while the server says it's working. */
  #working(): State {
    const [progress] = this.#progress.values();
    return progress === undefined ? { kind: 'ready' } : { kind: 'indexing', progress };
  }

  /** Whether the server can be asked things. */
  #answering(): boolean {
    const { kind } = this.#state;
    return kind === 'ready' || kind === 'indexing' || kind === 'notAnswering';
  }

  /** The workspace's folders: the checkout, or the folder Lo made in its place. */
  #folders(): { uri: string; name: string }[] {
    const folder = this.#workspace?.folder ?? this.#roots[0];
    return folder === undefined ? [] : [{ uri: folderUri(folder), name: basename(folder) }];
  }

  /** Sends a notification, if the connection is still open. */
  #notify(method: string, params?: object): void {
    const connection = this.#connection;
    if (connection === undefined) return;
    try {
      connection.sendNotification(method, params).catch(() => undefined);
    } catch {
      // The connection has closed.
    }
  }

  #setState(state: State): void {
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return;
    this.#state = state;
    for (const listener of this.#listeners) {
      try {
        listener(state);
      } catch {
        // One listener's mistake doesn't keep the others from hearing.
      }
    }
  }
}

/**
 * The real path `path` will have once it's made: its nearest folder that's there, resolved, with
 * the rest after it.
 */
async function resolvedAhead(path: string): Promise<string> {
  const rest: string[] = [];
  for (let at = path; ; at = dirname(at)) {
    try {
      return join(await realpath(at), ...rest.toReversed());
    } catch (error) {
      if (dirname(at) === at) throw error;
      rest.push(basename(at));
    }
  }
}

/** The real path of `folder`, a toolchain's. */
async function resolved(folder: string): Promise<string> {
  try {
    return await realpath(folder);
  } catch {
    throw new Error(`${folder}, on its PATH, isn’t there.`);
  }
}

/** What the reader is told when `program` couldn't start. */
function startError(program: string, error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return `${program} isn’t there.`;
  if (code === 'EACCES') return `${program} can’t be run.`;
  return error instanceof Error ? error.message : String(error);
}

function percent(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 0 && value <= 100 ? Math.round(value) : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
