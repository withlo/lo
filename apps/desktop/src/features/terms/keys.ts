// The keys of what a glossary's term offers, wherever a term is: in an overview's text, its card,
// and its row in the overview's Glossary section: Edit term, first in its menu and in its card's
// foot. Its menu's switches, which show it as plain text in the repo it's read in or in every repo,
// have none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the overview, where its terms are. */
const overview: When = { scope: 'overview' };

export default defineCommands('terms', {
  /**
   * Edit term, for the term's definition and the other forms it's written as, saved to the repo's
   * definitions as the tab's account, which takes push access to the repo.
   */
  edit: {
    label: 'Edit term…',
    group: 'Review',
    keys: ['i'],
    targets: ['term'],
    when: overview,
    control: 'Edit… in a term’s card',
    menu: { on: 'term', order: 10 },
  },
  /**
   * Whether the term is in the list of terms the reader ignores in this repo
   * (`overview.ignored`): on, it's plain text at once, wherever it's used, and its row moves to the
   * Glossary section's Ignored group.
   */
  ignoreHere: {
    label: 'Ignore in this repo',
    group: 'Review',
    keys: [],
    targets: ['term'],
    when: overview,
    toggle: 'switch',
    // After what's done to the term itself, set apart from it.
    menu: { on: 'term', order: 60, apart: true },
  },
  /** As `ignoreHere`, for every repo's list and each repo's own. */
  ignoreAll: {
    label: 'Ignore in every repo',
    group: 'Review',
    keys: [],
    targets: ['term'],
    when: overview,
    toggle: 'switch',
    menu: { on: 'term', order: 61 },
  },
});
