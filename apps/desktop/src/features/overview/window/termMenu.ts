// A term's menu in the overview: what a key, the menu key or a right-click on a term acts on, a use
// of it in the text or its row in the Glossary section, with the block it's in, so a block's keys
// go on working there; and what its card asks, as the card is put elsewhere in the page: to open
// the menu from it, and whether the menu is open for the term it's the card of, so it stays open.

import type { TermTarget } from '@lo/ui/commands';
import { blockOf, termAt, type TermAt, type TermMenu } from '@lo/ui/overview';

import { currentMenu, followMenu, openMenu } from '../../../window/commands/menus.tsx';
import { activeTab } from '../../tab/window/shared.ts';
import { drawnIn, targetOf, type DrawnOverview } from './follow.ts';

/**
 * The term a target was last made for, as drawn: the one whose menu opens, if one does, since a
 * term can be used more than once in the text and only its own card stays open.
 */
let madeFor: Element | undefined;

/** The target of the term `found`, in `overview`, with the block it's in, if it's in one. */
export function termTarget(overview: DrawnOverview, found: TermAt): TermTarget {
  madeFor = found.element;
  const article = overview.scroller()?.querySelector('.lo-ov__article');
  const block = article ? blockOf(article, found.element) : undefined;
  const at = block && targetOf(overview, block);
  return at?.kind === 'block'
    ? { kind: 'term', term: found.key, block: at.block }
    : { kind: 'term', term: found.key };
}

/** The menu of a term in the overview on screen, as its card opens it and stays open with it. */
export const termMenu: TermMenu = {
  open(key, from, at) {
    const tab = activeTab();
    const overview = tab?.kind === 'pull' ? drawnIn(tab.id) : undefined;
    const found = termAt(from);
    if (!overview || !found || found.key !== key || !overview.root.contains(found.element)) {
      return false;
    }
    return openMenu(termTarget(overview, found), at);
  },
  isOpen(key, element) {
    const target = currentMenu()?.target;
    return (
      target?.kind === 'term' && target.term === key && element !== null && madeFor === element
    );
  },
  subscribe: followMenu,
};
