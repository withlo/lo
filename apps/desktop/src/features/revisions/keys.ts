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
      label: 'Compare revisions',
      group: 'View',
      keys: ['g v'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box', 'revisions'], mode: 'normal' },
    },
    down: {
      label: 'Next revision',
      group: 'Revision picker',
      keys: ['j', 'down'],
      when: picker,
      repeat: true,
    },
    up: {
      label: 'Previous revision',
      group: 'Revision picker',
      keys: ['k', 'up'],
      when: picker,
      repeat: true,
    },
    /** Makes the revision the keyboard is on an end of the comparison, in place of the nearer one. */
    end: { label: 'Set an end', group: 'Revision picker', keys: ['space'], when: picker },
    /** Compares the two ends, and closes the picker. */
    compare: { label: 'Compare', group: 'Revision picker', keys: ['enter'], when: picker },
    sinceReview: {
      label: 'Compare since your review',
      group: 'Revision picker',
      keys: ['r'],
      when: picker,
    },
    sinceSeen: {
      label: 'Compare since you last looked',
      group: 'Revision picker',
      keys: ['s'],
      when: picker,
    },
    whole: {
      label: 'Compare the whole pull request',
      group: 'Revision picker',
      keys: ['w'],
      when: picker,
    },
    close: {
      label: 'Close the revision picker',
      group: 'Revision picker',
      keys: ['esc'],
      when: picker,
    },
  },
  { scopes: ['revisions'] },
);
