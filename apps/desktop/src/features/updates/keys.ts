// The updates feature's commands: checking for a newer Lo, installing it, restarting into it,
// moving Lo to Applications so it can update itself, and hiding an update until Lo starts again.
// Each is done once in a while, so none has a key: the app menu and the command palette reach them.
// Each asks main, which refuses one that doesn't apply now and says why.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('updates', {
  /** Checks GitHub Releases for a newer Lo now, and says what it found. */
  check: {
    label: 'Check for updates',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 1 },
  },
  /** Downloads the newer Lo on offer, to install as Lo quits. */
  install: {
    label: 'Install the update',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 2 },
  },
  /** Quits, installs the downloaded update and starts Lo again. */
  restart: {
    label: 'Restart to update',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 3 },
  },
  /** Moves Lo to Applications, where it can update itself, and starts it again from there. */
  move: {
    label: 'Move Lo to Applications',
    group: 'Tabs and window',
    keys: [],
    when: { system: 'mac' },
    bar: { menu: 'App', order: 4 },
  },
  /** Hides the update on offer until Lo starts again. */
  later: {
    label: 'Hide the update until Lo restarts',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 5 },
  },
});
