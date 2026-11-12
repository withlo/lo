// A pull request's tab's overview, checked, in the window. As main says which overview the tab
// shows, `artifact.md` is read in the background process, main is asked for the figures and the
// code it names, and the overview is checked there against what main read. Until the local copy is
// there, it's checked with no code, so each target is unread, and again once it is; without git,
// its code stays unread. What's published changes only when the check's result could: a result
// with the same key as the one before is the same, and isn't published again, so a view keeping
// what it drew by the parse's objects keeps them.

import type { CheckedArtifact, ParsedArtifact } from '@lo/artifact';

import type {
  CodeAccess,
  CodeAnswer,
  CodeReply,
  OverviewCommit,
  OverviewFile,
  OverviewState,
} from '../contract.ts';
import type { CheckInput, CodeFile, Parsed } from '../jobs.ts';

/** The overview's text, by its path in the commit. */
const ARTIFACT = 'artifact.md';

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
  | { kind: 'read'; commit: string; files: (CodeFile & { answer: CodeAnswer })[] };

/**
 * A tab's overview, checked:
 *
 * - `key`: the same as another result's exactly when the two are the same: the commit, and the
 *   shape of what main read of its figures and code;
 * - `parsed`: `artifact.md`, read, the same object for as long as the commit is on screen; none
 *   when main didn't read it, as for an overview too large to read;
 * - `checked`: what checking found. A shown overview's code follows `parsed.references`, and its
 *   figures `parsed.figures`, one for one;
 * - `figures`: what main read of each figure, by its path, to draw what the check kept;
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
  figures: { path: string; file: OverviewFile }[];
}

export class Checking {
  readonly #id: string;
  readonly #parts: CheckingParts;
  /** The overview on screen, and the pull request whose ref holds it. */
  #commit: OverviewCommit | undefined;
  #pr = 0;
  #access: CodeAccess = 'waiting';
  #read: Read | undefined;
  #code: CodeRead = { kind: 'none' };
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
    this.#code = { kind: 'none' };
    this.#failed = false;
  }

  /**
   * Whether the code could be read differently now: it wasn't read, or some of it is still unread.
   * An overview that names none never reads any.
   */
  #readsMore(): boolean {
    const code = this.#code;
    if (code.kind === 'none') return false;
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
    const code = await this.#readCode(read.parse, signal);
    if (signal.aborted) return;
    this.#code = code;
    const key = keyOf(commit, read.figures, code);
    if (key === this.#published) return;
    const checked = await this.#parts.check(
      {
        artifact: read.artifact,
        entries: commit.entries,
        pr: this.#pr,
        figures: read.figures,
        code:
          code.kind === 'read'
            ? {
                commit: code.commit,
                files: code.files.map(({ path, answer }) => ({ path, answer })),
              }
            : null,
      },
      signal,
    );
    if (signal.aborted) return;
    this.#published = key;
    this.#parts.publish({
      kind: 'checked',
      key,
      commit,
      parsed: read.parse?.parsed,
      checked,
      figures: new Map(read.figures.map(({ path, file }) => [path, file])),
      code,
    });
  }

  /** `artifact.md`, read, and the figures it shows, as main has them. */
  async #readCommit(commit: OverviewCommit, signal: AbortSignal): Promise<Read> {
    // Main reads no file of a commit its listing says is too large, or that holds no artifact.md.
    if (!commit.read) return { artifact: null, parse: undefined, figures: [] };
    const [text] = await this.#parts.files({ id: this.#id, commit: commit.id, paths: [ARTIFACT] });
    if (text?.kind === 'unread') throw new Error(`Lo couldn't read artifact.md: ${text.why}`);
    // The listing says what else it is, which the check reports.
    if (text?.kind !== 'file' || text.bytes === null) {
      return { artifact: null, parse: undefined, figures: [] };
    }
    const artifact = text.bytes;
    const parse = await this.#parts.parse({ artifact }, signal);
    if (signal.aborted || parse.figures.length === 0) return { artifact, parse, figures: [] };
    const answers = await this.#parts.files({
      id: this.#id,
      commit: commit.id,
      paths: parse.figures,
    });
    const figures = parse.figures.map((path, index) => ({
      path,
      file: answers[index] ?? { kind: 'unread' as const, why: 'Main gave no answer for it.' },
    }));
    return { artifact, parse, figures };
  }

  /** The code the overview names, read at its header's commit once the local copy is there. */
  async #readCode(parse: Parsed | undefined, signal: AbortSignal): Promise<CodeRead> {
    const commit = parse?.parsed.header?.commit;
    if (!parse || commit === undefined || parse.code.length === 0) return { kind: 'none' };
    // What was read stays read, the code at a commit never changing, until more can be read.
    const known = this.#code;
    const readable = this.#access === 'ready' || this.#access === 'offline';
    if (known.kind === 'read' && (!this.#readsMore() || !readable)) return known;
    switch (this.#access) {
      case 'waiting':
        return { kind: 'waiting' };
      case 'noGit':
        return { kind: 'noGit' };
      case 'failed':
        return { kind: 'failed', why: "The pull request's local copy couldn't be fetched." };
      case 'ready':
      case 'offline':
        break;
      default:
        this.#access satisfies never;
        return { kind: 'waiting' };
    }
    const reply = await this.#parts.code({ id: this.#id, commit, files: parse.code });
    if (signal.aborted) return known;
    switch (reply.kind) {
      case 'read':
        return {
          kind: 'read',
          commit,
          files: parse.code.map((file, index) => ({
            ...file,
            answer: reply.files[index] ?? { kind: 'unread', why: 'Main gave no answer for it.' },
          })),
        };
      case 'waiting':
      case 'noGit':
        return { kind: reply.kind };
      case 'failed':
        return { kind: 'failed', why: reply.why };
      default:
        reply satisfies never;
        return { kind: 'waiting' };
    }
  }
}

/** The pull request `ref`, `refs/lo/pr/<n>`, is for. */
export function prOf(ref: string): number | undefined {
  const number = /^refs\/lo\/pr\/([1-9]\d{0,9})$/.exec(ref)?.[1];
  return number === undefined ? undefined : Number(number);
}

/**
 * A result's key: `commit`, and the shape of what was read of its figures and code. A file's
 * contents at a commit never change, so what main read of one is told apart by its kind, its size
 * and how much of it was read.
 */
export function keyOf(
  commit: OverviewCommit,
  figures: readonly { file: OverviewFile }[],
  code: CodeRead,
): string {
  const parts = [
    commit.id,
    commit.source,
    `figures:${figures.map(({ file }) => shape(file)).join()}`,
  ];
  if (code.kind === 'read') {
    parts.push(`code:${code.commit}:${code.files.map(({ answer }) => shape(answer)).join()}`);
  } else {
    parts.push(`code:${code.kind}`);
  }
  return parts.join(' ');
}

function shape(file: OverviewFile | CodeAnswer): string {
  switch (file.kind) {
    case 'file':
      return `file/${file.size ?? '-'}/${file.bytes?.length ?? '-'}`;
    case 'notFile':
      return `notFile/${file.is}`;
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
