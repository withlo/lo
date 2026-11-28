// The keys of what a glossary's term offers, wherever a term is: in an overview's text, its card,
// and its row in the overview's Glossary section. `⏎` on its row expands it, where on the term in
// the text it goes to the row. Going to its history from the text, and its menu's switches, which
// show it as plain text in the repo it's read in or in every repo, have none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the overview, where its terms are. */
const overview: When = { scope: 'overview' };

export default defineCommands('terms', {
  /**
   * Goes from a term in the text, or its card, to its row in the overview's Glossary section, and
   * expands the row and the section, to show its suggestions and its earlier definitions: a place
   * in the tab's history, so `⌃o` comes back.
   */
  history: {
    label: 'Show history',
    control: 'History in a term’s card',
    group: 'Review',
    keys: [],
    targets: ['term'],
    when: overview,
    menu: { on: 'term', order: 30 },
  },
  /**
   * Expands a term's row to show who its definition is by, its lock, its other names, its
   * suggestions and its earlier definitions, or collapses it. The handler names it by what it would
   * do: "Collapse term" on one expanded. On a row, `⏎` is its, where on a term in the text it goes
   * to the term's row.
   */
  expand: {
    label: 'Expand term',
    control: 'the chevron at the end of a term’s row',
    group: 'Review',
    keys: ['enter'],
    targets: ['term'],
    when: { scope: 'overview', on: 'row' },
    // Where a use of the term has Show history.
    menu: { on: 'term', order: 31 },
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
