// A tab's diff in the window, before and while it's drawn: main's versions, each file's texts asked
// for in batches, first files first, sent to the background process to diff and highlight, and
// what comes back kept, so the view can be drawn again as it was when the tab comes back. A new
// head on screen starts again. When the local copy replaces GitHub's diff, each file is swapped in
// place as its diff arrives, unless the files themselves changed, in which case the view is drawn
// anew once they're all in. Nothing here touches the DOM: the view hears through a sink.

import { splitLines, type FileDiff, type MovedBlock } from '@lo/diff';

import { fileKey } from '../../tree/contract.ts';
import type { DiffState, FileText, FileVersions, Source } from '../contract.ts';
import type { ChangedRuns, FileJob, FileResult, Gap } from '../jobs.ts';
import { inOrder } from './files.ts';
import { FileIds } from './ids.ts';

/** What the loader asks main and the background process for. */
export interface LoaderWork {
  texts(input: { at: string; from: Source; files: number[] }): Promise<FileText[]>;
  /** The background process's jobs, each stopped once `signal` aborts. */
  files(
    input: { files: FileJob[]; whitespace: boolean; highlight: boolean; budget: number },
    signal: AbortSignal,
  ): Promise<FileResult[]>;
  moves(input: { files: ChangedRuns[] }, signal: AbortSignal): Promise<MovedBlock[]>;
  /** The order the left panel lists the changed files in, by key, to load them in. */
  order(): readonly string[];
  log(message: string, error: unknown): void;
}

/** A file of the diff, as main listed it. */
export interface Entry {
  /** Its place in main's list. */
  readonly place: number;
  readonly versions: FileVersions;
  /** Its key, as the tree names it: its path's text, or a NUL and its bytes in hex. */
  readonly key: string;
  /** Its name in the view, the same for its path in every view of the tab. */
  readonly id: string;
}

/** A file as the view shows it, once its diff is in. */
export interface Shown {
  readonly from: Source;
  readonly lines: { readonly old: readonly string[]; readonly new: readonly string[] };
  readonly gaps: readonly Gap[];
  readonly diff: FileDiff;
  readonly tokens: {
    readonly old?: Uint32Array | undefined;
    readonly new?: Uint32Array | undefined;
  };
  readonly changes: ChangedRuns;
  /** Whether changes to whitespace alone showed when it was diffed. */
  readonly whitespace: boolean;
}

/** Moved code, its ends named by the view's ids. */
export interface Moved {
  from: { file: string; first: number; last: number };
  to: { file: string; first: number; last: number };
  words: MovedBlock['words'];
}

/** What the view, once it's drawn, hears of what arrives. */
export interface Sink {
  /** A file's lines, its diff and its highlighting: one kept out, or one swapped in place. */
  lines(id: string, shown: Shown): void;
  /** A file's diff alone, its lines unchanged, as after whitespace is hidden or shown. */
  diff(id: string, diff: FileDiff): void;
  /** A file asked for couldn't be loaded. */
  failed(id: string): void;
  moves(moves: readonly Moved[]): void;
}

/** The files to draw, once every one that shows its lines has them. */
export interface Ready {
  readonly at: string;
  readonly from: Source;
  readonly entries: readonly Entry[];
}

/** How the files to draw stand, for whoever draws them. */
export interface Snapshot {
  readonly state: DiffState | undefined;
  readonly ready: Ready | undefined;
  /** How many of the files that show their lines have them, of how many. */
  readonly progress: { readonly done: number; readonly of: number };
  /** Whether changes to whitespace alone show. */
  readonly whitespace: boolean;
}

/** The most text one batch asks for, as main's sizes say. */
const BATCH_BYTES = 1024 * 1024;
/** The most files one batch asks for. */
const BATCH_FILES = 48;
/** The batches being diffed at once. */
const IN_FLIGHT = 4;
/** How long a file's diff may take in a batch, and once it's asked for on its own. */
const BUDGET = 1000;
const LOADED_BUDGET = 5000;

/** Whether a file shows its lines from the start: not kept out, and with lines to show. */
export function showsLines(versions: FileVersions): boolean {
  return versions.start === 'shown' || versions.start === 'collapsed';
}

/** A file's key, as the tree names it, which is never long. */
export function keyOf(versions: FileVersions): string {
  return fileKey(versions.path);
}

/** What's being loaded: of one head, from one source. */
interface Run {
  readonly at: string;
  readonly from: Source;
  readonly entries: readonly Entry[];
  /** Stops its jobs in the background process, as a new run takes its place or the tab closes. */
  readonly controller: AbortController;
  readonly stopped: boolean;
}

/** A run of `entries`, at a head, from a source. */
function runOf(at: string, from: Source, entries: readonly Entry[]): Run {
  const controller = new AbortController();
  return {
    at,
    from,
    entries,
    controller,
    get stopped() {
      return controller.signal.aborted;
    },
  };
}

export class Loader {
  readonly #work: LoaderWork;
  readonly ids = new FileIds();
  #state: DiffState | undefined;
  #run: Run | undefined;
  #ready: Ready | undefined;
  /** What's been worked out of each file at the head on screen, by id. */
  readonly #shown = new Map<string, Shown>();
  readonly #failed = new Set<string>();
  #moves: readonly Moved[] = [];
  #whitespace = true;
  /** Whether the view has said whether to show whitespace, which loading waits for. */
  #whitespaceKnown = false;
  #sink: Sink | undefined;
  readonly #listeners = new Set<() => void>();
  #snapshot: Snapshot = {
    state: undefined,
    ready: undefined,
    progress: { done: 0, of: 0 },
    whitespace: true,
  };

  constructor(work: LoaderWork) {
    this.#work = work;
  }

  /** What there is to draw now. The same object until something changes. */
  snapshot(): Snapshot {
    return this.#snapshot;
  }

  /** Calls `listener` whenever the snapshot changes. Returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** What's been worked out of a file, by its id. */
  shown(id: string): Shown | undefined {
    return this.#shown.get(id);
  }

  /** Whether changes to whitespace alone show. */
  whitespaceShown(): boolean {
    return this.#whitespace;
  }

  /** Whether a file asked for couldn't be loaded. */
  failed(id: string): boolean {
    return this.#failed.has(id);
  }

  /** The moves, once found. */
  moves(): readonly Moved[] {
    return this.#moves;
  }

  /** Lets the drawn view hear what arrives, or no view, as it goes. */
  attach(sink: Sink | undefined): void {
    this.#sink = sink;
  }

  /** Takes what main says of the diff. */
  take(state: DiffState): void {
    this.#state = state;
    const { at } = state;
    if (at === null || this.#run?.at !== at) this.#reset();
    this.#startIfDue();
    this.#changed();
  }

  /** Starts loading what main last said, unless it's under way, once whitespace is known. */
  #startIfDue(): void {
    const state = this.#state;
    if (!state || !this.#whitespaceKnown) return;
    const { at, from, files } = state;
    if (at === null || from === null || files === null) return;
    if (this.#run?.from !== from || this.#run.at !== at) this.#start(at, from, files);
  }

  /** Shows or hides changes to whitespace alone, diffing the files from the local copy again. */
  setWhitespace(shown: boolean): void {
    if (!this.#whitespaceKnown) {
      this.#whitespaceKnown = true;
      this.#whitespace = shown;
      this.#startIfDue();
      this.#changed();
      return;
    }
    if (this.#whitespace === shown) return;
    this.#whitespace = shown;
    this.#changed();
    const run = this.#run;
    if (!run || run.from !== 'local') return;
    const again = run.entries.filter((entry) => {
      const kept = this.#shown.get(entry.id);
      return kept?.from === 'local' && kept.whitespace !== shown;
    });
    void this.#rediff(run, again, shown).catch((error: unknown) =>
      this.#work.log('Lo couldn’t diff the files again:', error),
    );
  }

  /** Loads a file kept out, as `za` asks: its texts, then its diff, given to the view. */
  load(id: string): void {
    const run = this.#run;
    const entry = run?.entries.find((each) => each.id === id);
    if (!run || !entry) {
      this.#sink?.failed(id);
      return;
    }
    this.#failed.delete(id);
    void this.#batch(run, [entry], LOADED_BUDGET)
      .then(async () => {
        if (run.stopped) return;
        if (this.#shown.get(id)?.from !== run.from) {
          this.#failed.add(id);
          this.#sink?.failed(id);
          return;
        }
        // Its changed lines may be code moved from or to another file.
        await this.#findMoves(run);
      })
      .catch((error: unknown) => {
        this.#work.log('Lo couldn’t load a file:', error);
        if (run.stopped) return;
        this.#failed.add(id);
        this.#sink?.failed(id);
      });
  }

  /** Stops what's under way, as the tab closes. */
  stop(): void {
    this.#run?.controller.abort();
    this.#run = undefined;
    this.#sink = undefined;
    this.#listeners.clear();
  }

  #reset(): void {
    this.#run?.controller.abort();
    this.#run = undefined;
    this.#ready = undefined;
    this.#shown.clear();
    this.#failed.clear();
    this.#moves = [];
  }

  #start(at: string, from: Source, files: readonly FileVersions[]): void {
    this.#run?.controller.abort();
    const entries = files.map((versions, place) => {
      const key = keyOf(versions);
      return { place, versions, key, id: this.ids.of(key) };
    });
    const ready = this.#ready;
    // The view drawn from GitHub's files takes the local copy's in place when they're the same
    // files, starting out the same way; otherwise it's drawn anew once they're all in.
    const inPlace =
      ready !== undefined &&
      ready.at === at &&
      ready.entries.length === entries.length &&
      ready.entries.every((each, index) => {
        const other = entries[index];
        return other?.id === each.id && other.versions.start === each.versions.start;
      });
    const run = runOf(at, from, entries);
    this.#run = run;
    this.#failed.clear();
    if (inPlace) this.#ready = { at, from, entries };
    void this.#load(run).catch((error: unknown) => {
      if (!run.stopped) this.#work.log('Lo couldn’t load the diff:', error);
    });
  }

  /** Loads every file that shows its lines, in the left panel's order, a batch at a time. */
  async #load(run: Run): Promise<void> {
    const wanted = this.#ordered(run.entries.filter((entry) => showsLines(entry.versions)));
    const batches = batchesOf(wanted);
    this.#readyIfDone(run);
    const going = new Set<Promise<void>>();
    for (const batch of batches) {
      if (run.stopped) return;
      const next = this.#batch(run, batch, BUDGET)
        .catch((error: unknown) => this.#oneByOne(run, batch, error))
        .finally(() => going.delete(next));
      going.add(next);
      if (going.size >= IN_FLIGHT) await Promise.race(going);
    }
    await Promise.all(going);
    if (run.stopped) return;
    await this.#findMoves(run);
  }

  /**
   * A batch failed as a whole, as when one file in it takes all the job's memory: each of its
   * files is tried on its own, so one can't keep the rest from showing.
   */
  async #oneByOne(run: Run, batch: readonly Entry[], error: unknown): Promise<void> {
    if (run.stopped) return;
    this.#work.log('Lo couldn’t load part of the diff, so it tries each file on its own:', error);
    for (const entry of batch) {
      if (run.stopped) return;
      if (batch.length === 1) {
        this.#fail(run, entry, describe(error));
        continue;
      }
      try {
        await this.#batch(run, [entry], BUDGET);
      } catch (alone) {
        if (!run.stopped) this.#fail(run, entry, describe(alone));
      }
    }
    this.#readyIfDone(run);
    this.#changed();
  }

  /** `entries` in the left panel's order, then any it doesn't list, in main's. */
  #ordered(entries: readonly Entry[]): Entry[] {
    return inOrder(entries, this.#work.order(), (key) => this.ids.find(key));
  }

  /** Asks for a batch's texts, then diffs and highlights them, and keeps and gives what came. */
  async #batch(run: Run, batch: readonly Entry[], budget: number): Promise<void> {
    const texts = await this.#work.texts({
      at: run.at,
      from: run.from,
      files: batch.map((entry) => entry.place),
    });
    if (run.stopped) return;
    const jobs: { entry: Entry; job: FileJob; lines?: Shown['lines'] }[] = [];
    batch.forEach((entry, index) => {
      const text = texts[index];
      const path = entry.versions.path.text;
      if (text?.kind === 'patch') {
        jobs.push({ entry, job: { kind: 'patch', path, patch: text.patch } });
      } else if (text?.kind === 'texts') {
        jobs.push({
          entry,
          job: { kind: 'texts', path, old: text.old, new: text.new },
          lines: { old: splitLines(text.old ?? ''), new: splitLines(text.new ?? '') },
        });
      } else {
        this.#fail(run, entry, text?.why ?? 'main sent nothing for it');
      }
    });
    if (jobs.length === 0) return;
    const whitespace = this.#whitespace;
    const results = await this.#work.files(
      { files: jobs.map(({ job }) => job), whitespace, highlight: true, budget },
      run.controller.signal,
    );
    if (run.stopped) return;
    jobs.forEach(({ entry, lines }, index) => {
      const result = results[index];
      if (!result?.ok) {
        this.#fail(run, entry, result?.why ?? 'the background process sent nothing for it');
        return;
      }
      const shownLines = result.lines ?? lines;
      if (!shownLines) {
        this.#fail(run, entry, 'it came without its lines');
        return;
      }
      const shown: Shown = {
        from: run.from,
        lines: shownLines,
        gaps: result.gaps ?? [],
        diff: result.diff,
        tokens: result.tokens,
        changes: result.changes,
        whitespace: run.from === 'github' || whitespace,
      };
      this.#shown.set(entry.id, shown);
      this.#failed.delete(entry.id);
      if (this.#ready?.at === run.at && this.#ready.from === run.from)
        this.#sink?.lines(entry.id, shown);
    });
    this.#readyIfDone(run);
    this.#changed();
  }

  #fail(run: Run, entry: Entry, why: string): void {
    this.#work.log(`Lo couldn’t show ${entry.versions.path.text}:`, why);
    this.#failed.add(entry.id);
    if (this.#ready?.at === run.at && this.#ready.from === run.from) this.#sink?.failed(entry.id);
  }

  /** Once every file that shows its lines has them, or couldn't, the run's files can be drawn. */
  #readyIfDone(run: Run): void {
    if (run.stopped || (this.#ready?.at === run.at && this.#ready.from === run.from)) return;
    const done = run.entries.every(
      (entry) =>
        !showsLines(entry.versions) ||
        this.#failed.has(entry.id) ||
        this.#shown.get(entry.id)?.from === run.from,
    );
    if (done) this.#ready = { at: run.at, from: run.from, entries: run.entries };
  }

  /** Finds the code the run's files move, and gives it to the view. */
  async #findMoves(run: Run): Promise<void> {
    const none = { deleted: [], added: [] };
    const moves = await this.#work.moves(
      {
        // Generated files and lockfiles churn: code moved there isn't the author's.
        files: run.entries.map((entry) =>
          entry.versions.generated === null ? (this.#shown.get(entry.id)?.changes ?? none) : none,
        ),
      },
      run.controller.signal,
    );
    if (run.stopped) return;
    this.#moves = moves.flatMap((move) => {
      const from = run.entries[move.from.file];
      const to = run.entries[move.to.file];
      if (!from || !to) return [];
      return [
        {
          from: { file: from.id, first: move.from.first, last: move.from.last },
          to: { file: to.id, first: move.to.first, last: move.to.last },
          words: move.words,
        },
      ];
    });
    this.#sink?.moves(this.#moves);
    this.#changed();
  }

  /** Diffs files again with whitespace shown or hidden, keeping their lines and highlighting. */
  async #rediff(run: Run, entries: readonly Entry[], whitespace: boolean): Promise<void> {
    for (const batch of batchesOf(this.#ordered(entries))) {
      if (run.stopped || this.#whitespace !== whitespace) return;
      const texts = await this.#work.texts({
        at: run.at,
        from: run.from,
        files: batch.map((entry) => entry.place),
      });
      const jobs = batch.flatMap((entry, index) => {
        const text = texts[index];
        if (text?.kind !== 'texts') return [];
        const job: FileJob = {
          kind: 'texts',
          path: entry.versions.path.text,
          old: text.old,
          new: text.new,
        };
        return [{ entry, job }];
      });
      if (jobs.length === 0) continue;
      const results = await this.#work.files(
        { files: jobs.map(({ job }) => job), whitespace, highlight: false, budget: BUDGET },
        run.controller.signal,
      );
      if (run.stopped || this.#whitespace !== whitespace) return;
      jobs.forEach(({ entry }, index) => {
        const result = results[index];
        const kept = this.#shown.get(entry.id);
        if (!result?.ok || !kept) return;
        this.#shown.set(entry.id, {
          ...kept,
          diff: result.diff,
          changes: result.changes,
          whitespace,
        });
        this.#sink?.diff(entry.id, result.diff);
      });
    }
    if (!run.stopped) await this.#findMoves(run);
  }

  #changed(): void {
    const run = this.#run;
    const counted = run?.entries.filter((entry) => showsLines(entry.versions)) ?? [];
    const done = counted.filter(
      (entry) => this.#shown.get(entry.id)?.from === run?.from || this.#failed.has(entry.id),
    ).length;
    const snapshot: Snapshot = {
      state: this.#state,
      ready: this.#ready,
      progress: { done, of: counted.length },
      whitespace: this.#whitespace,
    };
    const before = this.#snapshot;
    if (
      before.state === snapshot.state &&
      before.ready === snapshot.ready &&
      before.progress.done === done &&
      before.progress.of === counted.length &&
      before.whitespace === snapshot.whitespace
    ) {
      return;
    }
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Entries in batches of a megabyte or so of text, as main's sizes say, or 48 files at most. */
function batchesOf(entries: readonly Entry[]): Entry[][] {
  const batches: Entry[][] = [];
  let batch: Entry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const size = (entry.versions.old?.size ?? 0) + (entry.versions.new?.size ?? 0);
    if (batch.length > 0 && (batch.length >= BATCH_FILES || bytes + size > BATCH_BYTES)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(entry);
    bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
