// The timeline's keys, in its own view, the `timeline` scope: moving between its rows, opening the
// row the keyboard is on on GitHub, and going through its links and buttons with `Tab`, `Esc` going
// back to the list. `c` puts focus in the box at the timeline's end, which comments on the pull
// request itself; on one of your comments, `i` edits it and `dd` deletes it, after asking. What a
// row's buttons do is also on the row's right-click menu, and in the palette for the row the
// keyboard is on, without a key of its own where it has none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the timeline. */
const timeline: When = { scope: 'timeline' };

export default defineCommands(
  'timeline',
  {
    down: {
      label: 'Next event in the timeline',
      group: 'Move',
      keys: ['j', 'down'],
      when: timeline,
      repeat: true,
    },
    up: {
      label: 'Previous event in the timeline',
      group: 'Move',
      keys: ['k', 'up'],
      when: timeline,
      repeat: true,
    },
    /**
     * In the row the keyboard is on, its next link or button, round through the list itself: it
     * never leaves the row. `Esc` goes back to the list, as in any middle view.
     */
    nextLink: {
      label: 'Next link or button in the event',
      group: 'Move',
      keys: ['tab'],
      when: timeline,
    },
    previousLink: {
      label: 'Previous link or button in the event',
      group: 'Move',
      keys: ['shift+tab'],
      when: timeline,
    },
    /** Focus in the box at the timeline's end, which comments on the pull request itself. */
    comment: {
      label: 'Comment on the pull request',
      group: 'Act',
      keys: ['c'],
      when: timeline,
    },
    /** A box with your comment's text, in its card, to edit it and save it over GitHub's text. */
    editComment: {
      label: 'Edit your comment',
      group: 'Act',
      keys: ['i'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 2 },
    },
    /** Deletes your comment, once you say so. */
    deleteComment: {
      label: 'Delete your comment…',
      group: 'Act',
      keys: ['d d'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 4 },
    },
    /** Shows the hidden comment or review, as its "Show comment" does. */
    showComment: {
      label: 'Show the hidden comment',
      group: 'Act',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 0 },
    },
    /** Shows the diff, where a review's comments are, as its "Show in the diff" does. */
    showInDiff: {
      label: 'Show the review’s comments in the diff',
      group: 'View',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 10 },
    },
    /**
     * Compares the revisions before and after a force-push, and shows the diff, as its "Compare"
     * does.
     */
    compare: {
      label: 'Compare the force-push’s revisions',
      group: 'View',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 20 },
    },
    /** Opens the pull request on GitHub, for the events Lo didn't read, as "See them on GitHub" does. */
    seeOlder: {
      label: 'See the older events on GitHub',
      group: 'Copy and open',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 30 },
    },
    /**
     * Opens the row on GitHub: a comment or review where it is, a push's commit, a force-push's
     * comparison, a mention's source, and anything else the pull request.
     */
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Copy and open',
      keys: ['g x'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 40 },
    },
  },
  { scopes: ['timeline'] },
);
