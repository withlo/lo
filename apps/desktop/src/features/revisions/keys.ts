// The revisions' keys: `gv` opens the revision picker over a pull request's tab, and in it `j` and
// `k` move, `Space` sets an end, `⏎` compares the two ends, and a key each compares since your last
// review, since you last looked here, or the whole pull request. `Esc` closes it.

import { defineCommands, type When } from '@lo/ui/commands';

const picker: When = { scope: 'revisions' };

export default defineCommands(
  'revisions',
  {
    /**
     * Opens the revision picker, to choose what to compare. `gv` is Vim's "select the last
     * selection again", which a diff has little use for.
     */
    picker: {
      label: 'Compare revisions…',
      group: 'View',
      keys: ['g v'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box', 'revisions'], mode: 'normal' },
    },
    down: {
      label: 'Next revision',
      group: 'View',
      keys: ['j', 'down'],
      when: picker,
      repeat: true,
    },
    up: {
      label: 'Previous revision',
      group: 'View',
      keys: ['k', 'up'],
      when: picker,
      repeat: true,
    },
    /** Makes the revision the keyboard is on an end of the comparison, in place of the nearer one. */
    end: { label: 'Set comparison end', group: 'View', keys: ['space'], when: picker },
    /** Compares the two ends, and closes the picker. */
    compare: { label: 'Compare', group: 'View', keys: ['enter'], when: picker },
    sinceReview: {
      label: 'Compare since your review',
      group: 'View',
      keys: ['r'],
      when: picker,
    },
    sinceSeen: {
      label: 'Compare since last opened',
      group: 'View',
      keys: ['s'],
      when: picker,
    },
    whole: {
      label: 'Compare whole pull request',
      group: 'View',
      keys: ['w'],
      when: picker,
    },
    close: {
      label: 'Close revisions',
      group: 'View',
      keys: ['esc'],
      when: picker,
    },
  },
  { scopes: ['revisions'] },
);
