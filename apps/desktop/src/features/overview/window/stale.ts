// What an overview written for an older push says of it: whether it's out of date, its banner's
// words ("Written for r3 · now r5", how many files changed since), and each code block's flag
// ("Lines 48 and 50 changed in r5 · showing r3"). Revisions are named by their labels, and a commit
// that isn't a revision's head by its short id. Plain functions, each tested alone.

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
 * What the banner knows: the labels of what the overview was written for and where the pull
 * request is, and once it's known, how many files changed since (`null` when they couldn't be
 * compared). Each code block on lines that changed says so itself, so the banner doesn't count
 * them.
 */
export interface StaleFacts {
  readonly written: string;
  readonly now: string;
  readonly files?: number | null | undefined;
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
    return { ok: false, why: 'Reading revisions…' };
  }
  switch (revisions.status) {
    case 'ready':
      break;
    case 'signIn':
      return { ok: false, why: 'Sign in to compare revisions' };
    case 'failed':
      return { ok: false, why: 'Couldn’t read the revisions' };
    default:
      revisions.status satisfies never;
      return { ok: false, why: 'Couldn’t read the revisions' };
  }
  if (revisions.waitingFor === 'git') return { ok: false, why: 'Can’t find Git' };
  const list = revisions.revisions;
  const start = list.findIndex((each) => each.head === from);
  const end = list.findIndex((each) => each.head === to);
  if (start < 0) return { ok: false, why: 'This overview’s commit isn’t a revision' };
  if (end <= start) return { ok: false, why: 'Reading revisions…' };
  if (!list[start]?.available) {
    return { ok: false, why: `${labelOf(revisions, from)} is no longer on GitHub` };
  }
  return { ok: true };
}

/** `count` and a noun, made plural past one: "1 file", "5 files". */
function counted(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/**
 * The banner's words: what it was written for and where the pull request is, "Written for r3 · now
 * r5", and how many files changed since, once it's known: "4 files changed".
 */
export function staleWords(facts: StaleFacts): { title: string; detail: string } {
  const title = `Written for ${facts.written} · now ${facts.now}`;
  const { files } = facts;
  if (files === undefined || files === null) return { title, detail: '' };
  return { title, detail: files === 0 ? 'no files changed' : `${counted(files, 'file')} changed` };
}

/** Items in a list, as a sentence says them: "7", "7 and 9", "7, 9 and 12". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** The most runs of lines a flag names, past which it counts them. */
const NAMED_RUNS = 4;

/** Which lines changed, as a flag starts: "Line 7", "Lines 48 and 50", "Lines 7–9", "14 lines". */
function changedWords(runs: readonly Run[]): string {
  const [only] = runs;
  if (runs.length === 1 && only && only.from === only.to) return `Line ${only.from}`;
  if (runs.length > NAMED_RUNS) {
    let count = 0;
    for (const { from, to } of runs) count += to - from + 1;
    return counted(count, 'line');
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
 * and the head on screen, `now`, as `change` says; none when they didn't: "Lines 12–14 changed in
 * r5 · showing r3".
 */
export function flagWords(
  change: BlockChange,
  labels: { readonly written: string; readonly now: string },
): string | undefined {
  const shows = `showing ${labels.written}`;
  switch (change.kind) {
    case 'none':
      return undefined;
    case 'deleted':
      return `Deleted in ${labels.now} · ${shows}`;
    case 'opaque':
      return `Changed in ${labels.now} · ${shows}`;
    case 'lines': {
      const { changed, added, addedLines } = change;
      if (changed.length === 0) {
        const lines = addedLines === 1 ? '1 line added' : 'Lines added';
        return `${lines} ${addedWords(added)} in ${labels.now} · ${shows}`;
      }
      const also = added.length > 0 ? ` · lines added ${addedWords(added)}` : '';
      return `${changedWords(changed)} changed in ${labels.now}${also} · ${shows}`;
    }
    default:
      change satisfies never;
      return undefined;
  }
}

/**
 * The lines each `:::code` block in `tree` shows, in the order they're written. It walks with an
 * explicit stack, so no tree can overflow it.
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
