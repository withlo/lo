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
import { basename } from 'node:path';

import { ErrorCodes, ResponseError } from 'vscode-jsonrpc';
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
import { serverEnvironment, temporaryFolder } from './environment.ts';
import { FrameMeter } from './framing.ts';
import { Log } from './log.ts';
import { groupMemory } from './memory.ts';
import { checkProgram, groupEmptied, signalGroup, sleep, startProcess } from './process.ts';
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
  /** The checkout it runs on: its workspace's one folder, and where it runs. */
  readonly root: string;
  /** A folder of its own, its `HOME`, made if it isn't there. */
  readonly home: string;
  /** The folders of the toolchain it needs, first on its `PATH`. */
  readonly path: readonly string[];
  /** Its adapter's own variables, such as `GOPROXY=off`. */
  readonly variables?: Readonly<Record<string, string>> | undefined;
  /** The variables that set up the git it runs, each `GIT_*`, from `@lo/git`. */
  readonly git: Readonly<Record<string, string>>;
  /** What it gets for `workspace/configuration`, by section. */
  readonly settings?: unknown;
  /** Its `initializationOptions`. */
  readonly initializationOptions?: unknown;
  /** The most resident memory its process group may hold, in bytes. */
  readonly memoryCap?: number | undefined;
  /** Lo's version, which it hears in `clientInfo`. */
  readonly version?: string | undefined;
}

/** How long each part of a server's life may take, in milliseconds, and its memory cap. */
export interface Limits {
  /** The most resident memory a server's group may hold, in bytes, unless its spec says. */
  readonly memoryCap: number;
  /** How often its group's memory is read. */
  readonly memoryEvery: number;
  /** How long it has to answer `initialize`. */
  readonly initialize: number;
  /** How long a stop waits for its answer to `shutdown`. */
  readonly shutdown: number;
  /** How long a stop waits, after `exit`, for it to exit. */
  readonly exit: number;
  /** How long its group has after `SIGTERM`, before `SIGKILL`. */
  readonly term: number;
  /** How long a stop waits for it to go after `SIGKILL`. */
  readonly kill: number;
  /** How many deadlines it may miss within {@link Limits.missWindow} before it's `notAnswering`. */
  readonly misses: number;
  readonly missWindow: number;
}

/**
 * A stop takes at most `shutdown + exit + term + kill`: 4.5 s, inside a feature's 5 s to stop.
 */
export const LIMITS: Limits = {
  memoryCap: 4 * 1024 ** 3,
  memoryEvery: 5000,
  initialize: 60_000,
  shutdown: 1000,
  exit: 1000,
  term: 2000,
  kill: 500,
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

/** Starts a server, and returns it at once, `starting`. */
export function startServer(spec: ServerSpec, limits: Partial<Limits> = {}): Server {
  return new Server(spec, { ...LIMITS, ...limits });
}

/** How long a server may run on after its output ends, before it counts as failed. */
const CLOSED_GRACE = 1000;

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
  #state: State = { kind: 'starting' };
  readonly #listeners = new Set<(state: State) => void>();
  readonly #log = new Log();
  readonly #documents = new Documents();
  readonly #queue: Queue;
  /** The checkout's folder, as the system resolves it and as given. */
  #roots: string[] = [];
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
  #memory: number | undefined;
  #memoryTimer: ReturnType<typeof setInterval> | undefined;
  #readingMemory = false;
  /** Whether a failed read of its memory has been noted, so its log notes it once. */
  #memoryUnread = false;
  #misses: number[] = [];
  readonly #tokens = new Set<string | number>();
  readonly #progress = new Map<string | number, Progress>();
  #spawnedAt: number | undefined;
  #endedAt: number | undefined;
  #resolveReady: (ready: boolean) => void = () => undefined;
  #resolveExited: () => void = () => undefined;

  constructor(spec: ServerSpec, limits: Limits) {
    this.name = spec.name;
    this.#spec = spec;
    this.#limits = limits;
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
   * if it didn't, the server is as it was, and a new one is needed for `root`.
   */
  async moveTo(root: string): Promise<boolean> {
    const changes = this.#capabilities?.workspace?.workspaceFolders?.changeNotifications;
    if (!this.#answering() || (changes !== true && typeof changes !== 'string')) return false;
    const real = await realpath(root);
    if (!this.#answering()) return false;
    for (const uri of this.#documents.clear()) {
      this.#notify('textDocument/didClose', { textDocument: { uri } });
    }
    const removed = this.#folders();
    this.#roots = [...new Set([real, root])];
    this.#notify('workspace/didChangeWorkspaceFolders', {
      event: { added: this.#folders(), removed },
    });
    return true;
  }

  /**
   * Stops the server and everything it started: `shutdown` and `exit`, 1 s each, then `SIGTERM` to
   * its group, then `SIGKILL` 2 s later. Its requests are answered `stopped` at once. It resolves
   * once the group is gone, or once it's been killed, within 5 s. A server that failed stays
   * `failed`; any other is `stopped`.
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
    clearInterval(this.#memoryTimer);
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

  /** Asks the server to shut down and exit, then ends its group. */
  async #shutDown(): Promise<void> {
    const connection = this.#connection;
    if (connection !== undefined) {
      const { shutdown, exit } = this.#limits;
      try {
        await Promise.race([
          connection.sendRequest('shutdown').catch(() => undefined),
          this.#exited,
          sleep(shutdown),
        ]);
      } catch {
        // The connection has closed.
      }
      this.#notify('exit');
      await Promise.race([this.#exited, sleep(exit)]);
    }
    await this.#endGroup();
  }

  /** Stops what's left of the server's group: `SIGTERM`, then `SIGKILL` if anything outlasts it. */
  async #endGroup(): Promise<void> {
    const group = this.#child?.pid;
    if (group === undefined) return;
    if (signalGroup(group, 'SIGTERM') && !(await groupEmptied(group, this.#limits.term))) {
      signalGroup(group, 'SIGKILL');
    }
    await Promise.race([this.#exited, sleep(this.#limits.kill)]);
  }

  /** Kills the server's group at once. */
  async #kill(): Promise<void> {
    const group = this.#child?.pid;
    if (group === undefined) return;
    signalGroup(group, 'SIGKILL');
    await Promise.race([this.#exited, sleep(this.#limits.kill)]);
  }

  /** Checks what the server needs, then starts it. */
  async #launch(): Promise<void> {
    const spec = this.#spec;
    try {
      const root = await realpath(spec.root);
      this.#roots = [...new Set([root, spec.root])];
      await checkProgram(spec.program, this.#roots);
      const env = serverEnvironment({
        home: spec.home,
        root,
        path: spec.path,
        variables: spec.variables,
        git: spec.git,
      });
      await mkdir(spec.home, { recursive: true, mode: 0o700 });
      await mkdir(temporaryFolder(spec.home), { recursive: true, mode: 0o700 });
      if (this.#stopRequested) return;
      const child = startProcess(spec.program, spec.args, { env, cwd: root });
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
      void this.#initialize(root);
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
    stderr.setEncoding('utf8');
    stderr.on('data', (text: string) => this.#log.write(text));
    stderr.on('end', () => this.#log.end());
    // Measured before the reader reads each piece, so a message too large stops the server early.
    const meter = new FrameMeter();
    stdout.on('data', (chunk: Buffer) => {
      const wrong = meter.feed(chunk);
      if (wrong !== undefined) this.#fail({ kind: 'protocol', message: wrong });
    });
    const note = (message: string) => this.#log.add(`Lo: ${message}`);
    const connection = createMessageConnection(
      new StreamMessageReader(stdout),
      new StreamMessageWriter(stdin),
      { error: note, warn: note, info: () => undefined, log: () => undefined },
    );
    this.#connection = connection;
    connection.onRequest((method: string, params: unknown) => {
      const answer = reply(method, params, {
        settings: this.#spec.settings ?? null,
        folders: this.#folders(),
      });
      if (!answer.accepted) {
        note(`refused the server's ${method}: ${answer.message}`);
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
        this.#fail({
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

  /** Sends `initialize`, then `initialized` once it's answered. */
  async #initialize(root: string): Promise<void> {
    const connection = this.#connection;
    if (connection === undefined) return;
    const params = initializeParams({
      rootUri: folderUri(root),
      name: basename(root),
      version: this.#spec.version,
      initializationOptions: this.#spec.initializationOptions,
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
    this.#resolveExited();
  }

  /**
   * Marks the server failed with `failure`, unless it's stopping or ended already, and ends its
   * process and group: at once past its memory cap, else asking first.
   */
  #fail(failure: Failure): void {
    const { kind } = this.#state;
    if (kind === 'failed' || kind === 'stopping' || kind === 'stopped') return;
    this.#setState({ kind: 'failed', failure });
    // How it exited is noted as it exits.
    if (failure.kind !== 'exited') this.#log.add(`Lo: ${failureMessage(failure)}`);
    this.#queue.close('stopped');
    this.#resolveReady(false);
    clearInterval(this.#memoryTimer);
    const child = this.#child;
    if (child?.pid === undefined) {
      this.#resolveExited();
      return;
    }
    if (this.#exit === undefined) {
      // Nothing more it says is read.
      this.#connection?.dispose();
      child.stdout?.destroy();
    }
    this.#cleanup = failure.kind === 'memory' ? this.#kill() : this.#endGroup();
  }

  /** Reads its group's memory, and stops it past its cap. */
  async #watchMemory(): Promise<void> {
    const group = this.#child?.pid;
    if (this.#readingMemory || group === undefined || this.#exit !== undefined) return;
    this.#readingMemory = true;
    try {
      const memory = (await groupMemory([group])).get(group);
      if (memory === undefined || this.#exit !== undefined) return;
      this.#memory = memory;
      const cap = this.#spec.memoryCap ?? this.#limits.memoryCap;
      if (memory > cap) this.#fail({ kind: 'memory', cap });
    } catch (error) {
      if (!this.#memoryUnread) this.#log.add(`Lo: couldn't read its memory: ${String(error)}`);
      this.#memoryUnread = true;
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

  /** The workspace's folders: the checkout. */
  #folders(): { uri: string; name: string }[] {
    const root = this.#roots[0];
    return root === undefined ? [] : [{ uri: folderUri(root), name: basename(root) }];
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
