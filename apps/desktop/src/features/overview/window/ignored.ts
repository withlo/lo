// The glossary terms the reader ignores, from `overview.ignored`, kept per repo as the collapsed
// sections are: the list that applies in a repo, which the overview draws its terms with; whether
// "Ignore in this repo" and "Ignore in every repo" are on for a term; turning either, shown at
// once, with a toast that says what was ignored, whose Undo puts it back; and "Stop ignoring",
// which turns both off. A term is matched by any name it goes by, its aliases among them.

import { useMemo } from 'react';

import { announce } from '../../../window/commands/notices.tsx';
import { shownAtOnce } from '../../settings/window/shared.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import {
  addedBy,
  entryKey,
  ignored,
  listIn,
  readScoped,
  setEverywhere,
  setInRepo,
  undoAdded,
  withoutSame,
  type Scoped,
  type ScopedValue,
} from '../settings.ts';
import { ignoredBy, type TermNames } from './definitions.ts';

/**
 * `overview.ignored` as the overview shows it: a change asked for here shows at once, before main
 * has saved it, and a second asked for meanwhile is made to the first.
 */
export const ignoring = shownAtOnce(ignored);

/** Where a term is ignored: in the repo it's read in, or in every repo. */
export type IgnoredWhere = 'repo' | 'every';

function scopedOf(value: ScopedValue): Scoped {
  return readScoped(value, ignored.key).scoped;
}

/** The keys (`entryKey`) of a list's entries, which a term's names are matched by. */
function keysOf(list: readonly string[]): ReadonlySet<string> {
  return new Set(list.map(entryKey));
}

/** The keys of the entries of the list that applies in `repo`: its own, else every repo's. */
export function ignoredKeys(value: ScopedValue, repo: string): ReadonlySet<string> {
  return keysOf(listIn(scopedOf(value), repo));
}

/** As {@link ignoredKeys}, for the overview to draw with, following the setting as it changes. */
export function useIgnoredKeys(repo: string): ReadonlySet<string> {
  const value = ignoring.useShown();
  return useMemo(() => ignoredKeys(value, repo), [value, repo]);
}

/**
 * Whether the term `names` names is ignored in `repo`, by the list that applies there, or in every
 * repo, by every repo's list and each repo's own: whether "Ignore in this repo" or "Ignore in every
 * repo" is on.
 */
export function isIgnored(
  value: ScopedValue,
  where: IgnoredWhere,
  repo: string,
  names: TermNames,
): boolean {
  if (where === 'repo') return ignoredBy(ignoredKeys(value, repo), names);
  const scoped = scopedOf(value);
  return (
    ignoredBy(keysOf(scoped.every), names) &&
    scoped.repos.every((each) => ignoredBy(keysOf(each.entries), names))
  );
}

/** `value` with the term `names` names in or out of the lists `where` says, as its switch writes. */
function written(
  value: ScopedValue,
  where: IgnoredWhere,
  repo: string,
  names: TermNames,
  on: boolean,
): ScopedValue {
  return where === 'repo'
    ? setInRepo(value, repo, names.name, on, names.also)
    : setEverywhere(value, names.name, on, names.also);
}

/** Whether two values of the setting say the same, as the file would hold them. */
function same(one: ScopedValue, other: ScopedValue): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/** What a toast names a term and a repo by: their words, with no marks that turn text around. */
function ignoredLine(names: TermNames, where: IgnoredWhere, repo: string): string {
  const term = withoutBidi(names.name);
  return where === 'repo'
    ? `Ignored ${term} in ${withoutBidi(repo)}`
    : `Ignored ${term} in every repo`;
}

/**
 * Turns "Ignore in this repo" (`repo`) or "Ignore in every repo" (`every`) for the term `names`
 * names, read in `repo`: on, it's plain text at once, and once it's saved, a toast says so, with
 * Undo. Undo puts the setting back as it was, or, changed since, takes out only what this put in
 * (`undoAdded`): the term goes from the lists that gained it, a repo's own list this made goes while
 * it's as this made it, and lists that held the term already keep it; in this repo, the repo's own
 * list then goes where it's every repo's. Off, it's a term again, with nothing said.
 */
export function turnIgnored(repo: string, names: TermNames, where: IgnoredWhere): void {
  const before = ignoring.shownNow();
  const on = !isIgnored(before, where, repo, names);
  const after = written(before, where, repo, names, on);
  const added = addedBy(before, after, names.name, names.also);
  void ignoring.change(after).then((saved) => {
    // Said only of what took: the switch is on now.
    if (!saved || !on || !isIgnored(after, where, repo, names)) return;
    announce(ignoredLine(names, where, repo), '', {
      label: 'Undo',
      onClick: () => {
        const now = ignoring.shownNow();
        if (same(now, after)) {
          void ignoring.change(before);
          return;
        }
        const undone = undoAdded(now, added, names.name, names.also);
        // In this repo, the repo's own list goes once it's every repo's, as the switch has it.
        void ignoring.change(where === 'repo' ? withoutSame(undone, repo) : undone);
      },
    });
  });
}

/**
 * "Stop ignoring", on the term `names` names, read in `repo`: both its switches turn off. It's out
 * of every list, by any name it goes by, and the repo's own list goes where that leaves it the same
 * as every repo's.
 */
export function stopIgnoring(repo: string, names: TermNames): void {
  const everywhere = setEverywhere(ignoring.shownNow(), names.name, false, names.also);
  void ignoring.change(setInRepo(everywhere, repo, names.name, false, names.also));
}
