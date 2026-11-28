// What a term's switches act on, in the overview on screen: the term a target names, by any name it
// goes by, in the pull request's repo; whether each switch is on for it; and turning one, with focus
// handed on from the term it was on, where that term goes: a use of it in the text turns to plain
// words, so its block takes focus, and its row leaves the list for the Ignored group, or comes
// back, so focus follows it to the list, else goes to a row beside it. "Stop ignoring" on a row in
// the group hands focus on the same way.

import { handOffFocus } from '@lo/ui';
import type { TermTarget } from '@lo/ui/commands';
import { blockOf, focusTargetOf, termAt, type TermAt } from '@lo/ui/overview';

import { activeTab } from '../../tab/window/shared.ts';
import { namesOf, type TermNames } from './definitions.ts';
import { drawnIn } from './follow.ts';
import { definitionsNow } from './hooks.ts';
import { ignoring, isIgnored, stopIgnoring, turnIgnored, type IgnoredWhere } from './ignored.ts';
import { repoOf } from './sections.ts';

/** A term a switch acts on: the names it goes by, and the repo it's read in. */
interface TermNow {
  readonly names: TermNames;
  readonly repo: string;
}

/**
 * The term `target` names in the overview of the pull request on screen, or why there's none to
 * act on: no words, since a term's switches are only where a term is.
 */
function termNow(target: TermTarget): TermNow | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return '';
  const term = definitionsNow(tab)?.of(target.term);
  return term ? { names: namesOf(term), repo: repoOf(tab) } : '';
}

/** Whether a term's switches can act on `target`, or why not. */
export function termReady(target: TermTarget): true | string {
  const found = termNow(target);
  return typeof found === 'string' ? found : true;
}

/** Whether the term `target` names is ignored `where` now: its switch there is on. */
export function termIgnored(target: TermTarget, where: IgnoredWhere): boolean {
  const found = termNow(target);
  return (
    typeof found !== 'string' && isIgnored(ignoring.shownNow(), where, found.repo, found.names)
  );
}

/**
 * Turns "Ignore in this repo" or "Ignore in every repo" for the term `target` names, handing focus
 * on from it where it had it.
 */
export function ignoreTerm(target: TermTarget, where: IgnoredWhere): void {
  const found = termNow(target);
  if (typeof found === 'string') return;
  const before = ignoring.shownNow();
  const was = isIgnored(before, 'repo', found.repo, found.names);
  const focused = termAt(document.activeElement);
  const article = focusedArticle();
  const handing = article && focused?.key === target.term ? focused : undefined;
  // A use of it in the text that's about to be plain words gives its block focus first.
  if (article && handing && !handing.row && !was) {
    const block = blockOf(article, handing.element);
    if (block) focusTargetOf(block).focus({ preventScroll: true });
  }
  turnIgnored(found.repo, found.names, where);
  if (handing?.row) handOnFrom(handing);
}

/**
 * "Stop ignoring", pressed on the row of the term `key` names, in the Ignored group of the overview
 * of a pull request in `repo`: both its switches turn off, and focus on the row's term follows it
 * back to the list, as a switch's does.
 */
export function stopIgnoringTerm(repo: string, names: TermNames, key: string): void {
  const focused = termAt(document.activeElement);
  stopIgnoring(repo, names);
  if (focused?.row && focused.key === key) handOnFrom(focused);
}

/** The article of the overview on screen, if it's drawn and has focus somewhere in it. */
function focusedArticle(): Element | undefined {
  const tab = activeTab();
  const overview = tab?.kind === 'pull' ? drawnIn(tab.id) : undefined;
  const article = overview?.scroller()?.querySelector('.lo-ov__article');
  return article?.contains(document.activeElement) ? article : undefined;
}

/** The Ignored group of a Glossary section, which holds the rows of the terms ignored. */
const GROUP = '[data-lo-ignored]';

/** Whether `row` is in the Ignored group, rather than in the list. */
function inGroup(row: Element): boolean {
  return row.closest(GROUP) !== null;
}

/** The term of the row of `key` in `box`, a Glossary section, in its list or its group. */
function rowTerm(box: Element, key: string | undefined, group: boolean): HTMLElement | undefined {
  if (key === undefined) return undefined;
  const row = [...box.querySelectorAll<HTMLElement>('[data-lo-term-row]')].find(
    (each) =>
      each.dataset['loTerm'] === key &&
      inGroup(each) === group &&
      each.closest('[data-closed]') === null,
  );
  return row?.querySelector<HTMLElement>('.lo-term-row__term') ?? undefined;
}

/**
 * Hands focus on from the row `found`, whose term had it, as it leaves the list for the Ignored
 * group or the group for the list: to the term's row in the list, where it's come back; else the
 * row after it where it was, or before it; else the group's own row; else the section's block.
 */
function handOnFrom(found: TermAt): void {
  const box = found.element.closest('[data-lo-glossary]');
  if (!box) return;
  const group = inGroup(found.element);
  const beside = [...box.querySelectorAll<HTMLElement>('[data-lo-term-row]')].filter(
    (row) => inGroup(row) === group && row.closest('[data-closed]') === null,
  );
  const at = beside.indexOf(found.element);
  const after = beside[at + 1]?.dataset['loTerm'];
  const before = at > 0 ? beside[at - 1]?.dataset['loTerm'] : undefined;
  const block = box.closest<HTMLElement>('[data-lo-block]');
  handOffFocus([found.element], () => [
    rowTerm(box, found.key, false),
    rowTerm(box, after, group),
    rowTerm(box, before, group),
    box.querySelector<HTMLElement>('[data-lo-ignored-fold]'),
    block && focusTargetOf(block),
  ]);
}
