// The comments' keys. In the threads panel, the `threads` scope: `j` and `k` move between its
// threads, `⏎` shows the one the keyboard is on in the diff, and `f` steps through what it lists:
// the unresolved threads, every thread, or yours. `Esc` goes back to the middle view, as it does
// anywhere.

import { defineCommands, type When } from '@lo/ui/commands';

/** In the threads panel. */
const panel: When = { scope: 'threads' };

export default defineCommands(
  'comments',
  {
    nextThread: {
      label: 'Next thread in the panel',
      group: 'Panels',
      keys: ['j', 'down'],
      when: panel,
      repeat: true,
    },
    previousThread: {
      label: 'Previous thread in the panel',
      group: 'Panels',
      keys: ['k', 'up'],
      when: panel,
      repeat: true,
    },
    /**
     * Shows the thread the keyboard is on in the diff, opened, at the top of the screen, with focus
     * staying in the panel. One the diff on screen doesn't show, such as an outdated thread, shows
     * in the diff of the revision it's on. A jump, which `⌃o` comes back from.
     */
    showThread: {
      label: 'Show the thread in the diff',
      group: 'Panels',
      keys: ['enter'],
      targets: ['thread'],
      when: panel,
    },
    /** Lists the unresolved threads, every thread, or yours, round the end. */
    filterThreads: {
      label: 'Unresolved, all or your threads',
      group: 'Panels',
      keys: ['f'],
      when: panel,
    },
  },
  { scopes: ['threads'] },
);
