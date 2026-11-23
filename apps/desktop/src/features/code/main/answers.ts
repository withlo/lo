// Answers from the syntax index, for the code port: a name's definitions, found by name among the
// tree's blobs and ranked by `@lo/syntax`; where it's used, from the blobs whose names include it,
// read again by `code.find` jobs for where; the hover card's line; a file's outline; and the lines
// around a place. Each reads only the tree the asking side shows, from the view's local copy, and
// refuses a tree the view doesn't show or a line the file doesn't have. Nothing here calls Electron.

import { GitError, parseOid, type Oid } from '@lo/git';
import type { Tree } from '@lo/markdown';
import { rank, sameNameLabel, taggedLanguageOfPath, type Asking } from '@lo/syntax';

import { IpcError } from '../../../ipc/contract.ts';
import {
  BYTES_PER_JOB,
  FILE_BYTES,
  type Definition,
  type FileJob,
  type Import,
  type Uses,
} from '../jobs.ts';
import {
  MAX_DEFINITIONS,
  MAX_HOVER,
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SYMBOLS,
  SNIPPET_LINE,
  SNIPPET_LINES,
  SNIPPETS,
  type CodeAnswer,
  type Definitions,
  type Hover,
  type Lines,
  type Outline,
  type References,
} from '../port.ts';
import { inJobs } from './batches.ts';
import type { ReadSymbols } from './build.ts';
import type { CodeRepo, ViewSides } from './indexer.ts';
import type { BlobKey, Found, Kept, Reading, TreeFile } from './store/store.ts';

/** The largest file Lo reads to answer about a place in it. */
export const ASKED_BYTES = 16 * 1024 * 1024;

/** The most definitions of a name read from the store before they're ranked. */
const CANDIDATES = 5_000;

/** What answers read of the store. */
export interface AnswerStore {
  definitions(version: string, tree: string, name: string, limit: number): Promise<Found[]>;
  referrers(version: string, tree: string, name: string, limit: number): Promise<TreeFile[]>;
  kept(version: string, blob: BlobKey): Promise<Kept | undefined>;
  put(version: string, readings: readonly Reading[]): Promise<void>;
}

/** Finds where files use a name, as `code.find` does. */
export type FindUses = (name: string, files: FileJob[], signal?: AbortSignal) => Promise<Uses[]>;

/**
 * A language server's hover, in Markdown, as Lo's tree, as `code.render` reads it, with view
 * `view`'s repository as what `#123` refers to.
 */
export type RenderHover = (view: string, markdown: string, signal?: AbortSignal) => Promise<Tree>;

export interface Answering {
  readonly store: AnswerStore;
  readonly version: () => Promise<string>;
  readonly read: ReadSymbols;
  readonly find: FindUses;
  readonly render: RenderHover;
}

export const BY_NAME = 'By name: may include other things called this.';

/** A file of a view, asked about. */
export interface Asked {
  readonly key: string;
  readonly path: string;
}

/** The file asked about, read. */
export interface AskedFile {
  readonly repo: CodeRepo;
  readonly side: 'old' | 'new';
  readonly commit: Oid;
  /** The side's tree, by the ID the store keeps it by. */
  readonly tree: string;
  readonly path: string;
  readonly oid: Oid;
  readonly bytes: Buffer;
  readonly lines: string[];
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/** A file's lines, without their line breaks; a last line break starts no line. */
export function linesOf(text: string): string[] {
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/** Whether a character can be part of a name. */
const nameCharacter = /[\p{L}\p{N}\p{Mn}\p{Mc}\p{Pc}$]/u;

/**
 * The name at `column` of `line`, or just before it, as at a cursor after a word's end: the run of
 * letters, digits, `_` and `$` around it. None when there's no such run, or it's a number.
 */
export function nameAt(line: string, column: number): string | undefined {
  let at = Math.min(column, line.length);
  if (!nameCharacter.test(line[at] ?? '') && at > 0 && nameCharacter.test(line[at - 1] ?? '')) {
    at -= 1;
  }
  if (!nameCharacter.test(line[at] ?? '')) return undefined;
  let start = at;
  while (start > 0 && nameCharacter.test(line[start - 1] ?? '')) start -= 1;
  let end = at + 1;
  while (end < line.length && nameCharacter.test(line[end] ?? '')) end += 1;
  const name = line.slice(start, end);
  return /^\p{N}/u.test(name) || name.length > 256 ? undefined : name;
}

/** The lines around `line`, {@link SNIPPET_LINES} at most, each cut at {@link SNIPPET_LINE}. */
export function around(lines: readonly string[], line: number): Lines {
  const from = Math.max(1, Math.min(line - 9, lines.length - SNIPPET_LINES + 1));
  const to = Math.min(lines.length, from + SNIPPET_LINES - 1);
  return { from, text: lines.slice(from - 1, to).map((text) => text.slice(0, SNIPPET_LINE)) };
}

function stopped(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new IpcError('cancelled', 'The question was cancelled.');
}

/** Reads blob `oid`, downloading it first if the clone lacks it and can fetch. */
async function blob(repo: CodeRepo, commit: Oid, path: Buffer, oid: Oid): Promise<Buffer> {
  try {
    const found = await repo.readBlob(oid, { maxBytes: ASKED_BYTES });
    if (found) return found;
    if (!repo.offline) await repo.downloadFiles(commit, [path]);
    const downloaded = await repo.readBlob(oid, { maxBytes: ASKED_BYTES });
    if (downloaded) return downloaded;
  } catch (error) {
    if (error instanceof GitError && error.detail.kind === 'tooLarge') {
      throw new IpcError('unavailable', 'This file is too large');
    }
    throw error;
  }
  throw new IpcError('unavailable', 'The local copy doesn’t have it');
}

/**
 * The file a question is about, read from the side whose tree `asked.key` names: refused for a
 * tree the view doesn't show, missing when there's no file there.
 */
export async function readAsked(sides: ViewSides, asked: Asked): Promise<AskedFile> {
  const side =
    asked.key === sides.new.commit
      ? 'new'
      : sides.old !== undefined && asked.key === sides.old.commit
        ? 'old'
        : undefined;
  if (side === undefined) throw new IpcError('refused', "That isn't a tree this view shows.");
  const { commit, tree } = side === 'new' ? sides.new : (sides.old ?? sides.new);
  const repo = await sides.clone();
  if (!repo) throw new IpcError('unavailable', "The pull request's local copy isn't open.");
  const path = Buffer.from(asked.path, 'utf8');
  let version;
  try {
    version = await repo.fileVersion(commit, path);
  } catch (error) {
    if (!(error instanceof GitError)) throw error;
    version = undefined;
  }
  if (!version || (version.mode !== 'regular' && version.mode !== 'executable')) {
    throw new IpcError('missing', `There's no file at ${asked.path} in that tree.`);
  }
  const bytes = await blob(repo, commit, path, version.oid);
  return {
    repo,
    side,
    commit,
    tree: tree ?? (await repo.treeId(commit)),
    path: asked.path,
    oid: version.oid,
    bytes,
    lines: linesOf(decoder.decode(bytes)),
  };
}

/** Refuses a line past the end of `file`. */
export function checkLine(file: AskedFile, line: number): void {
  if (line > Math.max(1, file.lines.length)) {
    throw new IpcError(
      'invalid',
      `Line ${line} is past the end of ${file.path}, which has ${file.lines.length}.`,
    );
  }
}

/** What the index has of the asked file's own symbols, read now if it hasn't. */
export async function symbolsOf(
  answering: Answering,
  version: string,
  file: AskedFile,
): Promise<{ definitions: Definition[]; imports: Import[]; namespace?: string | undefined }> {
  const language = taggedLanguageOfPath(file.path);
  if (language === undefined) return { definitions: [], imports: [] };
  const key = { oid: file.oid, language };
  const kept = await answering.store.kept(version, key);
  if (kept) return kept;
  // The index reads no larger file.
  if (file.bytes.byteLength > FILE_BYTES) return { definitions: [], imports: [] };
  const reply = await answering.read([{ language, bytes: new Uint8Array(file.bytes) }]);
  const [result] = reply.files;
  if (!result) return { definitions: [], imports: [] };
  await answering.store.put(reply.version, [{ ...key, read: result }]);
  return 'symbols' in result ? result.symbols : { definitions: [], imports: [] };
}

/**
 * Whether the pull request changes each of `paths`, given their blobs on the asked side: they're
 * the same on the other side, or there's no other side.
 */
export async function changes(
  file: AskedFile,
  sides: ViewSides,
  answers: readonly { path: string; oid: string }[],
): Promise<boolean[]> {
  const other = file.side === 'new' ? sides.old : sides.new;
  if (!other || answers.length === 0) return answers.map(() => true);
  const there = await file.repo.fileVersions(
    other.commit,
    answers.map((answer) => Buffer.from(answer.path, 'utf8')),
  );
  return answers.map((answer, index) => {
    const found = there[index];
    return found === undefined || found === 'folder' || found.oid !== answer.oid;
  });
}

/** Adds the lines around each of the first few answers, read from their blobs. */
export async function withLines(
  file: AskedFile,
  answers: CodeAnswer[],
  oids: readonly string[],
): Promise<void> {
  const texts = new Map<string, string[] | undefined>();
  for (const [index, answer] of answers.slice(0, SNIPPETS).entries()) {
    const oid = oids[index];
    if (oid === undefined) continue;
    if (!texts.has(oid)) {
      const bytes =
        oid === file.oid
          ? file.bytes
          : await file.repo
              .readBlob(parseOid(oid), { maxBytes: ASKED_BYTES })
              .catch(() => undefined);
      texts.set(oid, bytes && linesOf(decoder.decode(bytes)));
    }
    const lines = texts.get(oid);
    if (lines) answer.lines = around(lines, answer.line);
  }
}

/** The name at a place in the asked file, which must have the line. */
export function askedName(file: AskedFile, line: number, column: number): string | undefined {
  checkLine(file, line);
  return nameAt(file.lines[line - 1] ?? '', column);
}

/** The definitions of the name at a place, ranked, the first few with their lines. */
export async function definitions(
  answering: Answering,
  sides: ViewSides,
  at: Asked & { line: number; column: number },
  signal?: AbortSignal,
  given?: AskedFile,
): Promise<Definitions & { answers: CodeAnswer[] }> {
  const file = given ?? (await readAsked(sides, at));
  const name = askedName(file, at.line, at.column);
  if (name === undefined) return { name: null, answers: [], more: false };
  const version = await answering.version();
  const own = await symbolsOf(answering, version, file);
  stopped(signal);
  const found = await answering.store.definitions(version, file.tree, name, CANDIDATES);
  const asking: Asking = { path: file.path, imports: own.imports, namespace: own.namespace };
  const ranked = rank(name, asking, found);
  const shown = ranked.slice(0, MAX_DEFINITIONS);
  const changed = await changes(
    file,
    sides,
    shown.map(({ candidate }) => candidate),
  );
  const answers = shown.map(({ candidate, label }, index): CodeAnswer => ({
    key: at.key,
    side: file.side,
    path: candidate.path,
    line: candidate.line,
    column: candidate.column,
    name,
    kind: candidate.kind,
    source: 'syntax',
    label,
    changed: changed[index] ?? true,
  }));
  await withLines(
    file,
    answers,
    shown.map(({ candidate }) => candidate.oid),
  );
  return {
    name,
    answers,
    more: ranked.length > MAX_DEFINITIONS || found.length >= CANDIDATES,
  };
}

/**
 * Where the name at a place is used, by name: in the asked file first, then the tree's other files
 * that refer to it, in path order, {@link MAX_REFERENCE_FILES} files and {@link MAX_REFERENCES}
 * uses at most.
 */
export async function references(
  answering: Answering,
  sides: ViewSides,
  at: Asked & { line: number; column: number },
  signal?: AbortSignal,
  given?: AskedFile,
): Promise<References> {
  const file = given ?? (await readAsked(sides, at));
  const name = askedName(file, at.line, at.column);
  if (name === undefined) return { name: null, answers: [], more: false, note: BY_NAME };
  const version = await answering.version();
  const listed = await answering.store.referrers(version, file.tree, name, MAX_REFERENCE_FILES + 1);
  let more = listed.length > MAX_REFERENCE_FILES;
  const files = listed
    .slice(0, MAX_REFERENCE_FILES)
    .toSorted((a, b) => Number(b.path === file.path) - Number(a.path === file.path));
  const lacking = new Set<string>(
    await file.repo.missingObjects(files.map((each) => parseOid(each.oid))),
  );
  const readable = files.filter((each) => !lacking.has(each.oid));
  // Each blob is looked through once for each language it's read as, however many paths hold it,
  // and what's found there goes to every one of them.
  const blobs = new Map<Oid, HeldBlob[]>();
  for (const each of readable) {
    const oid = parseOid(each.oid);
    const languages = blobs.get(oid) ?? [];
    const held = languages.find((known) => known.language === each.language);
    if (held) held.files.push(each);
    else languages.push({ language: each.language, files: [each] });
    blobs.set(oid, languages);
  }
  const usesOf = new Map<TreeFile, readonly Use[]>();
  let count = 0;
  reading: for await (const batch of file.repo.readBlobs([...blobs.keys()], {
    maxBytes: BYTES_PER_JOB,
  })) {
    stopped(signal);
    const looked = batch.flatMap((contents) =>
      (blobs.get(contents.oid) ?? []).map((held) => ({ held, bytes: contents.data })),
    );
    for (const { held, uses } of await findAll(answering, name, looked, signal)) {
      for (const each of held.files) usesOf.set(each, uses);
      count += uses.length * held.files.length;
      if (count > MAX_REFERENCES) {
        more = true;
        break reading;
      }
    }
  }
  // In the files' order, the asked file first, up to the cap.
  const shown: { file: TreeFile; line: number; column: number }[] = [];
  listing: for (const each of files) {
    for (const use of usesOf.get(each) ?? []) {
      if (shown.length === MAX_REFERENCES) {
        more = true;
        break listing;
      }
      shown.push({ file: each, ...use });
    }
  }
  const changed = await changes(
    file,
    sides,
    shown.map((use) => use.file),
  );
  const answers = shown.map((use, index): CodeAnswer => ({
    key: at.key,
    side: file.side,
    path: use.file.path,
    line: use.line,
    column: use.column,
    name,
    source: 'syntax',
    label: sameNameLabel,
    changed: changed[index] ?? true,
  }));
  await withLines(
    file,
    answers,
    shown.map((use) => use.file.oid),
  );
  return { name, answers, more, note: BY_NAME };
}

/** Where `name` is used, as a `code.find` job finds it in a file. */
interface Use {
  readonly line: number;
  readonly column: number;
}

/** A blob read as one language, and the tree's files that hold it. */
interface HeldBlob {
  readonly language: string;
  readonly files: TreeFile[];
}

/**
 * Where each of `blobs` uses `name`, in jobs within the background process's per-job limits. A
 * blob a job didn't get to goes in the next; one it skipped uses the name nowhere.
 */
async function findAll(
  answering: Answering,
  name: string,
  blobs: readonly { held: HeldBlob; bytes: Buffer }[],
  signal: AbortSignal | undefined,
): Promise<{ held: HeldBlob; uses: Use[] }[]> {
  const found: { held: HeldBlob; uses: Use[] }[] = [];
  const queue = inJobs(blobs, ({ bytes }) => bytes.byteLength);
  while (queue.length > 0) {
    const batch = queue.shift() ?? [];
    stopped(signal);
    const jobs = batch.map(({ held, bytes }) => ({
      language: held.language,
      bytes: new Uint8Array(bytes),
    }));
    const uses = await answering.find(name, jobs, signal);
    const again = batch.filter((_, index) => uses[index] === null);
    for (const [index, item] of batch.entries()) {
      const result = uses[index];
      if (result && 'uses' in result) found.push({ held: item.held, uses: result.uses });
    }
    if (again.length > 0 && again.length < batch.length) queue.unshift(again);
  }
  return found;
}

/** The hover card for the name at a place: its top definition's line and kind. */
export async function hover(
  answering: Answering,
  sides: ViewSides,
  at: Asked & { line: number; column: number },
  signal?: AbortSignal,
  given?: AskedFile,
): Promise<Hover | null> {
  const found = await definitions(answering, sides, at, signal, given);
  const [top] = found.answers;
  if (!top || found.name === null) return null;
  const line = top.lines?.text[top.line - top.lines.from] ?? '';
  return {
    name: found.name,
    kind: top.kind,
    text: line.trim().slice(0, MAX_HOVER),
    markdown: false,
    source: 'syntax',
    label: top.label,
    at: top,
  };
}

/** A file's symbols, nested, {@link MAX_SYMBOLS} at most. */
export async function outline(
  answering: Answering,
  sides: ViewSides,
  asked: Asked,
  given?: AskedFile,
): Promise<Outline> {
  const file = given ?? (await readAsked(sides, asked));
  const version = await answering.version();
  const { definitions: all } = await symbolsOf(answering, version, file);
  const symbols = all.slice(0, MAX_SYMBOLS).map((definition) => {
    const { parent, ...symbol } = definition;
    return parent !== undefined && parent < MAX_SYMBOLS ? { ...symbol, parent } : symbol;
  });
  return { symbols, more: all.length > MAX_SYMBOLS, source: 'syntax' };
}

/** The lines around a line of a file. */
export async function snippet(sides: ViewSides, at: Asked & { line: number }): Promise<Lines> {
  const file = await readAsked(sides, at);
  checkLine(file, at.line);
  return around(file.lines, at.line);
}
