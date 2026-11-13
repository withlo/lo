// A tab's diff in the window, before and while it's drawn: main's versions, each file's texts asked
// for in batches, first files first, sent to the background process to diff and highlight, and
// what comes back kept, so the view can be drawn again as it was when the tab comes back. A new
// head on screen starts again. When the local copy replaces GitHub's diff, each file is swapped in
// place as its diff arrives, unless the files themselves changed, in which case the view is drawn
// anew once they're all in; so are files that come to show from where the reader left off. Nothing
// here touches the DOM: the view hears through a sink.

import { splitLines, type FileDiff, type MovedBlock } from '@lo/diff';

import { type Changed, fileKey } from '../../tree/contract.ts';
import type { DiffState, FileText, FileVersions, Source } from '../contract.ts';
import {
  HIGHLIGHTS_PER_JOB,
  JOB_LINES,
  patchReach,
  TAB_LINES,
  type ChangedRuns,
  type FileJob,
  type FileResult,
  type Gap,
} from '../jobs.ts';
import { changeOf, inOrder } from './files.ts';
import { FileIds } from './ids.ts';

/** What the loader asks main and the background process for. */
export interface LoaderWork {
  texts(input: {
    at: string;
    comparison: string | null;
    compareFrom: string | null;
    since: string | null;
    from: Source;
    files: number[];
  }): Promise<FileText[]>;
  /** The background process's jobs, each stopped once `signal` aborts. */
  files(
    input: { files: FileJob[]; whitespace: boolean; highlight: boolean; budget: number },
    signal: AbortSignal,
  ): Promise<FileResult[]>;
  moves(input: { files: ChangedRuns[] }, signal: AbortSignal): Promise<MovedBlock[]>;
  highlight(
    input: { files: { path: string; old: string | null; new: string | null }[] },
    signal: AbortSignal,
  ): Promise<{ old?: Uint32Array | undefined; new?: Uint32Array | undefined }[]>;
  /** The order the left panel lists these changed files in, by key, to load them in. */
  order(changes: readonly Changed[]): readonly string[];
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
  /** A file's highlighting, which comes after its diff. */
  tokens(id: string, tokens: Shown['tokens']): void;
}

/** The files to draw, once every one that shows its lines has them. */
export interface Ready {
  readonly at: string;
  /** The two revisions compared, by key, when it isn't the whole pull request. */
  readonly comparison: string | null;
  /** The commit a stack's layer is compared with, when it's that. */
  readonly compareFrom: string | null;
  readonly from: Source;
  readonly entries: readonly Entry[];
  /** Whether GitHub listed only some of the files, as main said when they started loading. */
  readonly partial: boolean;
  /**
   * Whether the files are GitHub's, and GitHub couldn't compare the head with where a stack's layer,
   * or a run of its layers, starts, so they're the pull request's own, as main said when they
   * started loading.
   */
  readonly uncompared: boolean;
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
const IN_FLIGHT = 6;
/** The most text one batch highlights. */
const HIGHLIGHT_BYTES = 2 * 1024 * 1024;
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

/**
 * What's being loaded: of one head, in one comparison, from one start, with one set of files shown
 * from where the reader left off, from one source.
 */
interface Run {
  readonly at: string;
  readonly comparison: string | null;
  readonly compareFrom: string | null;
  readonly since: string | null;
  readonly from: Source;
  readonly entries: readonly Entry[];
  readonly partial: boolean;
  readonly uncompared: boolean;
  /** Files the view shows the lines of, which it loads whether or not they start out shown. */
  readonly shown: ReadonlySet<string>;
  /**
   * The only files it loads, when it follows a run of the same files that loaded them all, and
   * these are the ones whose versions changed: as when some come to show from where they left off.
   */
  readonly only: ReadonlySet<string> | undefined;
  /** Whether it has loaded every file it loads. */
  done: boolean;
  /** Stops its jobs in the background process, as a new run takes its place or the tab closes. */
  readonly controller: AbortController;
  readonly stopped: boolean;
  /**
   * Whether its moved code has been looked for: a view of its files is drawn with their labels,
   * which would move what's on screen if they came after.
   */
  moved: boolean;
}

/**
 * A run of `entries`, at a head, in a comparison, from a start, with `since`'s files from where they
 * left off, from a source, loading `shown`'s lines too, or only `only`'s.
 */
function runOf(
  at: string,
  comparison: string | null,
  compareFrom: string | null,
  since: string | null,
  from: Source,
  entries: readonly Entry[],
  listing: Pick<Ready, 'partial' | 'uncompared'>,
  shown: ReadonlySet<string>,
  only?: ReadonlySet<string>,
): Run {
  const controller = new AbortController();
  return {
    at,
    comparison,
    compareFrom,
    since,
    from,
    entries,
    partial: listing.partial,
    uncompared: listing.uncompared,
    shown,
    only,
    done: false,
    controller,
    moved: false,
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
  /** Who hears of each file's lines, diff, highlighting or failure as it comes, by its id. */
  readonly #fileListeners = new Set<(id: string) => void>();
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

  /**
   * Calls `listener` with a file's id each time what's been worked out of it changes, or it fails,
   * whether or not the diff is drawn: for a view of one file, such as the code beside an overview.
   * Returns a function that stops it.
   */
  onFile(listener: (id: string) => void): () => void {
    this.#fileListeners.add(listener);
    return () => {
      this.#fileListeners.delete(listener);
    };
  }

  /** Tells those who listen for files that `id`'s changed. */
  #fileChanged(id: string): void {
    for (const listener of this.#fileListeners) listener(id);
  }

  /** Takes what main says of the diff. */
  take(state: DiffState): void {
    this.#state = state;
    const { at, comparison, compareFrom } = state;
    const run = this.#run;
    if (
      at === null ||
      run?.at !== at ||
      run.comparison !== comparison ||
      run.compareFrom !== compareFrom
    ) {
      this.#reset();
    }
    this.#startIfDue();
    this.#changed();
  }

  /** Starts loading what main last said, unless it's under way, once whitespace is known. */
  #startIfDue(): void {
    const state = this.#state;
    if (!state || !this.#whitespaceKnown) return;
    const { at, comparison, compareFrom, since, from, files, partial, uncompared } = state;
    if (at === null || from === null || files === null) return;
    const run = this.#run;
    if (
      run?.from !== from ||
      run.at !== at ||
      run.comparison !== comparison ||
      run.compareFrom !== compareFrom ||
      run.since !== since
    ) {
      this.#start(at, comparison, compareFrom, since, from, files, {
        partial,
        // Main keeps saying GitHub couldn't compare it once the local copy's files replace GitHub's.
        uncompared: uncompared && from === 'github',
      });
    }
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

  /**
   * Highlights a file again, if what's been worked out of it came without: as for one the view
   * held while its highlighting was dropped.
   */
  recolor(id: string): void {
    const run = this.#run;
    const entry = run?.entries.find((each) => each.id === id);
    const shown = this.#shown.get(id);
    if (!run || !entry || shown?.from !== run.from || shown.tokens.old || shown.tokens.new) return;
    this.#highlightBatch(run, [entry]).catch((error: unknown) => {
      if (!run.stopped) this.#work.log('Lo couldn’t highlight a file:', error);
    });
  }

  /** Loads a file kept out, as `za` asks: its texts, then its diff, given to the view. */
  load(id: string): void {
    const run = this.#run;
    const entry = run?.entries.find((each) => each.id === id);
    if (!run || !entry) {
      this.#sink?.failed(id);
      this.#fileChanged(id);
      return;
    }
    this.#failed.delete(id);
    void this.#batch(run, [entry], LOADED_BUDGET, true)
      .then(async () => {
        if (run.stopped) return;
        if (this.#shown.get(id)?.from !== run.from) {
          this.#failed.add(id);
          this.#sink?.failed(id);
          this.#fileChanged(id);
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
        this.#fileChanged(id);
      });
  }

  /** Stops what's under way, as the tab closes. */
  stop(): void {
    this.#run?.controller.abort();
    this.#run = undefined;
    this.#sink = undefined;
    this.#listeners.clear();
    this.#fileListeners.clear();
  }

  #reset(): void {
    this.#run?.controller.abort();
    this.#run = undefined;
    this.#ready = undefined;
    const gone = new Set([...this.#shown.keys(), ...this.#failed]);
    this.#shown.clear();
    this.#failed.clear();
    this.#moves = [];
    for (const id of gone) this.#fileChanged(id);
  }

  #start(
    at: string,
    comparison: string | null,
    compareFrom: string | null,
    since: string | null,
    from: Source,
    files: readonly FileVersions[],
    listing: Pick<Ready, 'partial' | 'uncompared'>,
  ): void {
    const previous = this.#run;
    previous?.controller.abort();
    const listed = files.map((versions, place) => {
      const key = keyOf(versions);
      return { place, versions, key, id: this.ids.of(key) };
    });
    const entries = from === 'github' ? this.#bounded(listed) : listed;
    const ready = this.#ready;
    // The view drawn from GitHub's files takes the local copy's in place when they're the same
    // files, however each starts out now: the view changes that where the reader isn't looking.
    // Other files are drawn anew once they're all in.
    const drawn = new Set(ready?.entries.map((entry) => entry.id));
    const inPlace =
      ready !== undefined &&
      ready.at === at &&
      ready.comparison === comparison &&
      ready.compareFrom === compareFrom &&
      ready.entries.length === entries.length &&
      entries.every((entry) => drawn.has(entry.id));
    // A file the view shows lines of gets the local copy's, however it starts out now.
    const shown = inPlace
      ? new Set(ready.entries.flatMap((entry) => (this.#shown.has(entry.id) ? [entry.id] : [])))
      : new Set<string>();
    // When only which files show from where they left off changed, after every file loaded, only
    // the files whose versions changed load again.
    const only =
      inPlace && previous?.done === true && previous.from === from && previous.at === at
        ? changedEntries(previous.entries, entries)
        : undefined;
    const run = runOf(at, comparison, compareFrom, since, from, entries, listing, shown, only);
    this.#run = run;
    this.#failed.clear();
    if (inPlace) this.#ready = { at, comparison, compareFrom, from, entries, ...listing };
    void this.#load(run).catch((error: unknown) => {
      if (!run.stopped) this.#work.log('Lo couldn’t load the diff:', error);
    });
  }

  /** Loads every file that shows its lines, in the left panel's order, a batch at a time. */
  async #load(run: Run): Promise<void> {
    const wanted = this.#ordered(
      run.entries.filter((entry) => wants(run, entry) && (run.only?.has(entry.id) ?? true)),
    );
    const batches = batchesOf(wanted);
    this.#readyIfDone(run);
    const going = new Set<Promise<void>>();
    for (const batch of batches) {
      if (run.stopped) return;
      // Before the view is drawn, the diffs come first and the highlighting after, so it's drawn
      // sooner; a view already drawn takes both at once, so what it shows isn't left plain.
      const drawn = this.#drawing(run);
      const next = this.#batch(run, batch, BUDGET, drawn)
        .catch((error: unknown) => this.#oneByOne(run, batch, error))
        .finally(() => going.delete(next));
      going.add(next);
      if (going.size >= IN_FLIGHT) await Promise.race(going);
    }
    await Promise.all(going);
    if (run.stopped) return;
    try {
      await this.#findMoves(run);
    } catch (error) {
      if (!run.stopped) this.#work.log('Lo couldn’t look for moved code:', error);
    } finally {
      run.moved = true;
    }
    if (run.stopped) return;
    run.done = true;
    this.#readyIfDone(run);
    this.#changed();
    await this.#highlight(run);
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
        await this.#batch(run, [entry], BUDGET, true);
      } catch (alone) {
        if (!run.stopped) this.#fail(run, entry, describe(alone));
      }
    }
    this.#readyIfDone(run);
    this.#changed();
  }

  /** `entries` in the left panel's order, then any it doesn't list, in main's. */
  #ordered(entries: readonly Entry[]): Entry[] {
    return inOrder(entries, this.#work.order(entries.map(changeOf)), (key) => this.ids.find(key));
  }

  /**
   * GitHub's files, those past the first {@link TAB_LINES} lines its diffs draw between them, in
   * the panel's order, kept out to load from the local copy: the files the reader comes to first
   * get their lines.
   */
  #bounded(entries: readonly Entry[]): Entry[] {
    const out = new Set<string>();
    let drawn = 0;
    for (const { id, versions } of this.#ordered(entries)) {
      if (versions.start !== 'shown' && versions.start !== 'collapsed') continue;
      if (drawn + versions.reach <= TAB_LINES) drawn += versions.reach;
      else out.add(id);
    }
    return entries.map((entry) =>
      out.has(entry.id)
        ? {
            ...entry,
            versions: {
              ...entry.versions,
              start: 'large',
              large: `GitHub’s diffs of the files before it reach ${TAB_LINES.toLocaleString('en-US')} lines between them: it loads from the local copy`,
            },
          }
        : entry,
    );
  }

  /** Asks for a batch's texts, then diffs and highlights them, and keeps and gives what came. */
  async #batch(
    run: Run,
    batch: readonly Entry[],
    budget: number,
    highlight: boolean,
  ): Promise<void> {
    const texts = await this.#work.texts({
      at: run.at,
      comparison: run.comparison,
      compareFrom: run.compareFrom,
      since: run.since,
      from: run.from,
      files: batch.map((entry) => entry.place),
    });
    if (run.stopped) return;
    const jobs: Job[] = [];
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
    const whitespace = this.#whitespace;
    // GitHub's diffs draw their placeholders too: files reaching far between them go over several
    // jobs, so no one job holds more than so many lines.
    for (const part of byReach(jobs)) {
      if (run.stopped) return;
      const results = await this.#work.files(
        { files: part.map(({ job }) => job), whitespace, highlight, budget },
        run.controller.signal,
      );
      if (run.stopped) return;
      this.#took(run, part, results, whitespace);
    }
    this.#readyIfDone(run);
    this.#changed();
  }

  /** Keeps and gives what a job worked out of `jobs`' files, or says which it couldn't. */
  #took(
    run: Run,
    jobs: readonly Job[],
    results: readonly (FileResult | undefined)[],
    whitespace: boolean,
  ): void {
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
      if (this.#drawing(run)) this.#sink?.lines(entry.id, shown);
      this.#fileChanged(entry.id);
    });
  }

  #fail(run: Run, entry: Entry, why: string): void {
    this.#work.log(`Lo couldn’t show ${entry.versions.path.text}:`, why);
    this.#failed.add(entry.id);
    if (this.#drawing(run)) this.#sink?.failed(entry.id);
    this.#fileChanged(entry.id);
  }

  /** Once every file that shows its lines has them, or couldn't, the run's files can be drawn. */
  #readyIfDone(run: Run): void {
    if (run.stopped || this.#drawing(run)) return;
    if (!run.moved) return;
    const done = run.entries.every(
      (entry) =>
        !wants(run, entry) ||
        this.#failed.has(entry.id) ||
        this.#shown.get(entry.id)?.from === run.from,
    );
    if (done) {
      this.#ready = {
        at: run.at,
        comparison: run.comparison,
        compareFrom: run.compareFrom,
        from: run.from,
        entries: run.entries,
        partial: run.partial,
        uncompared: run.uncompared,
      };
    }
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

  /** Highlights the run's files that came without it, a batch at a time, first files first. */
  async #highlight(run: Run): Promise<void> {
    const plain = this.#ordered(run.entries).filter((entry) => {
      const shown = this.#shown.get(entry.id);
      return shown?.from === run.from && !shown.tokens.old && !shown.tokens.new;
    });
    const going = new Set<Promise<void>>();
    for (const batch of highlightBatches(plain, (entry) => this.#shown.get(entry.id))) {
      if (run.stopped) return;
      const next = this.#highlightBatch(run, batch)
        .catch((error: unknown) => {
          if (!run.stopped) this.#work.log('Lo couldn’t highlight part of the diff:', error);
        })
        .finally(() => going.delete(next));
      going.add(next);
      if (going.size >= IN_FLIGHT) await Promise.race(going);
    }
    await Promise.all(going);
  }

  async #highlightBatch(run: Run, batch: readonly Entry[]): Promise<void> {
    const files = batch.flatMap((entry) => {
      const shown = this.#shown.get(entry.id);
      if (!shown) return [];
      return [
        {
          entry,
          path: entry.versions.path.text,
          old: joined(shown.lines.old),
          new: joined(shown.lines.new),
        },
      ];
    });
    if (files.length === 0) return;
    const tokens = await this.#work.highlight(
      { files: files.map(({ path, old, new: added }) => ({ path, old, new: added })) },
      run.controller.signal,
    );
    if (run.stopped) return;
    files.forEach(({ entry }, index) => {
      const kept = this.#shown.get(entry.id);
      const found = tokens[index];
      if (!kept || kept.from !== run.from || !found) return;
      this.#shown.set(entry.id, { ...kept, tokens: found });
      if (this.#drawing(run)) this.#sink?.tokens(entry.id, found);
      this.#fileChanged(entry.id);
    });
  }

  /** Diffs files again with whitespace shown or hidden, keeping their lines and highlighting. */
  async #rediff(run: Run, entries: readonly Entry[], whitespace: boolean): Promise<void> {
    for (const batch of batchesOf(this.#ordered(entries))) {
      if (run.stopped || this.#whitespace !== whitespace) return;
      const texts = await this.#work.texts({
        at: run.at,
        comparison: run.comparison,
        compareFrom: run.compareFrom,
        since: run.since,
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
        this.#fileChanged(entry.id);
      });
    }
    if (!run.stopped) await this.#findMoves(run);
  }

  /** Whether what's drawn is `run`'s files: the same head, comparison, start and source. */
  #drawing(run: Run): boolean {
    const ready = this.#ready;
    return (
      ready?.at === run.at &&
      ready.comparison === run.comparison &&
      ready.compareFrom === run.compareFrom &&
      ready.from === run.from
    );
  }

  #changed(): void {
    const run = this.#run;
    const counted = run ? run.entries.filter((entry) => wants(run, entry)) : [];
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

/** The entries of `next` whose versions differ from the same file's in `before`, by id. */
function changedEntries(before: readonly Entry[], next: readonly Entry[]): Set<string> {
  const was = new Map(before.map((entry) => [entry.id, JSON.stringify(entry.versions)]));
  return new Set(
    next.flatMap((entry) =>
      was.get(entry.id) === JSON.stringify(entry.versions) ? [] : [entry.id],
    ),
  );
}

/** Whether a run loads a file's lines: it shows them from the start, or the view shows them. */
function wants(run: Run, entry: Entry): boolean {
  return showsLines(entry.versions) || run.shown.has(entry.id);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Entries in batches of a few megabytes of lines to highlight, or as many files as a job takes. */
function highlightBatches(
  entries: readonly Entry[],
  shown: (entry: Entry) => Shown | undefined,
): Entry[][] {
  const batches: Entry[][] = [];
  let batch: Entry[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const lines = shown(entry)?.lines;
    const size = lines ? sizeOf(lines.old) + sizeOf(lines.new) : 0;
    if (
      batch.length > 0 &&
      (batch.length >= HIGHLIGHTS_PER_JOB || bytes + size > HIGHLIGHT_BYTES)
    ) {
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

/** Lines as the documents hold them, joined with `\n`; none for no lines. */
function joined(lines: readonly string[]): string | null {
  return lines.length === 0 ? null : lines.join('\n');
}

function sizeOf(lines: readonly string[]): number {
  let size = 0;
  for (const line of lines) size += line.length + 1;
  return size;
}

/** Entries in batches of a megabyte or so of text, as main's sizes say, or 48 files at most. */
/** A file to work out, its lines when the window has them already. */
interface Job {
  readonly entry: Entry;
  readonly job: FileJob;
  readonly lines?: Shown['lines'];
}

/** `jobs` in runs whose patches draw {@link JOB_LINES} lines at most between them, if they can. */
function byReach(jobs: readonly Job[]): Job[][] {
  const parts: Job[][] = [];
  let part: Job[] = [];
  let lines = 0;
  for (const each of jobs) {
    const reach = each.job.kind === 'patch' ? patchReach(each.job.patch) : 0;
    if (part.length > 0 && lines + reach > JOB_LINES) {
      parts.push(part);
      part = [];
      lines = 0;
    }
    part.push(each);
    lines += reach;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

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
