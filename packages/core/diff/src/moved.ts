// Finds blocks of code that a pull request moves: deleted in one place and added in another, in the
// same file or another file of the PR.
//
// `Moves.find` takes every file's changed lines, as a line diff produces them, and returns the
// moves. Each `Move` says where its block came from and where it landed, for the "moved from
// `api/user.ts:40`" link at each end, and lists the lines edited on the way, so the diff view
// highlights only those. `Moves.ofDeleted` and `Moves.ofAdded` find the move a line belongs to as
// the view draws it.
//
// # What counts as a move
//
// Lines are compared with their leading and trailing whitespace trimmed, so re-indented code still
// matches. Blank lines are left out: they can sit inside a block, in any number on either side, but
// never count toward one.
//
// Consecutive deleted lines of a file form a run, and so do consecutive added lines. A lineup pairs
// the lines of a deleted run with the lines of an added run, one for one from some offset, skipping
// blank lines. Each pair matches or is an edited line. A block of a lineup is a move when:
//
// 1. it starts and ends with matching lines;
// 2. at least 3 of its matching lines have a letter or digit, so lines of only punctuation, such as
//    `}` or `});`, can sit inside a move but can't make one;
// 3. at least two thirds of its lines match; and
// 4. no more than 2 edited lines come in a row.
//
// Going down a lineup, a block starts at each matching line not already in a block and runs to the
// furthest matching line that keeps two thirds of its lines matching.
//
// Unlike git's `--color-moved`, which only matches lines exactly, a move can carry small edits.
// Edits pair lines one for one, though: a line added or removed inside a moved block shifts the
// lineup, so the block becomes a move on each side of it, each held to the rule on its own.
//
// A deleted run and an added run between the same two unchanged lines of a file are never lined up.
// That code was changed in place, say re-indented or wrapped in a new block, not moved.
//
// # Competing moves
//
// Each line belongs to at most one move, and longer moves win. Candidates are taken by how many of
// their matching lines have a letter or digit, then by how many lines match, then by fewest edits,
// then by where they land and where they came from, earliest first. A candidate that overlaps one
// already taken loses the overlap, and what's left is held to the rule again. A block added in two
// places is one move, to the first.
//
// A line repeated all over a PR, such as `return;`, doesn't start a lineup: a text deleted D times
// and added A times starts one only when D × A is at most 64. It still matches inside a lineup
// another line started, so a block made only of such lines isn't found, but a long run of them
// moves with the distinct lines around it.

/** The fewest matching lines with a letter or digit a move has. */
const minLines = 3;

/** The most edited lines a move has in a row. */
const maxEditsInARow = 2;

/**
 * The most lineups one text starts. A text deleted D times and added A times would start D × A of
 * them, so a line repeated all over a PR starts none. It still matches inside a lineup that another
 * line started. Without a limit, a line repeated thousands of times would take time and memory
 * that grow with the square of its count.
 */
const maxLineupsPerText = 64;

/** One file's changed lines, as a line diff produces them. Lines can come in any order. */
export interface FileChanges {
  /** The file's path after the change. */
  path: string;
  /** The file's path before the change, when the PR renames it. */
  oldPath?: string | undefined;
  /** Deleted lines, numbered as in the old file. */
  deleted: readonly Line[];
  /** Added lines, numbered as in the new file. */
  added: readonly Line[];
}

/** A deleted or added line. */
export interface Line {
  /** The line's 1-based number in its version of the file. */
  number: number;
  /** The line's text, without its line ending. */
  text: string;
}

/** A block of lines deleted in one place and added in another. */
export interface Move {
  /** Where the block was deleted, in old line numbers. */
  from: Place;
  /** Where the block was added, in new line numbers. */
  to: Place;
  /**
   * The lines edited on the way, as pairs of an old line and the new line it became, in order.
   * Every other line of the block that isn't blank moved unchanged, apart from its indentation.
   */
  edits: EditedLine[];
}

/** One end of a move. */
export interface Place {
  /** The file's index in the changes passed to `Moves.find`. */
  file: number;
  /** The file's path on this side: its old path for `from`, its new path for `to`. */
  path: string;
  /** The block's first and last lines. Both are lines that aren't blank. */
  first: number;
  last: number;
}

/** A line of a moved block that was edited on the way. */
export interface EditedLine {
  /** The line's number in the old file. */
  old: number;
  /** The number of the line it became in the new file. */
  new: number;
}

/** The moves among a PR's changes, with lookups by line. */
export class Moves {
  /** Every move, ordered by where it lands: by file, then by line. */
  readonly all: readonly Move[];
  /** Indices into `all`, by where they came from. */
  readonly #byFrom: number[];

  /** Finds the moves among `files`, the changes of every file in the PR. */
  static find(files: readonly FileChanges[]): Moves {
    const texts = new Map<string, number>();
    const finder = new Finder(
      new Side(files, (file) => file.deleted, texts),
      new Side(files, (file) => file.added, texts),
    );
    return new Moves(
      finder
        .choose(finder.candidates(texts.size))
        .map((candidate) => finder.toMove(candidate, files)),
    );
  }

  /** Lookups over moves that `find` found, such as ones sent from another thread. */
  constructor(moves: readonly Move[]) {
    this.all = moves.toSorted((a, b) => compareKeys(a.to, b.to));
    this.#byFrom = this.all
      .map((_, index) => index)
      .toSorted((a, b) => compareKeys(this.all[a]!.from, this.all[b]!.from));
  }

  /** The move that deleted line `line`, by its old number, of the file at index `file` is in. */
  ofDeleted(file: number, line: number): Move | undefined {
    const after = partitionPoint(this.#byFrom, (index) =>
      atOrBefore(this.all[index]!.from, file, line),
    );
    const moved = after > 0 ? this.all[this.#byFrom[after - 1]!] : undefined;
    return moved && contains(moved.from, file, line) ? moved : undefined;
  }

  /** The move that added line `line`, by its new number, of the file at index `file` is in. */
  ofAdded(file: number, line: number): Move | undefined {
    const after = partitionPoint(this.all, (moved) => atOrBefore(moved.to, file, line));
    const moved = after > 0 ? this.all[after - 1] : undefined;
    return moved && contains(moved.to, file, line) ? moved : undefined;
  }
}

/** The edit of old line `line`, if it's in the block and was edited on the way. */
export function editOfOld(moved: Move, line: number): EditedLine | undefined {
  const index = partitionPoint(moved.edits, (edit) => edit.old < line);
  const edit = moved.edits[index];
  return edit?.old === line ? edit : undefined;
}

/** The edit that made new line `line`, if it's in the block and was edited on the way. */
export function editOfNew(moved: Move, line: number): EditedLine | undefined {
  const index = partitionPoint(moved.edits, (edit) => edit.new < line);
  const edit = moved.edits[index];
  return edit?.new === line ? edit : undefined;
}

function compareKeys(a: Place, b: Place): number {
  return a.file - b.file || a.first - b.first;
}

function atOrBefore(place: Place, file: number, line: number): boolean {
  return place.file < file || (place.file === file && place.first <= line);
}

function contains(place: Place, file: number, line: number): boolean {
  return place.file === file && place.first <= line && line <= place.last;
}

/** How many items from the start satisfy `before`, which holds up to some point and not after. */
function partitionPoint<T>(items: readonly T[], before: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(items[middle]!)) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** A line that isn't blank, on one side of every file's changes. */
interface Entry {
  /** The trimmed text's number. */
  id: number;
  /**
   * Whether the line has a letter or digit, so it counts toward a move's length. Lines of only
   * punctuation, such as `}` or `});`, can sit inside a move but don't make one.
   */
  counts: boolean;
  number: number;
  /** The index of its run in `Side.runs`. */
  run: number;
}

/** Consecutive deleted or added lines: lines a move can line up with one another. */
interface Run {
  file: number;
  /**
   * Where the run sits among the file's unchanged lines: one more than how many come before it. A
   * deleted run and an added run of a file with the same place are a change in place.
   */
  place: number;
  /** The run's lines that aren't blank, as indices into `Side.lines`: `[start, end)`. */
  start: number;
  end: number;
}

const letterOrDigit = /[\p{Alphabetic}\p{N}]/u;

/** One side of every file's changes, the deleted or the added lines, without blank lines. */
class Side {
  /** The lines that aren't blank, by file, then by number. */
  readonly lines: Entry[] = [];
  readonly runs: Run[] = [];

  constructor(
    files: readonly FileChanges[],
    linesOf: (file: FileChanges) => readonly Line[],
    texts: Map<string, number>,
  ) {
    files.forEach((changes, file) => {
      const lines = linesOf(changes)
        .toSorted((a, b) => a.number - b.number)
        .filter((line, index, sorted) => index === 0 || sorted[index - 1]!.number !== line.number);
      let first = 0;
      while (first < lines.length) {
        let end = first + 1;
        while (end < lines.length && lines[end]!.number === lines[end - 1]!.number + 1) end++;
        const start = this.lines.length;
        const run = this.runs.length;
        for (const line of lines.slice(first, end)) {
          const text = line.text.trim();
          if (text === '') continue;
          let id = texts.get(text);
          if (id === undefined) texts.set(text, (id = texts.size));
          this.lines.push({ id, counts: letterOrDigit.test(text), number: line.number, run });
        }
        if (this.lines.length > start) {
          this.runs.push({
            file,
            place: lines[first]!.number - first,
            start,
            end: this.lines.length,
          });
        }
        first = end;
      }
    });
  }

  /** Where each text appears on this side, by its number. */
  index(texts: number): number[][] {
    const positions: number[][] = Array.from({ length: texts }, () => []);
    this.lines.forEach((line, position) => positions[line.id]!.push(position));
    return positions;
  }
}

/** A block of added lines `[start, end)`, lined up with the deleted lines `delta` positions away. */
interface Candidate {
  start: number;
  end: number;
  delta: number;
  /** How many of its matching lines have a letter or digit: its length. */
  length: number;
  /** How many of its lines match. */
  matched: number;
  /** How many of its lines were edited. */
  edited: number;
}

/**
 * Whether `a` goes before `b`: longer blocks first, then the one with more matching lines of
 * punctuation, then the one with fewer edits, then the one that lands first, then the one that came
 * from first. The end only makes the order total.
 */
function outranks(a: Candidate, b: Candidate): boolean {
  return (
    (a.length - b.length ||
      a.matched - b.matched ||
      b.edited - a.edited ||
      b.start - a.start ||
      b.start + b.delta - (a.start + a.delta) ||
      b.end - a.end) > 0
  );
}

/** A pair of an added line and a deleted line with the same text: where a lineup starts. */
interface Seed {
  oldRun: number;
  newRun: number;
  delta: number;
  new: number;
}

function compareSeeds(a: Seed, b: Seed): number {
  return a.oldRun - b.oldRun || a.newRun - b.newRun || a.delta - b.delta || a.new - b.new;
}

class Finder {
  readonly old: Side;
  readonly new: Side;

  constructor(old: Side, added: Side) {
    this.old = old;
    this.new = added;
  }

  candidates(texts: number): Candidate[] {
    const index = this.old.index(texts);
    const added = Array.from<number>({ length: texts }).fill(0);
    for (const line of this.new.lines) added[line.id]!++;
    const seeds: Seed[] = [];
    // Every move has a matching line that counts, so only those start a lineup.
    this.new.lines.forEach((line, position) => {
      if (!line.counts) return;
      const olds = index[line.id]!;
      if (olds.length * added[line.id]! > maxLineupsPerText) return;
      const newRun = this.new.runs[line.run]!;
      for (const old of olds) {
        const oldRun = this.old.runs[this.old.lines[old]!.run]!;
        if (oldRun.file === newRun.file && oldRun.place === newRun.place) continue;
        seeds.push({
          oldRun: this.old.lines[old]!.run,
          newRun: line.run,
          delta: old - position,
          new: position,
        });
      }
    });
    seeds.sort(compareSeeds);

    const candidates: Candidate[] = [];
    let walked: { seed: Seed; end: number } | undefined;
    for (const seed of seeds) {
      if (
        walked &&
        walked.seed.oldRun === seed.oldRun &&
        walked.seed.newRun === seed.newRun &&
        walked.seed.delta === seed.delta &&
        seed.new < walked.end
      ) {
        continue;
      }
      const lineup = this.walk(seed);
      walked = { seed, end: lineup.end };
      this.blocks(lineup.start, lineup.end, seed.delta, (candidate) => candidates.push(candidate));
    }
    return candidates;
  }

  /**
   * The candidate moves among the added lines `[from, to)`, lined up with the deleted lines `delta`
   * away. The lines have no more than `maxEditsInARow` edited lines in a row.
   *
   * Going down the lineup, a block starts at each matching line not already in one and runs to the
   * furthest matching line that keeps at least two thirds of its lines matching. It's a candidate
   * when at least `minLines` of its matching lines have a letter or digit.
   */
  blocks(from: number, to: number, delta: number, out: (candidate: Candidate) => void): void {
    // Running totals before each line. A matching line scores 1 and an edited line -2, so a stretch
    // matches on two thirds of its lines when the score where it ends is at least the score where
    // it starts.
    const count = to - from;
    const score = [0];
    const matched = [0];
    const length = [0];
    for (let line = from; line < to; line++) {
      const same = this.same(line, delta);
      const counts = same && this.new.lines[line]!.counts;
      score.push(score.at(-1)! + (same ? 1 : -2));
      matched.push(matched.at(-1)! + (same ? 1 : 0));
      length.push(length.at(-1)! + (counts ? 1 : 0));
    }
    const isMatch = (at: number): boolean => matched[at + 1]! > matched[at]!;
    // The highest score at or after each position, which never rises along the lineup.
    const highest = [...score];
    for (let at = count - 1; at >= 0; at--) highest[at] = Math.max(highest[at]!, highest[at + 1]!);

    let start = 0;
    while (start < count) {
      if (!isMatch(start)) {
        start++;
        continue;
      }
      // `highest` past `start` never rises, so the stretch reaches as far as it stays this high.
      let reach = 0;
      let high = count - start;
      while (reach < high) {
        const middle = (reach + high) >>> 1;
        if (highest[start + 1 + middle]! >= score[start]!) reach = middle + 1;
        else high = middle;
      }
      let end = start + reach;
      while (!isMatch(end - 1)) end--;
      if (length[end]! - length[start]! < minLines) {
        start++;
        continue;
      }
      const lines = matched[end]! - matched[start]!;
      out({
        start: from + start,
        end: from + end,
        delta,
        length: length[end]! - length[start]!,
        matched: lines,
        edited: end - start - lines,
      });
      start = end;
    }
  }

  /**
   * Takes candidates longest first, giving each line to at most one move. A candidate that overlaps
   * one already taken is put back without the overlap, as each stretch left over.
   */
  choose(candidates: Candidate[]): Candidate[] {
    const queue = new Heap(outranks, candidates);
    const oldTaken = Array.from<boolean>({ length: this.old.lines.length }).fill(false);
    const newTaken = Array.from<boolean>({ length: this.new.lines.length }).fill(false);
    const chosen: Candidate[] = [];
    for (let candidate = queue.pop(); candidate; candidate = queue.pop()) {
      const { delta } = candidate;
      const free = (line: number): boolean => !newTaken[line] && !oldTaken[line + delta];
      let all = true;
      for (let line = candidate.start; line < candidate.end && all; line++) all = free(line);
      if (all) {
        for (let line = candidate.start; line < candidate.end; line++) {
          newTaken[line] = true;
          oldTaken[line + delta] = true;
        }
        chosen.push(candidate);
        continue;
      }
      let start = candidate.start;
      while (start < candidate.end) {
        if (!free(start)) {
          start++;
          continue;
        }
        let end = start + 1;
        while (end < candidate.end && free(end)) end++;
        this.blocks(start, end, delta, (left) => queue.push(left));
        start = end;
      }
    }
    return chosen;
  }

  /**
   * The added lines that line up with deleted lines `seed.delta` away, from the start of both runs
   * to their end.
   */
  lane(seed: Seed): { start: number; end: number } {
    const old = this.old.runs[seed.oldRun]!;
    const added = this.new.runs[seed.newRun]!;
    return {
      start: Math.max(added.start, old.start - seed.delta),
      end: Math.min(added.end, Math.max(0, old.end - seed.delta)),
    };
  }

  same(line: number, delta: number): boolean {
    return this.new.lines[line]!.id === this.old.lines[line + delta]!.id;
  }

  /**
   * The lines around `seed` along its lineup, out to the last matching lines before more than
   * `maxEditsInARow` edited lines in a row, or the end of either run.
   */
  walk(seed: Seed): { start: number; end: number } {
    const lane = this.lane(seed);
    let start = seed.new;
    for (let at = seed.new - 1; at >= lane.start; at--) {
      if (this.same(at, seed.delta)) start = at;
      else if (start - at > maxEditsInARow) break;
    }
    let end = seed.new + 1;
    for (let at = seed.new + 1; at < lane.end; at++) {
      if (this.same(at, seed.delta)) end = at + 1;
      else if (at + 1 - end > maxEditsInARow) break;
    }
    return { start, end };
  }

  toMove(candidate: Candidate, files: readonly FileChanges[]): Move {
    const { start, end, delta } = candidate;
    const oldLine = (position: number): Entry => this.old.lines[position]!;
    const newLine = (position: number): Entry => this.new.lines[position]!;
    const from = this.old.runs[oldLine(start + delta).run]!.file;
    const to = this.new.runs[newLine(start).run]!.file;
    const edits: EditedLine[] = [];
    for (let line = start; line < end; line++) {
      if (newLine(line).id !== oldLine(line + delta).id) {
        edits.push({ old: oldLine(line + delta).number, new: newLine(line).number });
      }
    }
    return {
      from: {
        file: from,
        path: files[from]!.oldPath ?? files[from]!.path,
        first: oldLine(start + delta).number,
        last: oldLine(end - 1 + delta).number,
      },
      to: {
        file: to,
        path: files[to]!.path,
        first: newLine(start).number,
        last: newLine(end - 1).number,
      },
      edits,
    };
  }
}

/** A binary heap that pops the item that outranks the rest. */
class Heap<T> {
  readonly #items: T[];
  readonly #outranks: (a: T, b: T) => boolean;

  constructor(order: (a: T, b: T) => boolean, items: readonly T[]) {
    this.#outranks = order;
    this.#items = [];
    for (const item of items) this.push(item);
  }

  push(item: T): void {
    const items = this.#items;
    items.push(item);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >>> 1;
      if (!this.#outranks(items[at]!, items[parent]!)) break;
      [items[at], items[parent]] = [items[parent]!, items[at]!];
      at = parent;
    }
  }

  pop(): T | undefined {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return top;
    items[0] = last;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      const right = left + 1;
      let best = at;
      if (left < items.length && this.#outranks(items[left]!, items[best]!)) best = left;
      if (right < items.length && this.#outranks(items[right]!, items[best]!)) best = right;
      if (best === at) return top;
      [items[at], items[best]] = [items[best]!, items[at]!];
      at = best;
    }
  }
}
