// What the window shows of the code port's answers, as plain functions tested alone: a peek of a
// name's definitions, the references panel's groups, the outline's rows, where an answer came from,
// and what the status bar says when there's nothing to show.

import type { AnswerSource, PeekCandidate, ReferenceRow, ReferencesGroup } from '@lo/ui';
import type { PeekAnswer, PeekCode, PeekView } from '@lo/ui/code';

import { IpcError } from '../../../ipc/contract.ts';
import type { LocalState } from '../../tab/contract.ts';
import type {
  CodeAnswer,
  Definitions,
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

/** What the status bar says when there's no name at the place asked about. */
export const NO_NAME = 'There’s no name at the cursor.';

/** What `gh` says while type hints come only from a language server, which none gives yet. */
export const HINTS_NEED_SERVER = 'Type hints need a language server';

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
 * What a hover card draws as code: the first code block of a language server's Markdown, which is
 * where it writes the declaration, or its text where it has none; the syntax index's line as it is.
 */
export function signatureOf(hover: Pick<Hover, 'text' | 'markdown'>): string {
  if (!hover.markdown) return hover.text;
  const block = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1/m.exec(hover.text);
  return (block?.[2] ?? hover.text).trim();
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
