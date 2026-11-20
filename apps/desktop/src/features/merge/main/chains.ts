// A chain that can't be a GitHub stack, merged a layer at a time, as it runs: its bottom layer moves
// onto the root first when it isn't there, then merges, through the app's jobs; once GitHub says it
// merged, each layer on it moves onto the root, in order. After a queue entry Lo reads the pull
// request until it merges, for 6 hours at most, or leaves the queue; after a lost answer, for 15
// minutes. Each move reads the base branch first and refuses one someone else moved since, and the
// first that doesn't go stops the rest: nothing is put back, and a merge isn't undone. A run lasts
// only while Lo is open. Nothing here calls Electron or GitHub.

import {
  describeMergeRefusal,
  GithubError,
  isRefusal,
  type ConversionStep,
  type MergeRefusal,
  type RepoRef,
  type StepDone,
} from '@lo/github';

import type { BaseMove, MoveStatus, Progress, Together } from '../contract.ts';
import { numbers } from './together.ts';

/** Where the merged pull request stands, as a read of it says. */
export type Looked = 'merged' | 'queued' | 'open' | 'closed';

export interface ChainOptions {
  readonly repo: RepoRef;
  /** The bottom layer, which merges. */
  readonly number: number;
  readonly together: Extract<Together, { kind: 'chain' }>;
  /** Moves a pull request's base branch, as a conversion's step does, checking it first. */
  readonly retarget: (
    repo: RepoRef,
    step: ConversionStep,
    signal: AbortSignal,
  ) => Promise<StepDone | MergeRefusal>;
  /** Reads where the bottom layer stands now. */
  readonly look: (signal: AbortSignal) => Promise<Looked>;
  /** Says the run changed, for the window. */
  readonly changed: () => void;
  /** Called once, as the run ends, done or stopped. */
  readonly ended: () => void;
  readonly log: (line: string) => void;
  /** How long between reads while it waits for the merge, in milliseconds: a minute. */
  readonly every?: number;
  /** How long it waits for a merge from the queue, in milliseconds: 6 hours. */
  readonly queueFor?: number;
  /** How long it waits for a merge whose answer was lost, in milliseconds: 15 minutes. */
  readonly lostFor?: number;
  /** A clock that only moves forward. */
  readonly monotonic?: () => number;
}

/** A base branch change, as the run has it. */
interface Move {
  readonly move: BaseMove;
  readonly before: boolean;
  status: MoveStatus;
  detail: string | null;
}

type Phase = Extract<Progress, { kind: 'chain' }>['phase'];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One chain's merge, a layer at a time. */
export class ChainRun {
  readonly #options: ChainOptions;
  readonly #moves: Move[];
  readonly #stopping = new AbortController();
  readonly #monotonic: () => number;
  #phase: Phase;
  #text: string | null = null;
  #over = false;
  /**
   * Whether the layers on it began to move, which happens once: whichever hears first that it
   * merged, GitHub's answer or a read of the pull request, starts it, and nothing after can.
   */
  #moving = false;
  /** While a wait reads the pull request, what it waits for, and how to make it wait for more. */
  #waiting: { readonly why: 'queue' | 'lost'; readonly to: (why: 'queue') => void } | undefined;

  constructor(options: ChainOptions) {
    this.#options = options;
    this.#monotonic = options.monotonic ?? (() => performance.now());
    const { before, after } = options.together;
    this.#moves = [
      ...(before ? [{ move: before, before: true, status: 'todo' as const, detail: null }] : []),
      ...after.map((move) => ({ move, before: false, status: 'todo' as const, detail: null })),
    ];
    this.#phase = before ? 'before' : 'merging';
  }

  /** Whether it's over, done or stopped. */
  get over(): boolean {
    return this.#over;
  }

  /** How it goes, for the window. */
  view(): Progress {
    return {
      kind: 'chain',
      phase: this.#phase,
      moves: this.#moves.map((move) => ({
        move: { ...move.move },
        before: move.before,
        status: move.status,
        detail: move.detail,
      })),
      needsRebase: [...this.#options.together.needsRebase],
      text: this.#text,
    };
  }

  /**
   * Moves the bottom layer onto the root, when the plan says to, before it merges: whether the
   * merge may go now. When it may not, the run has stopped, saying why.
   */
  async moveFirst(): Promise<boolean> {
    const first = this.#moves.find((move) => move.before);
    if (!first) return true;
    const went = await this.#run(first);
    if (this.#over) return false;
    if (!went) {
      this.#skipRest();
      const { number } = this.#options;
      this.#stop(
        first.status === 'unknown'
          ? `Lo didn’t merge #${number}, since it can’t tell whether its base branch moved.`
          : `Lo didn’t merge #${number}, since its base branch didn’t move.`,
      );
      return false;
    }
    this.#phase = 'merging';
    this.#changed();
    return true;
  }

  /**
   * GitHub says the bottom layer merged, or a read shows it: the layers on it move onto the root,
   * once, however many times it's heard.
   */
  merged(): void {
    if (this.#over || this.#moving) return;
    this.#moving = true;
    void this.#moveAfter();
  }

  /** It joined the merge queue: the layers on it move once it merges. */
  enqueued(): void {
    if (this.#over || this.#moving) return;
    this.#waitFor('queue');
  }

  /** Lo can't tell whether it merged: it reads the pull request for a while to find out. */
  unsure(): void {
    if (this.#over || this.#moving) return;
    this.#waitFor('lost');
  }

  /**
   * GitHub refused the merge, or it failed: nothing more is done, and nothing is put back. Once a
   * read showed it merged, the layers on it go on moving.
   */
  failed(): void {
    if (this.#over || this.#moving) return;
    this.#skipRest();
    const kept = this.#moves.some((move) => move.before && move.status === 'done');
    this.#stop(
      kept
        ? `#${this.#options.number} didn’t merge, and stays on ${this.#options.together.before?.to ?? ''}. Lo moved nothing more.`
        : `#${this.#options.number} didn’t merge, so Lo moved nothing.`,
    );
  }

  /** Lo is quitting: nothing more is sent. */
  stop(): void {
    if (this.#over) return;
    this.#stopping.abort(new Error('Lo is quitting.'));
    this.#skipRest();
    this.#stop('Lo stopped before it was done.');
  }

  /**
   * Reads the pull request every so often until it merges: while it's in the merge queue, for 6
   * hours at most, and after a lost answer, for 15 minutes, or 6 hours once it shows in the queue.
   */
  #waitFor(first: 'queue' | 'lost'): void {
    // One wait at a time: one already reading waits for the queue from now, when it's asked to.
    if (this.#waiting) {
      if (first === 'queue' && this.#waiting.why === 'lost') this.#waiting.to('queue');
      return;
    }
    const { number } = this.#options;
    let why = first;
    let deadline = 0;
    const waiting = (now: 'queue' | 'lost') => {
      why = now;
      this.#waiting = { why: now, to: waiting };
      deadline =
        this.#monotonic() +
        (now === 'queue'
          ? (this.#options.queueFor ?? 6 * 60 * 60_000)
          : (this.#options.lostFor ?? 15 * 60_000));
      this.#phase = 'waiting';
      this.#text =
        now === 'queue'
          ? `#${number} is in the merge queue. Lo moves the layers on it once it merges, while Lo is open.`
          : `Lo can’t tell whether #${number} merged, and reads it to find out.`;
      this.#changed();
    };
    waiting(first);
    const every = this.#options.every ?? 60_000;
    const { signal } = this.#stopping;
    const look = async (): Promise<void> => {
      for (;;) {
        if (this.#over || this.#moving) return;
        if (this.#monotonic() >= deadline) {
          this.#skipRest();
          this.#stop(
            why === 'queue'
              ? `#${number} didn’t merge within 6 hours of joining the merge queue, so Lo moved nothing.`
              : `Lo couldn’t tell within 15 minutes whether #${number} merged, so it moved nothing.`,
          );
          return;
        }
        await pause(Math.min(every, Math.max(0, deadline - this.#monotonic())), signal);
        if (this.#over || this.#moving) return;
        let looked: Looked;
        try {
          looked = await this.#options.look(signal);
        } catch (error) {
          if (signal.aborted) return;
          this.#options.log(`reading #${number}: ${describe(error)}`);
          continue;
        }
        if (this.#over || this.#moving) return;
        switch (looked) {
          case 'merged':
            this.merged();
            return;
          case 'queued':
            if (why === 'lost') waiting('queue');
            continue;
          case 'open':
            // Out of the queue without merging. After a lost answer, it may merge yet.
            if (why === 'queue') {
              this.#skipRest();
              this.#stop(`#${number} left the merge queue without merging, so Lo moved nothing.`);
              return;
            }
            continue;
          case 'closed':
            this.#skipRest();
            this.#stop(`#${number} was closed without merging, so Lo moved nothing.`);
            return;
          default:
            looked satisfies never;
            continue;
        }
      }
    };
    void look().finally(() => {
      this.#waiting = undefined;
    });
  }

  /**
   * Moves each layer on the merged one onto the root, in order, stopping at the first that fails.
   * Only {@link ChainRun.merged} starts it, once.
   */
  async #moveAfter(): Promise<void> {
    if (this.#over) return;
    this.#phase = 'moving';
    this.#text = null;
    this.#changed();
    for (const move of this.#moves) {
      if (move.before || move.status !== 'todo') continue;
      const went = await this.#run(move);
      if (this.#over) return;
      if (!went) {
        this.#skipRest();
        const moved = this.#moves.filter((each) => !each.before && each.status === 'done');
        const said =
          moved.length === 0
            ? ''
            : ` It moved ${numbers(moved.map((each) => each.move.pr))} onto ${move.move.to}.`;
        this.#stop(
          `#${this.#options.number} merged, but Lo stopped moving the layers on it.${said}`,
        );
        return;
      }
    }
    this.#phase = 'done';
    const { needsRebase } = this.#options.together;
    const into = this.#moves.at(-1)?.move.to ?? this.#options.together.before?.to;
    this.#text =
      needsRebase.length === 0 || into === undefined
        ? null
        : `${numbers(needsRebase)} now ${needsRebase.length === 1 ? 'points' : 'point'} at ${into} and ${needsRebase.length === 1 ? 'needs' : 'need'} a rebase.`;
    this.#end();
  }

  /** Sends one move, saying how it went: whether it's where the plan wants it now. */
  async #run(move: Move): Promise<boolean> {
    move.status = 'now';
    this.#changed();
    const { signal } = this.#stopping;
    let done: StepDone | MergeRefusal;
    try {
      done = await this.#options.retarget(
        this.#options.repo,
        { kind: 'retarget', retarget: move.move },
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        move.status = 'skipped';
        return false;
      }
      const lost = error instanceof GithubError && error.mayHavePosted();
      move.status = lost ? 'unknown' : 'failed';
      move.detail = lost
        ? `Lo can’t tell whether #${move.move.pr} moved: ${describe(error)}`
        : describe(error);
      this.#changed();
      return false;
    }
    if (isRefusal(done)) {
      move.status = 'failed';
      move.detail =
        done.refusal === 'baseChanged'
          ? `#${move.move.pr} is on ${done.now} now, moved since Lo read it, so Lo left it.`
          : `${describeMergeRefusal(done)}.`;
      this.#changed();
      return false;
    }
    move.status = done.kind === 'alreadyThere' ? 'unchanged' : 'done';
    this.#changed();
    return true;
  }

  /** Marks every move not sent as never to be. */
  #skipRest(): void {
    for (const move of this.#moves) if (move.status === 'todo') move.status = 'skipped';
  }

  #stop(text: string): void {
    this.#phase = 'stopped';
    this.#text = text;
    this.#end();
  }

  #end(): void {
    if (this.#over) return;
    this.#over = true;
    this.#stopping.abort(new Error('The run is over.'));
    this.#changed();
    this.#options.ended();
  }

  #changed(): void {
    try {
      this.#options.changed();
    } catch (error) {
      this.#options.log(`a chain's merge: ${describe(error)}`);
    }
  }
}

/** Waits `wait` milliseconds, or until `signal` gives up. */
function pause(wait: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, wait);
    signal.addEventListener('abort', done, { once: true });
  });
}
