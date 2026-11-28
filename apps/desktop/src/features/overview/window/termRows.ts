// A term's row in an overview's Glossary section, expanded or not: which rows each tab has
// expanded, by their term's key, kept while the tab is open, across revisions; whether Expand term
// can act on a row and Show history on a term in the text, or why not; and Show history, which goes
// from a term in the text, or its card, to its row, expanding the section and the row, and lands on
// it, the tab's history keeping where the reader was so `⌃o` comes back.

import type { TermTarget } from '@lo/ui/commands';
import { closeCards } from '@lo/ui/overview';
import { flushSync } from 'react-dom';

import { activeTab, tabState, type PullTab } from '../../tab/window/shared.ts';
import { isOpen, type Definitions, type ShownTerm } from './definitions.ts';
import { drawnIn, goToTermRow, hereIn } from './follow.ts';
import { definitionsNow } from './hooks.ts';
import {
  GLOSSARY_READING,
  joinsGlossary,
  NO_GLOSSARY,
  NOT_IN_GLOSSARY,
  NOT_IN_THIS_GLOSSARY,
  STORE_TITLE,
} from './says.ts';
import { openGlossary } from './sections.ts';

/** Each tab's terms whose rows are expanded, by the keys its overviews name them by. */
export const expandedRows = tabState<ReadonlySet<string>>(() => new Set());

/** A term in the overview on screen, with its tab and the definitions it's shown with. */
interface TermIn {
  readonly tab: PullTab;
  readonly definitions: Definitions;
  readonly term: ShownTerm;
}

/** The term `target` names in the overview of the pull request on screen, if it shows one. */
function termIn(target: TermTarget): TermIn | undefined {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return undefined;
  const definitions = definitionsNow(tab);
  const term = definitions?.of(target.term);
  return definitions && term ? { tab, definitions, term } : undefined;
}

/**
 * Whether the repo's glossary holds `term`, so its row has what it holds to show, or why not: it's
 * still being read, the repo has none or it can't be read, or it doesn't hold the term, which a term
 * an open pull request adds joins as it merges.
 */
export function heldBy(definitions: Definitions, term: ShownTerm): true | string {
  if (term.stored) return true;
  const { terms, subject } = definitions;
  switch (terms.kind) {
    case 'reading':
      return GLOSSARY_READING;
    case 'none':
      return NO_GLOSSARY;
    case 'unreadable':
      return STORE_TITLE;
    case 'read':
      return term.tag === 'new' && subject.kind === 'pull' && isOpen(subject.state)
        ? joinsGlossary(subject.number)
        : NOT_IN_GLOSSARY;
    default:
      terms satisfies never;
      return NOT_IN_GLOSSARY;
  }
}

/**
 * Whether Expand term can act on `target`, a term's row in the overview's Glossary section, or why
 * not. A use of the term in the text has Show history instead, and a row in the Ignored group "Stop
 * ignoring": nothing to say there.
 */
export function expandReady(target: TermTarget): true | string {
  if (target.row !== true) return '';
  const found = termIn(target);
  if (!found || found.term.ignored) return '';
  return heldBy(found.definitions, found.term);
}

/** Whether a term's menu lists Expand term: on its row, in the list. */
export function expandListed(target: TermTarget): boolean {
  return target.row === true && termIn(target)?.term.ignored !== true;
}

/** Whether the row of the term `target` names is expanded, in the tab on screen. */
export function isExpanded(target: TermTarget): boolean {
  const tab = activeTab();
  return tab?.kind === 'pull' && expandedRows.get(tab.id).has(target.term);
}

/** Expands the row of the term `target` names, or collapses it. */
export function turnExpanded(target: TermTarget): void {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return;
  const next = new Set(expandedRows.get(tab.id));
  if (!next.delete(target.term)) next.add(target.term);
  expandedRows.set(tab.id, next);
}

/**
 * Whether Show history can act on `target`, a term in the overview's text or its card, or why not:
 * it goes to the term's row, which a term only the repo's glossary holds has none of here, and the
 * row shows its history only from the repo's glossary. Its row has Expand term instead, and a term
 * the reader ignores has no card or menu: nothing to say there.
 */
export function historyReady(target: TermTarget): true | string {
  if (target.row === true) return '';
  const found = termIn(target);
  if (!found || found.term.ignored || !drawnIn(found.tab.id)) return '';
  if (found.term.own === undefined) return NOT_IN_THIS_GLOSSARY;
  return heldBy(found.definitions, found.term);
}

/**
 * Shows the history of the term `target` names: its card closes, its row expands, and so does the
 * Glossary section if it's collapsed, and the row comes to the top of the screen, lands and takes
 * focus. Run from inside React's commit, as the palette runs a command as it closes, what it
 * expands is drawn only once that's done: it goes there then.
 */
export function showHistory(target: TermTarget): void {
  const tab = activeTab();
  const overview = tab?.kind === 'pull' ? drawnIn(tab.id) : undefined;
  if (tab?.kind !== 'pull' || !overview) return;
  closeCards();
  const here = hereIn(overview);
  const key = target.term;
  const rows = expandedRows.get(tab.id);
  const expanding = !rows.has(key);
  if (expanding) flushSync(() => expandedRows.set(tab.id, new Set([...rows, key])));
  const opened = openGlossary(tab, overview);
  const go = () => goToTermRow(overview, key, here);
  if (expanding || opened) queueMicrotask(go);
  else go();
}
