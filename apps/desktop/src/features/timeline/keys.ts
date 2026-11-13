// The timeline's keys, in its own view, the `timeline` scope: moving between its rows, and opening
// the row the keyboard is on on GitHub. The actions a row's buttons take have no key of their own.

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
     * Opens the row the keyboard is on on GitHub: a comment or review where it is, a push's commit,
     * a force-push's comparison, a mention's source, and anything else the pull request.
     */
    openOnGithub: {
      label: 'Open on GitHub',
      group: 'Copy and open',
      keys: ['g x'],
      when: timeline,
    },
  },
  { scopes: ['timeline'] },
);
