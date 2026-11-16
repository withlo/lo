// A language server for the pool's tests, standing in for one: its state, memory and uptime set by
// the test, and a stop that can take as long as the test says, as a real one's can take seconds.
// Its process is gone once a stop it was asked for has finished.

import type { Answer, ServerSpec, State } from '@lo/lsp';

import type { Running } from '../servers.ts';

export class StandIn implements Running {
  capabilities: Running['capabilities'] = {};
  state: State = { kind: 'starting' };
  uptime = 0;
  memory: number | undefined;
  log: readonly string[] = [];
  /** Whether it takes a change to its workspace's folders. */
  moves = true;
  readonly moved: string[] = [];
  /** Whether it was asked to stop. */
  stopped = false;
  /** Whether a stop waits for {@link StandIn.exit}. */
  slow = false;
  /** Whether a move waits for {@link StandIn.resolved}, as a real one resolves the folder first. */
  slowMoves = false;
  /** Whether its process has gone, once a stop it was asked for finished. */
  exited = false;
  readonly spec: ServerSpec;
  readonly #listeners = new Set<(state: State) => void>();
  #stopping: Promise<void> | undefined;
  #exit: (() => void) | undefined;
  #resolve: (() => void) | undefined;

  constructor(spec: ServerSpec) {
    this.spec = spec;
  }

  onState(listener: (state: State) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  set(state: State): void {
    this.state = state;
    for (const listener of this.#listeners) listener(state);
  }

  open(): boolean {
    return true;
  }

  request(): Promise<Answer> {
    return Promise.resolve({ ok: false, why: 'notReady' });
  }

  pathOf(): string | undefined {
    return undefined;
  }

  /** Moves to `root`, as `@lo/lsp`'s does: told, into `moved`, only if `still` says so then. */
  moveTo(root: string, still: () => boolean = () => true): Promise<boolean> {
    const move = () => {
      if (!this.moves || !still()) return false;
      this.moved.push(root);
      return true;
    };
    if (!this.slowMoves) return Promise.resolve(move());
    return new Promise((resolve) => {
      this.#resolve = () => resolve(move());
    });
  }

  /** Lets a slow move go on, once the folder it's moving to is resolved. */
  resolved(): void {
    this.#resolve?.();
    this.#resolve = undefined;
  }

  stop(): Promise<void> {
    this.#stopping ??= new Promise<void>((resolve) => {
      this.stopped = true;
      const gone = () => {
        this.exited = true;
        this.set({ kind: 'stopped' });
        resolve();
      };
      if (!this.slow) {
        gone();
        return;
      }
      this.set({ kind: 'stopping' });
      this.#exit = gone;
    });
    return this.#stopping;
  }

  /** Lets a slow stop finish: its process goes. */
  exit(): void {
    this.#exit?.();
    this.#exit = undefined;
  }
}
