// What an overview written for an older push says of it: whether it's out of date, its banner's
// words ("Written for r3. The PR is at r5.", how much changed since), and each code block's flag
// ("Lines 48 and 50 changed in r5. This block shows r3, which the text describes."). Revisions are
// named by their labels, and a commit that isn't a revision's head by its short id. Plain
// functions, each tested alone.

import type { CodeRange, Excerpt } from '@lo/artifact';

import type { ComparisonView } from '../../revisions/contract.ts';
import type { PullView } from '../../tab/contract.ts';
import { revisionAt } from './facts.ts';
import type { BlockChange, Run } from './mapping.ts';
import { shortId } from './says.ts';

/**
 * The head an overview describing `commit` is out of date against: the head on screen, when it's
 * another commit. An overview of a newer push that isn't loaded yet isn't out of date: it describes
 * where the pull request is.
 */
export function staleAgainst(
  commit: string,
  pull: Pick<PullView, 'shown' | 'newer'> | undefined,
): string | undefined {
  const shown = pull?.shown ?? undefined;
  if (shown === undefined || commit === shown || commit === pull?.newer) return undefined;
  return shown;
}

/** A commit as Lo names it: its revision's label, `r3`, or its short id. */
export function labelOf(revisions: ComparisonView | undefined, commit: string): string {
  const number = revisionAt(revisions, commit)?.number;
  return number === undefined ? shortId(commit) : `r${number}`;
}

/**
 * How many pushes there have been since `from`, up to `to`: none known unless both are revisions,
 * `from` the older.
 */
export function pushesSince(
  revisions: ComparisonView | undefined,
  from: string,
  to: string,
): number | undefined {
  const list = revisions?.revisions ?? [];
  const start = list.findIndex((each) => each.head === from);
  const end = list.findIndex((each) => each.head === to);
  if (start < 0 || end <= start) return undefined;
  // A commit reviewed but never pushed has no number, and was no push.
  return list.slice(start + 1, end + 1).filter((each) => each.number !== null).length;
}

/**
 * What the banner knows: the labels of what the overview was written for and where the pull
 * request is, and once each is known, how many pushes since, how many files they changed (`null`
 * when Lo couldn't compare), and how many code blocks point at lines that changed (none known for
 * an overview with no code blocks).
 */
export interface StaleFacts {
  readonly written: string;
  readonly now: string;
  readonly pushes?: number | undefined;
  readonly files?: number | null | undefined;
  readonly blocks?: number | undefined;
}

/**
 * Whether the revisions feature can compare the overview's commit, `from`, with the head on
 * screen, `to`, as Compare asks: or why not, to say on the button.
 */
export function compareState(
  revisions: ComparisonView | undefined,
  from: string,
  to: string,
): { readonly ok: true } | { readonly ok: false; readonly why: string } {
  if (revisions === undefined || revisions.status === 'loading') {
    return { ok: false, why: 'Lo is still reading the revisions.' };
  }
  switch (revisions.status) {
    case 'ready':
      break;
    case 'signIn':
      return { ok: false, why: 'Revisions show only for a signed-in account.' };
    case 'failed':
      return { ok: false, why: revisions.problem ?? 'Lo couldn’t read the revisions.' };
    default:
      revisions.status satisfies never;
      return { ok: false, why: 'Lo couldn’t read the revisions.' };
  }
  if (revisions.waitingFor === 'git') {
    return { ok: false, why: 'Comparing revisions needs git, which Lo can’t find.' };
  }
  const list = revisions.revisions;
  const start = list.findIndex((each) => each.head === from);
  const end = list.findIndex((each) => each.head === to);
  if (start < 0) return { ok: false, why: 'The overview’s commit isn’t one of the revisions.' };
  if (end <= start) return { ok: false, why: 'Lo is still reading the revisions.' };
  if (!list[start]?.available) {
    return { ok: false, why: `${labelOf(revisions, from)} is no longer available.` };
  }
  return { ok: true };
}

/** `count` and a noun, made plural past one: "1 file", "5 files". */
function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** The banner's words: its title, and what changed since, as far as it's known. */
export function staleWords(facts: StaleFacts): { title: string; detail: string } {
  const title = `Written for ${facts.written}. The PR is at ${facts.now}.`;
  const { pushes, files, blocks } = facts;
  const sentences: string[] = [];
  const pushed = pushes !== undefined && pushes > 0 ? counted(pushes, 'push', 'pushes') : undefined;
  const touched =
    files === undefined || files === null
      ? undefined
      : files === 0
        ? 'touching no files'
        : `touching ${counted(files, 'file')}`;
  if (pushed !== undefined && touched !== undefined) sentences.push(`${pushed} since, ${touched}.`);
  else if (pushed !== undefined) sentences.push(`${pushed} since.`);
  else if (files !== undefined && files !== null) {
    sentences.push(
      files === 0 ? 'No files changed since.' : `${counted(files, 'file')} changed since.`,
    );
  }
  if (blocks !== undefined) {
    sentences.push(
      blocks === 0
        ? 'No code block below points at lines that changed.'
        : blocks === 1
          ? '1 code block below points at lines that changed.'
          : `${blocks.toLocaleString('en-US')} code blocks below point at lines that changed.`,
    );
  }
  return { title, detail: sentences.join(' ') };
}

/** Items in a list, as a sentence says them: "7", "7 and 9", "7, 9 and 12". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The most runs of lines a flag names, past which it counts them. */
const NAMED_RUNS = 4;

/** Which lines changed, as a flag starts: "Line 7", "Lines 48 and 50", "Lines 7–9". */
function changedWords(runs: readonly Run[]): string {
  const [only] = runs;
  if (runs.length === 1 && only && only.from === only.to) return `Line ${only.from}`;
  if (runs.length > NAMED_RUNS) {
    let count = 0;
    for (const { from, to } of runs) count += to - from + 1;
    return `${count.toLocaleString('en-US')} of its lines`;
  }
  return `Lines ${listed(runs.map(({ from, to }) => (from === to ? `${from}` : `${from}–${to}`)))}`;
}

/** Where lines were added: "after line 8", "after lines 8 and 12", "in 5 places". */
function addedWords(after: readonly number[]): string {
  if (after.length > NAMED_RUNS) return `in ${after.length.toLocaleString('en-US')} places`;
  return `after ${after.length === 1 ? 'line' : 'lines'} ${listed(after.map(String))}`;
}

/**
 * A code block's flag, for lines it shows that changed between the overview's commit, `written`,
 * and the head on screen, `now`, as `change` says; none when they didn't.
 */
export function flagWords(
  change: BlockChange,
  labels: { readonly written: string; readonly now: string },
): string | undefined {
  const shows = `This block shows ${labels.written}, which the text describes.`;
  switch (change.kind) {
    case 'none':
      return undefined;
    case 'deleted':
      return `This file was deleted in ${labels.now}. ${shows}`;
    case 'opaque':
      return `This file changed in ${labels.now}, and Lo can’t tell which lines. ${shows}`;
    case 'lines': {
      const { changed, added, addedLines } = change;
      const lines = addedLines === 1 ? 'a line was added' : 'lines were added';
      if (changed.length === 0) {
        const said = `${lines} ${addedWords(added)} in ${labels.now}.`;
        return `${said.charAt(0).toUpperCase()}${said.slice(1)} ${shows}`;
      }
      const also = added.length > 0 ? `, and ${lines} ${addedWords(added)}` : '';
      return `${changedWords(changed)} changed in ${labels.now}${also}. ${shows}`;
    }
    default:
      change satisfies never;
      return undefined;
  }
}

/**
 * The lines each `:::code` block in `tree` shows, in the order they're written, for the banner to
 * count those that changed. It walks with an explicit stack, so no tree can overflow it.
 */
export function codeBlocksIn(tree: object): CodeRange[] {
  const found: CodeRange[] = [];
  const stack: unknown[] = [tree];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value)) {
      for (let at = value.length - 1; at >= 0; at--) stack.push(value[at]);
      continue;
    }
    if (isExcerpt(value)) {
      found.push(value.target);
      continue;
    }
    const fields = Object.values(value);
    for (let at = fields.length - 1; at >= 0; at--) stack.push(fields[at]);
  }
  return found;
}

function isExcerpt(value: object): value is Excerpt {
  const target: unknown = Reflect.get(value, 'target');
  return (
    Reflect.get(value, 'kind') === 'excerpt' &&
    typeof target === 'object' &&
    target !== null &&
    typeof Reflect.get(target, 'path') === 'string' &&
    typeof Reflect.get(target, 'lines') === 'object'
  );
}
