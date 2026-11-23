// The updates feature's commands: checking for a newer Lo, updating to it, restarting into it,
// moving Lo to Applications so it can update itself, and hiding an update until Lo starts again;
// and what the other buttons of the toast that offers it do: open the update's page, copy the
// Homebrew command, and go to the toast. Each is done once in a while, so none has a key: the app
// menu and the command palette reach them, each only while it applies. The app menu lists what's
// asked of an update most, to check for one, install it and restart into it, and the rest are in
// its Update submenu. The first five ask main, which refuses one that doesn't apply now and says
// why.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'updates',
  {
    /** Checks GitHub Releases for a newer Lo now, and says what it found. */
    check: {
      label: 'Check for updates',
      control: 'Check now on the Lo row of Settings › About',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 1 },
    },
    /** Downloads the newer Lo on offer, to install as Lo quits. */
    install: {
      label: 'Update Lo',
      control: "Update on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 2 },
    },
    /** Quits, installs the downloaded update and starts Lo again. */
    restart: {
      label: 'Restart to update',
      control: "Restart to update on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 3 },
    },
    /** Moves Lo to Applications, where it can update itself, and starts it again from there. */
    move: {
      label: 'Move Lo to Applications',
      control: "Move Lo to Applications on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      when: { system: 'mac' },
      bar: { menu: 'Update', order: 1 },
    },
    /** Hides the update on offer until Lo starts again: it comes back after a restart. */
    later: {
      label: 'Hide update',
      control: "Hide on the update's toast",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Update', order: 2 },
    },
    /**
     * Opens the page of the update on offer, where its notes are; with none on offer, the list of
     * Lo's releases.
     */
    whatsNew: {
      label: 'What’s new',
      control: "What’s new on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Update', order: 3 },
    },
    /** Opens the page of the release on offer, to download it from, where Lo can't install it. */
    download: {
      label: 'Download update',
      control: "Download update on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Update', order: 4 },
    },
    /** Copies the command that updates Lo through Homebrew. */
    copy: {
      label: 'Copy Homebrew command',
      control: "Copy on the update's toast, and in Settings › About",
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Update', order: 5 },
    },
    /**
     * Puts focus on the toast that offers the update, whose buttons `Tab` then moves between, and
     * `Esc` goes back to the middle of the window from. The toast never takes focus itself.
     */
    focus: {
      label: 'Go to update',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Update', order: 6 },
    },
  },
  { scopes: ['toasts'] },
);
