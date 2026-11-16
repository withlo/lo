// What the window shows of the code port's answers, as plain functions tested alone: a peek of a
// name's definitions, the references panel's groups, the hover card's declaration and docs, the
// outline's rows, where an answer came from and why a language server didn't give it, and what the
// status bar says when there's nothing to show.

import type { Tree } from '@lo/markdown';
import type { AnswerSource, PeekCandidate, ReferenceRow, ReferencesGroup } from '@lo/ui';
import type { PeekAnswer, PeekCode, PeekView } from '@lo/ui/code';

import { IpcError } from '../../../ipc/contract.ts';
import type { LocalState } from '../../tab/contract.ts';
import type { Servers, Status } from '../contract.ts';
import type {
  CodeAnswer,
  Definitions,
  Hints,
  Hover,
  Lines,
  OutlineSymbol,
  OutsideAnswer,
} from '../port.ts';

/** A definition: a place in the repository, or one a language server found outside it. */
export type Definition = CodeAnswer | OutsideAnswer;

/** Whether `answer` is outside the repository: Lo names no file for it and reads none. */
export function isOutside(answer: Definition): answer is OutsideAnswer {
  return 'outside' in answer;
}

/** "No definition of `parse` found". */
export function noDefinition(name: string): string {
  return `No definition of \`${name}\` found`;
}

/** "No references of `parse` found". */
export function noReferences(name: string): string {
  return `No references of \`${name}\` found`;
}

/** What the status bar says of nothing found, with why a language server didn't answer, if it didn't. */
export function noneFound(said: string, fallback: string | undefined): string {
  return fallback === undefined ? said : `${said}. ${fallback}`;
}

/** What `K` says of a name nothing's known of, with why a server didn't answer, if one could. */
export function noHover(fallback: string | undefined): string {
  const said = 'No definition found at the cursor.';
  return fallback === undefined ? said : `${said} ${fallback}`;
}

/** "`parse` has 3 references, all outside this repository.": what a server found, none listed. */
export function allOutside(name: string, count: number): string {
  return count === 1
    ? `\`${name}\` has 1 reference, outside this repository.`
    : `\`${name}\` has ${count} references, all outside this repository.`;
}

/** What the status bar says when there's no name at the place asked about. */
export const NO_NAME = 'There’s no name at the cursor.';

/**
 * Why no type hint came for the code on screen, from what each file's question found, the view's
 * trust and its language servers as main last said: nothing once one came. A server that reads a
 * file says why it gave none, a failed or missing one from what its item in the status bar shows;
 * without one, the trust decides.
 */
export function noHints(
  found: readonly Hints[],
  status: Status | null,
  servers: Servers | null,
): string | undefined {
  if (found.some((each) => each.hints.length > 0)) return undefined;
  const served = found.filter((each) => each.label !== undefined);
  const why =
    served.find((each) => each.fallback !== undefined || each.none !== undefined) ?? served[0];
  if (why?.label !== undefined) return serverHints(why.label, why, servers);
  const trust = status?.trust;
  switch (trust?.kind) {
    case 'trusted':
      return 'No language server reads the code on screen.';
    case 'untrusted': {
      if (trust.why === 'unread') break;
      const head = status?.head;
      switch (head?.kind) {
        case 'fork':
          return 'Type hints need a language server, which Lo runs only on PRs you trust.';
        case 'gone':
          return 'Type hints need a language server. GitHub no longer has this PR’s fork, so Lo can’t tell whose code it is.';
        case 'base':
        case undefined:
          return 'Type hints need a language server, which Lo runs only on repos you trust.';
        default:
          head satisfies never;
          return 'Type hints need a language server.';
      }
    }
    case 'checking':
    case 'waiting':
      break;
    case 'noGit':
      return 'Code features need git.';
    case undefined:
      return 'Type hints need a language server.';
    default:
      trust satisfies never;
      return 'Type hints need a language server.';
  }
  return 'Type hints wait for Lo to work out whether this repo is trusted.';
}

/** Why server `name` gave no type hints for a file: what it said, or where it is. */
function serverHints(
  name: string,
  found: Pick<Hints, 'fallback' | 'none'>,
  servers: Servers | null,
): string {
  if (found.none !== undefined) return found.none;
  const state = servers?.servers.find((server) => server.name === name)?.state;
  switch (state?.kind) {
    case 'failed':
      return `${name} failed. Restart it from the status bar.`;
    case 'missing':
      return `${name} needs ${state.needs}.`;
    case 'downloading':
    case 'starting':
    case 'indexing':
    case 'ready':
    case 'notAnswering':
    case undefined:
      return found.fallback ?? `${name} gives no type hints for the code on screen.`;
    default:
      state satisfies never;
      return found.fallback ?? `${name} gives no type hints for the code on screen.`;
  }
}

/**
 * Why code features can't answer about a view yet, from its local copy, if they can't: what failed,
 * when fetching it did and Lo won't try again unless asked.
 */
export function notYet(local: LocalState | undefined): string | undefined {
  if (local?.kind === 'noGit') return 'Code features need git.';
  if (local?.kind === 'failed') {
    return `Code features need the local copy, which Lo couldn’t fetch: ${local.message}.`;
  }
  if (local?.kind !== 'ready') return 'The syntax index waits for the local copy.';
  return undefined;
}

/**
 * What the status bar says of a question that failed, in main's own words where it gave them, as
 * it does for "The syntax index waits for the local copy." Nothing for one that was cancelled,
 * since a newer one took its place.
 */
export function failureOf(error: unknown): string | undefined {
  if (error instanceof IpcError) {
    if (error.code === 'cancelled') return undefined;
    return error.message;
  }
  return 'Lo couldn’t ask the syntax index.';
}

/**
 * Where an answer came from, from its label: "TypeScript" or "Syntax index", with what sets it
 * apart after a `·`, as "Syntax index · same name" does.
 */
export function sourceOf(answer: Pick<CodeAnswer, 'source' | 'label'>): {
  source: AnswerSource;
  note: string | undefined;
} {
  const [name = '', ...rest] = answer.label.split(' · ');
  const note = rest.length > 0 ? rest.join(' · ') : undefined;
  if (answer.source === 'server') return { source: { kind: 'server', name }, note };
  return { source: { kind: 'syntax' }, note };
}

/** An answer's key among a list's: its place, which no two answers share. */
export function answerKey(answer: Definition, index: number): string {
  if (isOutside(answer)) return `${index}:outside:${answer.name}`;
  return `${index}:${answer.path}:${answer.line}:${answer.column}`;
}

/** The peek's candidates, from a name's definitions. */
export function candidatesOf(answers: readonly Definition[]): PeekCandidate[] {
  return answers.map((answer, index): PeekCandidate => {
    const { source, note } = sourceOf(answer);
    const key = answerKey(answer, index);
    if (isOutside(answer)) return { key, outside: true, source, note };
    return { key, path: answer.path, line: answer.line, source, note, from: answer.from };
  });
}

/** The code a peek shows of an answer: its lines, highlighted once `tokens` come. */
export function codeOf(lines: Lines | undefined, tokens?: Uint32Array): PeekCode | undefined {
  if (!lines || lines.text.length === 0) return undefined;
  return { first: lines.from, lines: lines.text, tokens };
}

/**
 * What a peek under a line shows of a name's definitions, answer `shown` with its code, or waiting
 * for it: the window reads the code of every answer it shows.
 */
export function peekOf(found: Definitions, shown: number, code: PeekCode | undefined): PeekView {
  // One outside the repository has no file: its frame says so, and there's no code to wait for.
  const answers = found.answers.map((answer): PeekAnswer =>
    isOutside(answer)
      ? { path: answer.name, line: 1, source: answer.source, label: answer.label }
      : {
          path: answer.path,
          line: answer.line,
          column: answer.column,
          source: answer.source,
          label: answer.label,
        },
  );
  const answer = found.answers[shown];
  return {
    answers,
    shown,
    code,
    waiting: code === undefined && answer !== undefined && !isOutside(answer),
    label: `Definitions of ${found.name ?? ''}`,
  };
}

/** What a peek's foot says of its answer shown: its path, its revision, and whether the PR changes it. */
export function metaOf(answer: Definition, revision: string | undefined): string {
  if (isOutside(answer)) return 'Outside this repository';
  return [answer.path, revision, answer.changed ? 'changed in this PR' : 'unchanged in this PR']
    .filter((part) => part !== undefined)
    .join(' · ');
}

/**
 * Where a peek's answers came from, for its head, when no list beside them says: the one answer's
 * source and what sets it apart, or the syntax index's with why a language server didn't answer.
 * Nothing for several answers a server gave, whose list says.
 */
export function peekSource(
  found: Pick<Definitions, 'answers' | 'fallback'>,
): { source: AnswerSource; note: string | undefined } | undefined {
  if (found.fallback !== undefined) return { source: { kind: 'syntax' }, note: found.fallback };
  const [only, ...rest] = found.answers;
  if (!only || rest.length > 0) return undefined;
  const { source, note } = sourceOf(only);
  if (!isOutside(only) && only.from !== undefined) {
    return { source, note: `From ${only.from}, which Lo doesn't install` };
  }
  return { source, note };
}

/** What a hover card shows: the declaration, as code, and the docs, either of which may be all. */
export interface HoverCard {
  readonly signature: string | undefined;
  readonly docs: Tree | undefined;
}

/**
 * What the card draws of a hover: the syntax index's line, or a server's plain text, as code; or a
 * server's Markdown, read by the background process into Lo's tree, its code blocks at the start as
 * the declaration, in the order the server wrote them (some write a module's path before the
 * signature), and the rest as the docs. Rules between them go, since the card divides them itself.
 * Nothing when there's nothing to draw. A server's Markdown is never drawn as its text.
 */
export function cardOf(hover: Pick<Hover, 'text' | 'markdown' | 'tree'>): HoverCard | undefined {
  if (!hover.markdown) {
    return hover.text.trim() === '' ? undefined : { signature: hover.text, docs: undefined };
  }
  if (!hover.tree) return undefined;
  const blocks = [...hover.tree.blocks];
  const code: string[] = [];
  for (let block = blocks[0]; block?.kind === 'code'; block = blocks[0]) {
    blocks.shift();
    code.push(block.text.replace(/\n+$/, ''));
  }
  while (blocks[0]?.kind === 'rule') blocks.shift();
  while (blocks.at(-1)?.kind === 'rule') blocks.pop();
  const signature = code.join('\n');
  const declared = signature.trim() !== '';
  if (!declared && blocks.length === 0) return undefined;
  return {
    signature: declared ? signature : undefined,
    docs: blocks.length > 0 ? { ...hover.tree, blocks } : undefined,
  };
}

/** The line `line` of `lines`, if they hold it. */
export function lineIn(lines: Lines | undefined, line: number): string | undefined {
  if (!lines) return undefined;
  return lines.text[line - lines.from];
}

/**
 * The references panel's rows, a group for each file in the order they first come, each with its
 * line's text where it's known, from the answer or from `texts`, by the answer's place in the
 * list, the name marked; until it's read, the row shows the name alone.
 */
export function groupsOf(
  answers: readonly CodeAnswer[],
  texts: ReadonlyMap<number, string>,
): ReferencesGroup[] {
  const groups = new Map<string, { key: string; path: string; rows: ReferenceRow[] }>();
  answers.forEach((answer, index) => {
    let group = groups.get(answer.path);
    if (!group) {
      group = { key: answer.path, path: answer.path, rows: [] };
      groups.set(answer.path, group);
    }
    const text = lineIn(answer.lines, answer.line) ?? texts.get(index);
    const { name } = answer;
    const key = answerKey(answer, index);
    group.rows.push(
      text === undefined
        ? { key, line: answer.line, text: name, match: { from: 0, to: name.length } }
        : {
            key,
            line: answer.line,
            text,
            match: { from: answer.column, to: answer.column + name.length },
          },
    );
  });
  return [...groups.values()];
}

/**
 * The texts `lines`, read around answer `index`, give the answers in the same file whose lines
 * they hold and that came without, by their places in the list.
 */
export function textsFrom(
  answers: readonly CodeAnswer[],
  index: number,
  lines: Lines,
): Map<number, string> {
  const path = answers[index]?.path;
  const found = new Map<number, string>();
  answers.forEach((answer, at) => {
    if (answer.path !== path || answer.lines) return;
    const text = lineIn(lines, answer.line);
    if (text !== undefined) found.set(at, text);
  });
  return found;
}

/** How many files `answers` are in. */
export function filesIn(answers: readonly CodeAnswer[]): number {
  return new Set(answers.map((answer) => answer.path)).size;
}

/** A row of a file's outline: a symbol, and how deep it's nested. */
export interface OutlineRow {
  readonly key: string;
  readonly symbol: OutlineSymbol;
  readonly depth: number;
}

/** The outline's rows, in the file's order, each as deep as its parents nest it. */
export function outlineRows(symbols: readonly OutlineSymbol[]): OutlineRow[] {
  const depths: number[] = [];
  return symbols.map((symbol, index) => {
    const parent = symbol.parent;
    // A parent comes before what it holds; one that doesn't is no parent.
    const depth = parent !== undefined && parent < index ? (depths[parent] ?? 0) + 1 : 0;
    depths.push(depth);
    return { key: `${index}`, symbol, depth };
  });
}

/** The rows whose names hold what's typed, ignoring case, nested as they are. */
export function filterOutline(rows: readonly OutlineRow[], query: string): readonly OutlineRow[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return rows;
  return rows.filter((row) => row.symbol.name.toLowerCase().includes(wanted));
}
