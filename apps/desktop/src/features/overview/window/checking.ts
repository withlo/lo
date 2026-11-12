// A pull request's tab's overview, checked, in the window. As main says which overview the tab
// shows, `artifact.md` is read in the background process, main is asked for the figures and the
// code it names, and the overview is checked there against what main read. Until the local copy is
// there, it's checked with no code, so each target is unread, and again once it is; without git,
// its code stays unread. Code once read stays read: a later read that reads less, or none, leaves
// it. What's published changes only when the check's result could: a result with the same key as
// the one before is the same, and isn't published again, so a view keeping what it drew by the
// parse's objects keeps them.
//
// The check is sent only what it reads: of each figure, its start, all of an SVG it reads whole,
// and all of an image whose header goes on past its start once a check has said so. What's kept
// is what a view draws: all of each figure the check kept, the start of the rest, and none of the
// code, whose bytes go once it's checked.

import type { CheckedArtifact, ParsedArtifact } from '@lo/artifact';

import type {
  CodeAccess,
  CodeAnswer,
  CodeReply,
  OverviewCommit,
  OverviewFile,
  OverviewState,
} from '../contract.ts';
import { FIGURE_HEAD, SVG_BYTES, type CheckInput, type CodeFile, type Parsed } from '../jobs.ts';

/** The overview's text, by its path in the commit. */
const ARTIFACT = 'artifact.md';

/**
 * What main answered for a file the overview's code names: as it answered, but of a file, how many
 * bytes it read rather than the bytes, which go once they're checked.
 */
export type CodeSeen =
  { kind: 'file'; size: number | null; read: number } | Exclude<CodeAnswer, { kind: 'file' }>;

/**
 * The code an overview names, as far as it's read: it names none, or has no header to read it at;
 * it's waiting for the local copy; there's no git; the copy, or main's reading, failed, and why; or
 * main read it, at the header's commit, each file the parse names with main's answer.
 */
export type CodeRead =
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'noGit' }
  | { kind: 'failed'; why: string }
  | { kind: 'read'; commit: string; files: (CodeFile & { answer: CodeSeen })[] };

/**
 * A tab's overview, checked:
 *
 * - `key`: the same as another result's exactly when the two are the same: the commit, and the
 *   shape of what main read of its figures and code;
 * - `parsed`: `artifact.md`, read, the same object for as long as the commit is on screen; none
 *   when main didn't read it, as for an overview too large to read;
 * - `checked`: what checking found. A shown overview's code follows `parsed.references`, and its
 *   figures `parsed.figures`, one for one;
 * - `figures`: what main read of each figure, by its path: all of one the check kept, to draw it,
 *   and of the rest what the check read;
 * - `code`: what main read of the code.
 *
 * Or `failed`: it couldn't be read or checked just now, and why. It's tried again when main next
 * says something of the tab.
 */
export type CheckedOverview =
  | {
      kind: 'checked';
      key: string;
      commit: OverviewCommit;
      parsed: ParsedArtifact | undefined;
      checked: CheckedArtifact;
      figures: ReadonlyMap<string, OverviewFile>;
      code: CodeRead;
    }
  | { kind: 'failed'; key: string; commit: OverviewCommit; why: string };

/** What a tab's checking reads with, and where it sends what it found. */
export interface CheckingParts {
  /** Main's `files`. */
  files(input: { id: string; commit: string; paths: string[] }): Promise<OverviewFile[]>;
  /** Main's `code`. */
  code(input: { id: string; commit: string; files: CodeFile[] }): Promise<CodeReply>;
  /** `overview.parse`, stopped once `signal` aborts. */
  parse(input: { artifact: Uint8Array }, signal: AbortSignal): Promise<Parsed>;
  /** `overview.check`, stopped once `signal` aborts. */
  check(input: CheckInput, signal: AbortSignal): Promise<CheckedArtifact>;
  /** Takes the tab's overview, checked, or none. */
  publish(value: CheckedOverview | undefined): void;
  log(message: string, error: unknown): void;
}

/** What was read of the overview's commit, kept to check it again with its code. */
interface Read {
  artifact: Uint8Array | null;
  parse: Parsed | undefined;
  /**
   * Each figure: as main answered it, kept to draw it or to send the check more of it; and what's
   * sent to the check.
   */
  figures: { path: string; file: OverviewFile; sent: OverviewFile }[];
  /** What main answered of the figures, as a result's key has it. */
  key: string;
  /** Whether a check has said which figures it keeps, so the rest were let go. */
  settled: boolean;
}

/** The code to check with, read again: what's published of it, and main's answers to check. */
interface Fresh {
  code: CodeRead;
  answers: CodeAnswer[] | undefined;
}

export class Checking {
  readonly #id: string;
  readonly #parts: CheckingParts;
  /** The overview on screen, and the pull request whose ref holds it. */
  #commit: OverviewCommit | undefined;
  #pr = 0;
  #access: CodeAccess = 'waiting';
  #read: Read | undefined;
  /** The code of what was last published for the commit, if anything was. */
  #code: CodeRead | undefined;
  /** The key of what was last published for the commit, if anything was. */
  #published: string | undefined;
  /** Whether the last check failed, so the next word from main tries again. */
  #failed = false;
  #running: AbortController | undefined;
  #stopped = false;

  constructor(id: string, parts: CheckingParts) {
    this.#id = id;
    this.#parts = parts;
  }

  /** Takes what main says of the tab's overview. */
  take(state: OverviewState): void {
    if (this.#stopped) return;
    const accessChanged = state.code !== this.#access;
    this.#access = state.code;
    const shown = state.overview;
    const pr = prOf(state.ref);
    if (!shown || pr === undefined) {
      this.#forget();
      if (this.#published !== undefined) this.#parts.publish(undefined);
      this.#published = undefined;
      return;
    }
    const current = this.#commit;
    if (current?.id !== shown.id || current.source !== shown.source || this.#pr !== pr) {
      this.#forget();
      this.#commit = shown;
      this.#pr = pr;
      this.#start();
    } else if (
      this.#failed ||
      (accessChanged && (this.#running !== undefined || this.#readsMore()))
    ) {
      // A check under way may have read the code already: it starts again.
      this.#start();
    }
  }

  /** Stops checking, as the tab closes. */
  stop(): void {
    this.#stopped = true;
    this.#forget();
  }

  /** Forgets the commit and what was read of it, stopping what's under way. */
  #forget(): void {
    this.#running?.abort();
    this.#running = undefined;
    this.#commit = undefined;
    this.#read = undefined;
    this.#code = undefined;
    this.#failed = false;
  }

  /**
   * Whether the code could be read differently now: it wasn't read, or some of it is still unread.
   * An overview that names none never reads any.
   */
  #readsMore(): boolean {
    const code = this.#code;
    if (code === undefined || code.kind === 'none') return false;
    if (code.kind !== 'read') return true;
    return code.files.some(({ answer }) => answer.kind === 'unread');
  }

  /** Checks the overview again, reading what isn't read yet, in place of a check under way. */
  #start(): void {
    const commit = this.#commit;
    if (!commit) return;
    this.#running?.abort();
    const running = new AbortController();
    this.#running = running;
    this.#failed = false;
    this.#check(commit, running.signal)
      .catch((error: unknown) => {
        if (running.signal.aborted) return;
        this.#failed = true;
        const why = error instanceof Error ? error.message : String(error);
        this.#parts.log(`Lo couldn't check the overview of tab ${this.#id}:`, error);
        // What was shown of the commit stays, until a check succeeds.
        if (this.#published !== undefined) return;
        const key = `${commit.id} ${commit.source} failed`;
        this.#published = key;
        this.#parts.publish({ kind: 'failed', key, commit, why });
      })
      .finally(() => {
        if (this.#running === running) this.#running = undefined;
      });
  }

  async #check(commit: OverviewCommit, signal: AbortSignal): Promise<void> {
    const read = this.#read ?? (await this.#readCommit(commit, signal));
    if (signal.aborted) return;
    this.#read = read;
    const fresh = await this.#readCode(read.parse, signal);
    // What was checked last stands.
    if (signal.aborted || fresh === undefined) return;
    const key = keyOf(commit, read.key, fresh.code);
    if (key === this.#published) return;
    const input = (): CheckInput => ({
      artifact: read.artifact,
      entries: commit.entries,
      pr: this.#pr,
      figures: read.figures.map(({ path, sent }) => ({ path, file: sent })),
      code:
        fresh.code.kind === 'read' && fresh.answers
          ? {
              commit: fresh.code.commit,
              files: fresh.code.files.map(({ path }, index) => ({
                path,
                answer: fresh.answers?.[index] ?? { kind: 'unread', why: 'Main gave no answer.' },
              })),
            }
          : null,
    });
    let checked = await this.#parts.check(input(), signal);
    if (signal.aborted) return;
    // An image whose header goes on past its start: checked again with all of it.
    if (!read.settled && this.#sendMore(read, checked)) {
      checked = await this.#parts.check(input(), signal);
      if (signal.aborted) return;
    }
    this.#settle(read, checked);
    this.#published = key;
    this.#code = fresh.code;
    this.#parts.publish({
      kind: 'checked',
      key,
      commit,
      parsed: read.parse?.parsed,
      checked,
      figures: new Map(read.figures.map(({ path, file }) => [path, file])),
      code: fresh.code,
    });
  }

  /**
   * Sends the check all of each figure it was sent the start of and left unread, and says whether
   * there's any: the check reads all of an image whose header goes on past its start.
   */
  #sendMore(read: Read, checked: CheckedArtifact): boolean {
    if (checked.outcome.kind !== 'shown') return false;
    const unread = new Set(
      checked.outcome.figures
        .filter(({ figure }) => figure.state === 'unread')
        .map(({ reference }) => reference.path),
    );
    let more = false;
    for (const figure of read.figures) {
      if (!unread.has(figure.path) || figure.sent === figure.file) continue;
      figure.sent = figure.file;
      more = true;
    }
    return more;
  }

  /**
   * Lets go of what isn't drawn, once a check has said which figures it keeps: of a figure it
   * didn't keep, or of every figure of an overview it doesn't show, all but what it was sent.
   * Which it keeps depends on nothing the code changes.
   */
  #settle(read: Read, checked: CheckedArtifact): void {
    if (read.settled) return;
    read.settled = true;
    const shown = checked.outcome.kind === 'shown' ? checked.outcome.figures : [];
    const kept = new Set(
      shown.filter(({ figure }) => figure.state === 'kept').map(({ reference }) => reference.path),
    );
    for (const figure of read.figures) if (!kept.has(figure.path)) figure.file = figure.sent;
  }

  /** `artifact.md`, read, and the figures it shows, as main has them. */
  async #readCommit(commit: OverviewCommit, signal: AbortSignal): Promise<Read> {
    // Main reads no file of a commit its listing says is too large, or that holds no artifact.md.
    if (!commit.read) {
      return { artifact: null, parse: undefined, figures: [], key: '', settled: true };
    }
    const [text] = await this.#parts.files({ id: this.#id, commit: commit.id, paths: [ARTIFACT] });
    if (text?.kind === 'unread') throw new Error(`Lo couldn't read artifact.md: ${text.why}`);
    // The listing says what else it is, which the check reports.
    if (text?.kind !== 'file' || text.bytes === null) {
      return { artifact: null, parse: undefined, figures: [], key: '', settled: true };
    }
    const artifact = text.bytes;
    const parse = await this.#parts.parse({ artifact }, signal);
    if (signal.aborted || parse.figures.length === 0) {
      return { artifact, parse, figures: [], key: '', settled: true };
    }
    const answers = await this.#parts.files({
      id: this.#id,
      commit: commit.id,
      paths: parse.figures,
    });
    const figures = parse.figures.map((path, index) => {
      const file = answers[index] ?? {
        kind: 'unread' as const,
        why: 'Main gave no answer for it.',
      };
      return { path, file, sent: firstSent(path, file) };
    });
    const key = figures.map(({ file }) => shape(file)).join();
    return { artifact, parse, figures, key, settled: false };
  }

  /**
   * The code the overview names, read at its header's commit once the local copy is there, to check
   * with; or none when what was checked last stands: code read stays read, the code at a commit
   * never changing, and a read that reads less of it, or none, leaves it.
   */
  async #readCode(parse: Parsed | undefined, signal: AbortSignal): Promise<Fresh | undefined> {
    const commit = parse?.parsed.header?.commit;
    if (!parse || commit === undefined || parse.code.length === 0) {
      return { code: { kind: 'none' }, answers: undefined };
    }
    const known = this.#code;
    const readable = this.#access === 'ready' || this.#access === 'offline';
    if (known?.kind === 'read' && (!this.#readsMore() || !readable)) return undefined;
    switch (this.#access) {
      case 'waiting':
        return { code: { kind: 'waiting' }, answers: undefined };
      case 'noGit':
        return { code: { kind: 'noGit' }, answers: undefined };
      case 'failed':
        return {
          code: { kind: 'failed', why: "The pull request's local copy couldn't be fetched." },
          answers: undefined,
        };
      case 'ready':
      case 'offline':
        break;
      default:
        this.#access satisfies never;
        return undefined;
    }
    const reply = await this.#parts.code({ id: this.#id, commit, files: parse.code });
    if (signal.aborted) return undefined;
    if (reply.kind !== 'read') {
      if (known?.kind === 'read') return undefined;
      const code: CodeRead =
        reply.kind === 'failed'
          ? { kind: 'failed', why: reply.why }
          : reply.kind === 'noGit'
            ? { kind: 'noGit' }
            : { kind: 'waiting' };
      return { code, answers: undefined };
    }
    const files = parse.code.map((file, index) => ({
      ...file,
      answer: seen(reply.files[index] ?? { kind: 'unread', why: 'Main gave no answer for it.' }),
    }));
    // Read again, but less of it.
    if (
      known?.kind === 'read' &&
      files.some((file, index) => readsLess(known.files[index], file))
    ) {
      return undefined;
    }
    return { code: { kind: 'read', commit, files }, answers: reply.files };
  }
}

/** Whether `now` leaves unread a file read `before`. */
function readsLess(before: { answer: CodeSeen } | undefined, now: { answer: CodeSeen }): boolean {
  return before !== undefined && before.answer.kind !== 'unread' && now.answer.kind === 'unread';
}

/** What main answered of a file, without the bytes it read. */
function seen(answer: CodeAnswer): CodeSeen {
  return answer.kind === 'file'
    ? { kind: 'file', size: answer.size, read: answer.bytes.length }
    : answer;
}

/**
 * What of figure `path`, as main answered it, the check is sent first: all of an SVG it reads
 * whole, else its start, a copy of its own so a port sends no more.
 */
function firstSent(path: string, file: OverviewFile): OverviewFile {
  if (file.kind !== 'file' || file.bytes === null) return file;
  const whole = path.endsWith('.svg') && file.size <= SVG_BYTES;
  if (whole || file.bytes.length <= FIGURE_HEAD) return file;
  return { ...file, bytes: file.bytes.slice(0, FIGURE_HEAD) };
}

/** The pull request `ref`, `refs/lo/pr/<n>`, is for. */
export function prOf(ref: string): number | undefined {
  const number = /^refs\/lo\/pr\/([1-9]\d{0,9})$/.exec(ref)?.[1];
  return number === undefined ? undefined : Number(number);
}

/**
 * A result's key: `commit`, `figures`, the shape of what main read of its figures, and the shape of
 * what was read of its code. A file's contents at a commit never change, so what main read of one
 * is told apart by its kind, its size and how much of it was read.
 */
export function keyOf(commit: OverviewCommit, figures: string, code: CodeRead): string {
  const parts = [commit.id, commit.source, `figures:${figures}`];
  if (code.kind === 'read') {
    parts.push(`code:${code.commit}:${code.files.map(({ answer }) => shape(answer)).join()}`);
  } else {
    parts.push(`code:${code.kind}`);
  }
  return parts.join(' ');
}

function shape(file: OverviewFile | CodeSeen): string {
  switch (file.kind) {
    case 'file':
      return 'read' in file
        ? `file/${file.size ?? '-'}/${file.read}`
        : `file/${file.size}/${file.bytes?.length ?? '-'}`;
    case 'notFile':
      return `notFile/${file.is}`;
    case 'tooLarge':
    case 'missing':
    case 'noCommit':
    case 'refused':
    case 'unread':
      return file.kind;
    default:
      file satisfies never;
      return 'unread';
  }
}
