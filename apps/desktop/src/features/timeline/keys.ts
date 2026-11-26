// The timeline's keys, in its own view, the `timeline` scope: moving between its rows, opening the
// row the keyboard is on on GitHub, and going through its links and buttons with `Tab`, `Esc` going
// back to the list. `c` puts focus in the box at the timeline's end, which comments on the pull
// request itself; on one of your comments, `i` edits it and `dd` deletes it, after asking; on a
// review, `⏎` shows its comments in the diff. What a row's buttons do is also on the row's
// right-click menu, and in the palette for the row the keyboard is on, without a key of its own
// where it has none.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the timeline. */
const timeline: When = { scope: 'timeline' };

export default defineCommands(
  'timeline',
  {
    /**
     * Shows the timeline in the middle of the pull request's tab on screen: one of the three views
     * the header's switch lists, so the app menu has it beside the other two, checked while it shows.
     */
    show: {
      label: 'Timeline',
      control: 'Timeline in the pull request’s header',
      group: 'View',
      keys: [],
      bar: { menu: 'View', section: 'views', order: 30 },
      toggle: 'choice',
    },
    down: {
      label: 'Next event',
      group: 'Go',
      keys: ['j', 'down'],
      when: timeline,
      repeat: true,
      control: 'a click on the event',
    },
    up: {
      label: 'Previous event',
      group: 'Go',
      keys: ['k', 'up'],
      when: timeline,
      repeat: true,
      control: 'a click on the event',
    },
    /**
     * In the row the keyboard is on, its next link or button, round through the list itself: it
     * never leaves the row. `Esc` goes back to the list, as in any middle view.
     */
    nextLink: {
      label: 'Next link',
      description: 'Stops at the event’s buttons too.',
      group: 'Go',
      keys: ['tab'],
      when: timeline,
      control: 'a click on the link or button itself',
    },
    previousLink: {
      label: 'Previous link',
      description: 'Stops at the event’s buttons too.',
      group: 'Go',
      keys: ['shift+tab'],
      when: timeline,
      control: 'a click on the link or button itself',
    },
    /** Focus in the box at the timeline's end, which comments on the pull request itself. */
    comment: {
      label: 'Comment on pull request',
      group: 'Comments',
      keys: ['c'],
      when: timeline,
      control: 'the comment box at the timeline’s end',
    },
    /** A box with your comment's text, in its card, to edit it and save it over GitHub's text. */
    editComment: {
      label: 'Edit comment',
      group: 'Comments',
      keys: ['i'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 2 },
    },
    /** Deletes your comment, once you say so. */
    deleteComment: {
      label: 'Delete comment…',
      group: 'Comments',
      keys: ['d d'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 4 },
    },
    /** Shows the hidden comment or review, as its "Show comment" does. */
    showComment: {
      label: 'Show comment',
      group: 'Comments',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 0 },
    },
    /**
     * Shows a review's comments in the diff, at its first comment's thread, as its "Show in diff"
     * does. On a link or button in the row, `⏎` is the link's or button's own.
     */
    showInDiff: {
      label: 'Show in diff',
      group: 'Comments',
      keys: ['enter'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 10 },
      control: 'Show in diff on a review with comments',
    },
    /**
     * Compares the revisions before and after a force-push, and shows the diff, as its "Compare"
     * does.
     */
    compare: {
      label: 'Compare',
      group: 'View',
      keys: [],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 20 },
    },
    /**
     * Opens the row on GitHub: a comment or review where it is, a push's commit, a force-push's
     * comparison, a mention's source, and anything else, the older events Lo didn't read among
     * them, the pull request.
     */
    openOnGithub: {
      label: 'Open on GitHub',
      description: 'The event, where it happened.',
      group: 'Tabs',
      keys: ['g x'],
      targets: ['row'],
      when: timeline,
      menu: { on: 'row', order: 40 },
    },
  },
  { scopes: ['timeline'] },
);
