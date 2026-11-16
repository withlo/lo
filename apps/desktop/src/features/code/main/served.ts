// Answers a language server gives first. On the new side of a view the reader trusts, once the
// server for the file's language is ready, its answer within its deadline wins, alone:
//
// - `definitions` within 2 s, or the adapter's own deadline for a slower server. An empty answer
//   gives the asking file's import of the name, if it has one, then the syntax index's answers;
// - `references` within 10 s, `hover` within 1.5 s, `hints` within 3 s and `outline` within 3 s.
//   A hover in Markdown is read into Lo's tree by the background process (`code.render`), and a
//   server with no type hints, by what it offers or what its adapter says, isn't asked for them.
//   A server that finds references only from a declaration, as its adapter says, is asked where
//   the reader is first; when it finds none there it's asked for the definition, then for the
//   references at it, all within the 10 s, and with no definition in the repository the index
//   answers, saying why.
//   Each file is opened on the server as its own language, by its own path.
//
// When the server is starting, waiting for room, refused, slow, stopped or failed, the syntax index
// answers, with why the server didn't (`fallback`), and a late answer is dropped. The old side
// always answers from the index, since servers run only on the head; so does a file whose checkout
// isn't the head's blob, as when two of its names fold together on disk, and a checkout that isn't
// usable at all, saying so, as one its local copy was made again without. A place a server names
// outside the checkout, or a file of the checkout that isn't in the head's tree, is never read: it
// shows as outside the repository, with the asking file's import of the name where there's one.
//
// What a server answers is read as untrusted: each place, symbol and hint is checked, anything
// malformed is dropped, and lists are cut at the port's limits before they're read. Nothing here
// calls Electron.

import type { Oid } from '@lo/git';
import type { Asked as Params, Method, NoAnswer, RequestOptions } from '@lo/lsp';
import type { Tree } from '@lo/markdown';
import { importOf, syntaxLabel } from '@lo/syntax';
import { z } from 'zod';

import { IpcError } from '../../../ipc/contract.ts';
import type { DefinitionKind } from '../jobs.ts';
import {
  MAX_DEFINITIONS,
  MAX_HINTS,
  MAX_HOVER,
  MAX_REFERENCES,
  MAX_SYMBOLS,
  type CodeAnswer,
  type Definitions,
  type Hint,
  type Hints,
  type Hover,
  type NoHover,
  type Outline,
  type OutlineSymbol,
  type OutsideAnswer,
  type References,
} from '../port.ts';
import {
  around,
  askedName,
  changes,
  checkLine,
  definitions,
  hover,
  outline,
  readAsked,
  references,
  symbolsOf,
  withLines,
  type Answering,
  type AskedFile,
} from './answers.ts';
import type { ViewSides } from './indexer.ts';
import type { Found, Running } from './servers.ts';

/** How long each question waits for a server, in milliseconds. */
export const DEADLINES = {
  definitions: 2_000,
  references: 10_000,
  hover: 1_500,
  hints: 3_000,
  outline: 3_000,
} as const;

/** A view's server for the file asked about, ready to be asked. */
export interface Serving {
  readonly kind: 'ready';
  /** Its name, which labels its answers: "TypeScript". */
  readonly name: string;
  /**
   * The protocol's id for the language of the file at `path`, which it's opened as, or nothing for
   * a file the server doesn't read: from a `.tfvars` file, the `.tf` file declaring its variable is
   * still `terraform`.
   */
  languageOf(path: string): string | undefined;
  /** How long `definitions` waits for it, when it isn't the usual. */
  readonly definitionDeadline?: number | undefined;
  /**
   * Whether it finds references only from a declaration, as terraform-ls does, so that asked at a
   * use it finds none: when it finds none where the reader is, Lo asks it for the definition, then
   * for the references there.
   */
  readonly referencesFromDefinition?: boolean | undefined;
  /**
   * Why it has no type hints to give Lo, when its adapter says so, as of a paid feature: Lo never
   * asks it for them. The adapters fill it.
   */
  readonly noHints?: string | undefined;
  /**
   * Why it gives no references Lo can use, when its adapter says so, as of one that finds them only
   * from a build's index: `gr` answers from the syntax index, and Lo never asks it.
   */
  readonly noReferences?: string | undefined;
  readonly server: Pick<Running, 'open' | 'request' | 'pathOf' | 'capabilities'>;
  /**
   * Whether the checkout's file at `path` is blob `oid`, the head's, which the server reads too; or,
   * when the checkout itself isn't usable, as one the local copy no longer counts as its own,
   * whether Lo is making it again (`remaking`) or couldn't (`unusable`).
   */
  matches(path: string, oid: Oid): Promise<boolean | 'remaking' | 'unusable'>;
}

/**
 * A view's server for the file asked about, when it can't answer: where it is instead, as the pool
 * finds it. It's on its way; `waiting` in line for room, as Lo runs `count` at once at most;
 * `refused` on this checkout, as `why` says, as its status does; `missing` the toolchain it
 * `needs`; `failed`, waiting for "Restart"; or `stopped`.
 */
export type NotServing = { readonly name: string } & Exclude<Found, { readonly kind: 'ready' }>;

/** The server for a file of a view's new side, at the side's commit, if one reads its language. */
export type ServerOf = (file: {
  readonly commit: Oid;
  readonly path: string;
}) => Serving | NotServing | undefined;

/** A place in a file asked about. */
export interface At {
  readonly view: string;
  readonly key: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
}

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * What the syntax index's answers say when a server that reads the file can't answer: where it is,
 * as its item in the status bar says.
 */
function waitingFor(serving: NotServing): string {
  const { name } = serving;
  switch (serving.kind) {
    case 'starting':
      return `${name} is starting.`;
    case 'waiting':
      return `${name} is waiting to start. Lo runs ${serving.count} language servers at once at most.`;
    case 'refused':
      return serving.why;
    case 'missing':
      return `${name} needs ${serving.needs}.`;
    case 'failed':
      return `${name} failed. Restart it from the status bar.`;
    case 'stopped':
      return `${name} stopped.`;
    default:
      serving satisfies never;
      throw new Error(`a server's state Lo doesn't know: ${JSON.stringify(serving)}`);
  }
}

/**
 * What the syntax index's answers say when the server's checkout isn't usable, and whether Lo is
 * making it again.
 */
function unusableCheckout(name: string, remaking: boolean): string {
  const why = `${name} can't run: this PR's checkout isn't usable.`;
  return remaking ? `${why} Lo is making it again.` : why;
}

/** Why a server's request has no answer, as the syntax index's answers say it. */
function fallbackOf(name: string, why: NoAnswer): string {
  switch (why) {
    case 'notReady':
    case 'notOpen':
      return `${name} is starting.`;
    case 'stopped':
      return `${name} stopped.`;
    case 'busy':
    case 'deadline':
      return `${name} didn't answer in time.`;
    case 'declined':
    case 'failed':
      return `${name} didn't answer.`;
    case 'cancelled':
    case 'replaced':
      throw new IpcError('cancelled', 'The question was cancelled.');
    default:
      throw new Error(`a request's end Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** What asking a server came to: its answer, unchecked, or why there's none to show. */
type Asking =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly fallback?: string };

/**
 * Asks `serving` about `file`, once the checkout's file is the head's blob and it's open on the
 * server with its text from git, as its own language.
 */
async function ask<M extends Method>(
  serving: Serving,
  file: AskedFile,
  method: M,
  params: Params<M>,
  options: RequestOptions,
): Promise<Asking> {
  // The server reads the file on disk too: one that isn't the head's would answer about other text.
  const matched = await serving.matches(file.path, file.oid);
  if (matched === 'remaking' || matched === 'unusable') {
    return { ok: false, fallback: unusableCheckout(serving.name, matched === 'remaking') };
  }
  if (!matched) return { ok: false };
  if (options.signal?.aborted) throw new IpcError('cancelled', 'The question was cancelled.');
  const languageId = serving.languageOf(file.path);
  if (languageId === undefined) return { ok: false, fallback: `${serving.name} doesn't read it.` };
  if (!serving.server.open(file.path, languageId, decoder.decode(file.bytes))) {
    return { ok: false, fallback: `${serving.name} is starting.` };
  }
  const answer = await serving.server.request(method, params, options);
  if (answer.ok) return answer;
  return { ok: false, fallback: fallbackOf(serving.name, answer.why) };
}

const position = z.object({
  line: z.number().int().min(0).max(100_000_000),
  character: z.number().int().min(0).max(100_000_000),
});
const range = z.object({ start: position, end: position });
const location = z.object({ uri: z.string().max(8192), range });
const locationLink = z.object({ targetUri: z.string().max(8192), targetSelectionRange: range });

/** A place a server named: its file's URI, and where in it, from 0. */
interface Located {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
}

/**
 * The places in a definition's or references' answer, `limit` at most: a location, a link, or a
 * list of either, each checked; what's malformed is dropped. Nothing when none of it is usable.
 */
export function locationsOf(value: unknown, limit: number): Located[] | undefined {
  if (value === null) return [];
  const list: unknown[] = Array.isArray(value) ? value : [value];
  const found: Located[] = [];
  for (const each of list.slice(0, limit)) {
    const plain = location.safeParse(each);
    if (plain.success) {
      found.push({ uri: plain.data.uri, ...plain.data.range.start });
      continue;
    }
    const link = locationLink.safeParse(each);
    if (link.success)
      found.push({ uri: link.data.targetUri, ...link.data.targetSelectionRange.start });
  }
  return found.length === 0 && list.length > 0 ? undefined : found;
}

/** The places a server named, in the head's tree or outside the repository. */
interface Placed {
  readonly inside: CodeAnswer[];
  readonly outside: number;
}

/**
 * Where each of `places` is: a file of the head's tree, by its path in the checkout, or outside the
 * repository, as is a file of the checkout the tree doesn't have, such as a build's output. The
 * first few come with their lines, read from git.
 */
async function place(
  serving: Serving,
  file: AskedFile,
  sides: ViewSides,
  name: string,
  places: readonly Located[],
): Promise<Placed> {
  const paths = places.map((each) => serving.server.pathOf(each.uri));
  const unique = [...new Set(paths.filter((path) => path !== undefined))];
  const versions = await file.repo.fileVersions(
    file.commit,
    unique.map((path) => Buffer.from(path, 'utf8')),
  );
  const blobs = new Map<string, string>();
  for (const [index, path] of unique.entries()) {
    const version = versions[index];
    if (
      version !== undefined &&
      version !== 'folder' &&
      (version.mode === 'regular' || version.mode === 'executable')
    ) {
      blobs.set(path, version.oid);
    }
  }
  const seen = new Set<string>();
  const inside: { answer: CodeAnswer; oid: string }[] = [];
  let outside = 0;
  for (const [index, each] of places.entries()) {
    const path = paths[index];
    const oid = path === undefined ? undefined : blobs.get(path);
    if (path === undefined || oid === undefined) {
      outside += 1;
      continue;
    }
    const key = `${path}\n${each.line}\n${each.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    inside.push({
      oid,
      answer: {
        key: file.commit,
        side: file.side,
        path,
        line: each.line + 1,
        column: each.character,
        name,
        source: 'server',
        label: serving.name,
        changed: true,
      },
    });
  }
  const changed = await changes(
    file,
    sides,
    inside.map(({ answer, oid }) => ({ path: answer.path, oid })),
  );
  const answers = inside.map(({ answer }, index) => ({
    ...answer,
    changed: changed[index] ?? true,
  }));
  await withLines(
    file,
    answers,
    inside.map(({ oid }) => oid),
  );
  return { inside: answers, outside };
}

/** The asking file's import of `name`, as an answer, if it has one. */
async function importAnswer(
  answering: Answering,
  sides: ViewSides,
  file: AskedFile,
  name: string,
): Promise<CodeAnswer | undefined> {
  const own = await symbolsOf(answering, await answering.version(), file);
  const found = importOf(own.imports, name);
  if (!found) return undefined;
  const { line, module } = found.from;
  const text = file.lines[line - 1] ?? '';
  const column = Math.max(0, text.indexOf(name));
  const [changed = true] = await changes(file, sides, [{ path: file.path, oid: file.oid }]);
  return {
    key: file.commit,
    side: file.side,
    path: file.path,
    line,
    column,
    name,
    source: 'syntax',
    label: syntaxLabel,
    changed,
    lines: around(file.lines, line),
    from: module,
  };
}

/** The file asked about, and the server that reads it there, if one does. */
async function asked(sides: ViewSides, at: Omit<At, 'line' | 'column'>, serverOf: ServerOf) {
  const file = await readAsked(sides, at);
  const serving =
    file.side === 'new' ? serverOf({ commit: file.commit, path: file.path }) : undefined;
  return { file, serving };
}

/** The position the protocol names a place by: its line and column from 0. */
function positionOf(at: At) {
  return { line: at.line - 1, character: at.column };
}

/** `found`, saying why a server didn't answer, if one could have. */
function withFallback<T extends object>(found: T, fallback: string | undefined): T {
  return fallback === undefined ? found : { ...found, fallback };
}

/** The definitions of the name at a place: the server's, else the syntax index's. */
export async function servedDefinitions(
  answering: Answering,
  sides: ViewSides,
  at: At,
  signal: AbortSignal | undefined,
  serverOf: ServerOf,
): Promise<Definitions> {
  const { file, serving } = await asked(sides, at, serverOf);
  const name = askedName(file, at.line, at.column);
  const syntax = async (fallback?: string) =>
    withFallback(await definitions(answering, sides, at, signal, file), fallback);
  if (name === undefined || !serving) return syntax();
  if (serving.kind !== 'ready') return syntax(waitingFor(serving));
  const answer = await ask(
    serving,
    file,
    'textDocument/definition',
    { path: file.path, position: positionOf(at) },
    { deadline: serving.definitionDeadline ?? DEADLINES.definitions, signal },
  );
  if (!answer.ok) return syntax(answer.fallback);
  const places = locationsOf(answer.value, MAX_DEFINITIONS + 1);
  if (places === undefined) return syntax(`${serving.name} didn't answer.`);
  if (places.length === 0) {
    // It found nothing in the repository: the asking file's import of the name, then the index's.
    const [found, imported] = await Promise.all([
      definitions(answering, sides, at, signal, file),
      importAnswer(answering, sides, file, name),
    ]);
    return imported ? { ...found, answers: [imported, ...found.answers] } : found;
  }
  const { inside, outside } = await place(
    serving,
    file,
    sides,
    name,
    places.slice(0, MAX_DEFINITIONS),
  );
  const answers: (CodeAnswer | OutsideAnswer)[] = [...inside];
  if (outside > 0) {
    const imported = await importAnswer(answering, sides, file, name);
    if (imported) answers.push(imported);
    answers.push({ outside: true, name, source: 'server', label: serving.name });
  }
  return { name, answers, more: places.length > MAX_DEFINITIONS };
}

/** Where the name at a place is used: the server's answer, else the syntax index's, by name. */
export async function servedReferences(
  answering: Answering,
  sides: ViewSides,
  at: At,
  signal: AbortSignal | undefined,
  serverOf: ServerOf,
): Promise<References> {
  const { file, serving } = await asked(sides, at, serverOf);
  const name = askedName(file, at.line, at.column);
  const syntax = async (fallback?: string) =>
    withFallback(await references(answering, sides, at, signal, file), fallback);
  if (name === undefined || !serving) return syntax();
  if (serving.kind !== 'ready') return syntax(waitingFor(serving));
  if (serving.noReferences !== undefined) return syntax(serving.noReferences);
  // One deadline for every request `gr` makes, as many as three for a server asked at a definition.
  const ends = performance.now() + DEADLINES.references;
  const left = () => Math.floor(ends - performance.now());
  const late = () => syntax(fallbackOf(serving.name, 'deadline'));
  const referencesAt = (from: Spot) =>
    ask(
      serving,
      from.file,
      'textDocument/references',
      { path: from.file.path, position: from.position, context: { includeDeclaration: true } },
      { deadline: left(), signal },
    );
  const here: Spot = { file, position: positionOf(at) };
  let answer = await referencesAt(here);
  if (!answer.ok) return syntax(answer.fallback);
  let places = locationsOf(answer.value, MAX_REFERENCES + 1);
  if (places === undefined) return syntax(`${serving.name} didn't answer.`);
  if (places.length === 0 && serving.referencesFromDefinition === true) {
    // It finds references only from a declaration, and this may be a use: ask at its definition.
    if (left() < 1) return late();
    const deadline = Math.min(serving.definitionDeadline ?? DEADLINES.definitions, left());
    const found = await definitionOf(serving, sides, file, at, { deadline, signal });
    // With no definition, this may be a declaration nothing uses.
    if (found === undefined) return syntax(`${serving.name} found no references there.`);
    if ('fallback' in found) return syntax(found.fallback);
    if (!sameSpot(found, here)) {
      if (left() < 1) return late();
      answer = await referencesAt(found);
      if (!answer.ok) return syntax(answer.fallback);
      places = locationsOf(answer.value, MAX_REFERENCES + 1);
      if (places === undefined) return syntax(`${serving.name} didn't answer.`);
    }
  }
  const { inside, outside } = await place(
    serving,
    file,
    sides,
    name,
    places.slice(0, MAX_REFERENCES),
  );
  return {
    name,
    answers: inside,
    more: places.length > MAX_REFERENCES,
    ...(outside > 0 ? { outside } : {}),
  };
}

/** A place in a file of the head's tree, read from git, by the protocol's position. */
interface Spot {
  readonly file: AskedFile;
  readonly position: { readonly line: number; readonly character: number };
}

/** Whether `a` and `b` are the same place. */
function sameSpot(a: Spot, b: Spot): boolean {
  return (
    a.file.path === b.file.path &&
    a.position.line === b.position.line &&
    a.position.character === b.position.character
  );
}

/**
 * Where `serving` says the name at `at` in `file` is defined: the first place it names, in a file
 * of the head's tree it reads, read from git; nothing when it names none; or why there's no place
 * to ask about.
 */
async function definitionOf(
  serving: Serving,
  sides: ViewSides,
  file: AskedFile,
  at: At,
  options: RequestOptions,
): Promise<Spot | { readonly fallback: string | undefined } | undefined> {
  const answer = await ask(
    serving,
    file,
    'textDocument/definition',
    { path: file.path, position: positionOf(at) },
    options,
  );
  if (!answer.ok) return { fallback: answer.fallback };
  const [first] = locationsOf(answer.value, 1) ?? [];
  if (first === undefined) return undefined;
  const outside = { fallback: `${serving.name} found its definition outside the repository.` };
  const path = serving.server.pathOf(first.uri);
  if (path === undefined) return outside;
  if (serving.languageOf(path) === undefined) {
    return { fallback: `${serving.name} found its definition in a file it doesn't read.` };
  }
  try {
    const defined = await readAsked(sides, { key: at.key, path });
    return { file: defined, position: { line: first.line, character: first.character } };
  } catch (error) {
    // A file of the checkout that isn't in the head's tree, such as a build's output.
    if (error instanceof IpcError && error.code === 'missing') return outside;
    throw error;
  }
}

const markup = z.object({ kind: z.string(), value: z.string() });
const marked = z.union([z.string(), z.object({ language: z.string(), value: z.string() })]);

/** `code` in a Markdown fence longer than any run of backticks inside it. */
function fenced(language: string, code: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language.replace(/[^\w+#.-]/g, '')}\n${code}\n${fence}`;
}

/**
 * A hover's text, as Markdown or plain text, cut at the port's limit: empty for no hover. Nothing
 * when it's malformed.
 */
export function hoverText(value: unknown): { text: string; markdown: boolean } | undefined {
  if (value === null) return { text: '', markdown: false };
  const parsed = z.object({ contents: z.unknown() }).safeParse(value);
  if (!parsed.success) return undefined;
  const { contents } = parsed.data;
  const content = markup.safeParse(contents);
  if (content.success) {
    return {
      text: content.data.value.slice(0, MAX_HOVER),
      markdown: content.data.kind === 'markdown',
    };
  }
  const list: unknown[] = Array.isArray(contents) ? contents.slice(0, 64) : [contents];
  const parts: string[] = [];
  for (const each of list) {
    const part = marked.safeParse(each);
    if (!part.success) continue;
    parts.push(
      typeof part.data === 'string' ? part.data : fenced(part.data.language, part.data.value),
    );
  }
  if (parts.length === 0 && list.length > 0) return undefined;
  return { text: parts.join('\n\n').slice(0, MAX_HOVER), markdown: true };
}

/** What the hover card says of the name at a place: the server's hover, else the index's line. */
export async function servedHover(
  answering: Answering,
  sides: ViewSides,
  at: At,
  signal: AbortSignal | undefined,
  serverOf: ServerOf,
): Promise<Hover | NoHover> {
  const { file, serving } = await asked(sides, at, serverOf);
  const name = askedName(file, at.line, at.column);
  // The index's line, or none, saying either way why the server didn't answer.
  const syntax = async (fallback?: string): Promise<Hover | NoHover> => {
    const found = await hover(answering, sides, at, signal, file);
    return withFallback<Hover | NoHover>(found ?? { none: true }, fallback);
  };
  if (name === undefined || !serving) return syntax();
  if (serving.kind !== 'ready') return syntax(waitingFor(serving));
  const answer = await ask(
    serving,
    file,
    'textDocument/hover',
    { path: file.path, position: positionOf(at) },
    { deadline: DEADLINES.hover, signal, key: `hover\n${at.view}` },
  );
  if (!answer.ok) return syntax(answer.fallback);
  const text = hoverText(answer.value);
  if (text === undefined) return syntax(`${serving.name} didn't answer.`);
  // No hover from the server: the index may know the name.
  if (text.text.trim() === '') return syntax();
  const found: Hover = { name, kind: undefined, ...text, source: 'server', label: serving.name };
  if (!text.markdown) return found;
  let tree: Tree;
  try {
    tree = await answering.render(at.view, text.text, signal);
  } catch (error) {
    if (signal?.aborted) throw new IpcError('cancelled', 'The question was cancelled.');
    if (error instanceof IpcError && error.code === 'cancelled') throw error;
    // The window never draws the Markdown itself: the index answers, saying why.
    const slow = error instanceof IpcError && error.code === 'unanswered';
    return syntax(
      slow
        ? `Lo took too long to read ${serving.name}'s hover.`
        : `Lo couldn't read ${serving.name}'s hover.`,
    );
  }
  // Markdown that shows nothing, as a comment alone: the index may know the name.
  if (tree.blocks.length === 0) return syntax();
  return { ...found, tree };
}

const hint = z.object({
  position,
  label: z.union([z.string(), z.array(z.object({ value: z.string() })).max(64)]),
  paddingLeft: z.boolean().optional(),
  paddingRight: z.boolean().optional(),
});

/** The longest hint kept, in UTF-16 code units. */
const HINT_LENGTH = 200;

/** The hints in a server's answer, on lines `from` to `to`, {@link MAX_HINTS} at most. */
export function hintsOf(value: unknown, from: number, to: number): Hint[] {
  if (!Array.isArray(value)) return [];
  const found: Hint[] = [];
  for (const each of value) {
    if (found.length >= MAX_HINTS) break;
    const parsed = hint.safeParse(each);
    if (!parsed.success) continue;
    const { label, paddingLeft, paddingRight } = parsed.data;
    const line = parsed.data.position.line + 1;
    const text = (typeof label === 'string' ? label : label.map((part) => part.value).join(''))
      .replace(/[\p{Cc}]/gu, '')
      .slice(0, HINT_LENGTH);
    if (line < from || line > to || text === '') continue;
    found.push({
      line,
      column: parsed.data.position.character,
      label: text,
      ...(paddingLeft ? { paddingLeft } : {}),
      ...(paddingRight ? { paddingRight } : {}),
    });
  }
  return found;
}

/**
 * Why `serving` gives no type hints, so it isn't asked for them: its adapter says so, or it
 * doesn't offer them. Nothing when it does.
 */
function hintless(serving: Serving): string | undefined {
  if (serving.noHints !== undefined) return serving.noHints;
  const { capabilities } = serving.server;
  // Lo takes no registration of them later, so what it said to `initialize` is all it offers.
  const offered = capabilities === undefined || Boolean(capabilities.inlayHintProvider);
  return offered ? undefined : `${serving.name} has no type hints.`;
}

/**
 * A server's type hints for lines `from` to `to` of a file, naming the server, or why it gave none:
 * none without one, or on the old side.
 */
export async function servedHints(
  sides: ViewSides,
  at: Omit<At, 'line' | 'column'> & { readonly from: number; readonly to: number },
  signal: AbortSignal | undefined,
  serverOf: ServerOf,
): Promise<Hints> {
  const file = await readAsked(sides, at);
  checkLine(file, at.from);
  const serving =
    file.side === 'new' ? serverOf({ commit: file.commit, path: file.path }) : undefined;
  if (!serving) return { hints: [] };
  const label = serving.name;
  if (serving.kind !== 'ready') return { hints: [], label, fallback: waitingFor(serving) };
  const none = hintless(serving);
  if (none !== undefined) return { hints: [], label, none };
  // The lines asked end at the next one's start, or at the end of the file: JDT LS answers nothing
  // for a range that ends past it.
  const last = file.lines.length - 1;
  const end =
    at.to <= last
      ? { line: at.to, character: 0 }
      : { line: last, character: file.lines[last]?.length ?? 0 };
  const answer = await ask(
    serving,
    file,
    'textDocument/inlayHint',
    { path: file.path, range: { start: { line: at.from - 1, character: 0 }, end } },
    { deadline: DEADLINES.hints, signal, key: `hints\n${at.view}` },
  );
  if (!answer.ok) return withFallback<Hints>({ hints: [], label }, answer.fallback);
  return { hints: hintsOf(answer.value, at.from, at.to), label };
}

/** What each of the protocol's symbol kinds is, as the index names kinds. */
const KINDS: Readonly<Record<number, DefinitionKind>> = {
  1: 'module',
  2: 'module',
  3: 'module',
  4: 'module',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'method',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'constant',
  16: 'constant',
  17: 'constant',
  18: 'variable',
  19: 'variable',
  20: 'property',
  21: 'constant',
  22: 'constant',
  23: 'type',
  24: 'field',
  25: 'function',
  26: 'type',
};

const documentSymbol = z.object({
  name: z.string(),
  kind: z.number().int(),
  range,
  selectionRange: range,
  children: z.unknown().optional(),
});
const symbolInformation = z.object({
  name: z.string(),
  kind: z.number().int(),
  location: z.object({ range }),
});

/** How deep a server's symbols nest at most, past which their children are dropped. */
const SYMBOL_DEPTH = 32;
/** The longest symbol's name kept. */
const SYMBOL_NAME = 256;

/**
 * The symbols in a server's outline, nested, {@link MAX_SYMBOLS} at most: a tree of document
 * symbols, read without recursion, or a flat list. Nothing when none of it is usable.
 */
export function outlineOf(value: unknown): { symbols: OutlineSymbol[]; more: boolean } | undefined {
  if (value === null) return { symbols: [], more: false };
  if (!Array.isArray(value)) return undefined;
  const symbols: OutlineSymbol[] = [];
  const stack: { node: unknown; parent: number | undefined; depth: number }[] = value
    .toReversed()
    .map((node: unknown) => ({ node, parent: undefined, depth: 0 }));
  let more = false;
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    if (symbols.length >= MAX_SYMBOLS) {
      more = true;
      break;
    }
    const tree = documentSymbol.safeParse(next.node);
    const flat = tree.success ? undefined : symbolInformation.safeParse(next.node);
    const read = tree.success
      ? { ...tree.data, at: tree.data.selectionRange.start, end: tree.data.range.end }
      : flat?.success
        ? { ...flat.data, at: flat.data.location.range.start, end: flat.data.location.range.end }
        : undefined;
    if (!read) continue;
    const line = read.at.line + 1;
    const index = symbols.length;
    symbols.push({
      name: read.name.slice(0, SYMBOL_NAME),
      kind: KINDS[read.kind] ?? 'variable',
      line,
      column: read.at.character,
      lastLine: Math.max(line, read.end.line + 1),
      ...(next.parent === undefined ? {} : { parent: next.parent }),
    });
    const children = tree.success ? tree.data.children : undefined;
    if (Array.isArray(children) && next.depth < SYMBOL_DEPTH) {
      for (const child of children.toReversed()) {
        stack.push({ node: child, parent: index, depth: next.depth + 1 });
      }
    }
  }
  if (symbols.length === 0 && value.length > 0) return undefined;
  return { symbols, more };
}

/** A file's outline: the server's symbols, else the syntax index's. */
export async function servedOutline(
  answering: Answering,
  sides: ViewSides,
  at: Omit<At, 'line' | 'column'>,
  signal: AbortSignal | undefined,
  serverOf: ServerOf,
): Promise<Outline> {
  const { file, serving } = await asked(sides, at, serverOf);
  const syntax = async (fallback?: string) =>
    withFallback(await outline(answering, sides, at, file), fallback);
  if (!serving) return syntax();
  if (serving.kind !== 'ready') return syntax(waitingFor(serving));
  const answer = await ask(
    serving,
    file,
    'textDocument/documentSymbol',
    { path: file.path },
    { deadline: DEADLINES.outline, signal },
  );
  if (!answer.ok) return syntax(answer.fallback);
  const found = outlineOf(answer.value);
  if (!found) return syntax(`${serving.name} didn't answer.`);
  return { ...found, source: 'server', label: serving.name };
}
