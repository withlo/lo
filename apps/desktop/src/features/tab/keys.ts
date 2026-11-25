// The tab strip's keys: a tab by its place, the next and previous tab, moving one, the tabs that
// don't fit and closing one. They work wherever focus is, a text field included, but not under a
// dialog or a palette, which hold the keys while they're open. And a pull request's tab's: its left
// and right panels, its middle views, and the account to open it as.

import { defineCommands, type When } from '@lo/ui/commands';

const outside: When = { except: ['dialog', 'palette'] };

/** The command that shows the tab at `position` in the strip, by `⌘` and its number. */
const place = (position: number) => ({
  label: `Tab ${position}`,
  // Keyboard shortcuts lists the eight as one row.
  series: 'Tab 1–8',
  group: 'Tabs' as const,
  keys: [`cmd+${position}`],
  when: outside,
  control: 'the tab in the strip',
});

export default defineCommands('tab', {
  show1: place(1),
  show2: place(2),
  show3: place(3),
  show4: place(4),
  show5: place(5),
  show6: place(6),
  show7: place(7),
  show8: place(8),
  /** `⌘9` is the last tab however many are open, as in browsers, so the end is always a key away. */
  showLast: {
    label: 'Last tab',
    group: 'Tabs',
    keys: ['cmd+9'],
    when: outside,
    control: 'the last tab in the strip, or in its "N more" menu',
  },
  /**
   * Round the ends of the tabs the strip shows: one folded into "N more" moves into the strip as
   * it's shown, so stepping on to it would only step back. `⌃⇥` too, on both systems, as browsers
   * have it.
   */
  next: {
    label: 'Next tab',
    group: 'Tabs',
    keys: ['cmd+shift+]', 'ctrl+tab'],
    when: outside,
    repeat: true,
    bar: { menu: 'Window', section: 'tabs', order: 10 },
  },
  previous: {
    label: 'Previous tab',
    group: 'Tabs',
    keys: ['cmd+shift+[', 'ctrl+shift+tab'],
    when: outside,
    repeat: true,
    bar: { menu: 'Window', section: 'tabs', order: 20 },
  },
  /**
   * The tab on screen, or the one right-clicked, one place along the strip, but not past its ends
   * or the last tab it shows. `⌃⇧PgUp` and `⌃⇧PgDn` move a tab in browsers and terminals, on both
   * systems.
   */
  moveLeft: {
    label: 'Move tab left',
    group: 'Tabs',
    keys: ['ctrl+shift+pageup'],
    targets: ['tab', 'none'],
    when: outside,
    repeat: true,
    menu: { on: 'tab', order: 1 },
  },
  moveRight: {
    label: 'Move tab right',
    group: 'Tabs',
    keys: ['ctrl+shift+pagedown'],
    targets: ['tab', 'none'],
    when: outside,
    repeat: true,
    menu: { on: 'tab', order: 2 },
  },
  /**
   * The menu of the tabs that don't fit in the strip, "N more", to show one of them. Browsers
   * search their tabs with the same key. In a comment box, the key attaches files instead.
   */
  more: {
    label: 'More tabs',
    group: 'Tabs',
    keys: ['cmd+shift+a'],
    when: { except: ['dialog', 'palette', 'box'] },
    control: '"N more" at the end of the strip',
  },
  /** Opens and closes a pull request's left panel: its stack and files. */
  leftPanel: {
    label: 'Left panel',
    group: 'View',
    keys: ['cmd+\\'],
    when: outside,
    bar: { menu: 'View', section: 'panels', order: 10 },
    toggle: 'switch',
  },
  /**
   * Opens and closes the right panel, the threads, in every pull request's tab: opened, it takes
   * focus, so its keys work at once; closed, focus in it goes back to the middle view.
   */
  rightPanel: {
    label: 'Threads panel',
    group: 'View',
    keys: ['cmd+shift+\\'],
    when: outside,
    bar: { menu: 'View', section: 'panels', order: 20 },
    toggle: 'switch',
  },
  /**
   * The next of a pull request's middle views the header's switch lists: overview, diff, timeline,
   * round the end. A file whole isn't one of them: it opens from a file, and `⌃o` goes back.
   */
  nextView: {
    label: 'Next view',
    group: 'View',
    keys: ['`'],
    overVim: true,
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    control: 'Overview, Diff and Timeline in the pull request’s header',
  },
  previousView: {
    label: 'Previous view',
    group: 'View',
    keys: ['~'],
    overVim: true,
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    control: 'Overview, Diff and Timeline in the pull request’s header',
  },
  /**
   * Opens the pull request on screen on GitHub, in the browser: its page, from anywhere in its tab,
   * as the File menu has it.
   */
  openOnGithub: {
    label: 'Open on GitHub',
    description: 'The pull request’s page.',
    group: 'Tabs',
    keys: [],
    bar: { menu: 'File', section: 'pull', order: 10 },
  },
  /** Copies the link to the pull request on screen, from anywhere in its tab. */
  copyLink: {
    label: 'Copy link',
    group: 'Tabs',
    keys: [],
    bar: { menu: 'File', section: 'pull', order: 20 },
  },
  /**
   * Opens the pull request on screen as an account that can see it, where more than one can and
   * none was chosen for its repo's owner, which Lo then remembers: the account the target names, a
   * row of the tab's choice by its login, or, with none or another list's row, as from the palette
   * or the File menu, the menu of them. It's done once for an owner, so it has no key.
   */
  chooseAccount: {
    label: 'Choose account…',
    control: 'Open as and Choose account… where a pull request’s tab needs an account chosen',
    group: 'Tabs',
    keys: [],
    targets: ['row', 'none'],
    when: outside,
    bar: { menu: 'File', section: 'open', order: 20 },
  },
  /**
   * Shows the next of the pull request's banners, as the banner's "+1" does: the tab shows one at a
   * time. Done once in a while, so it has no key; the keymap file can give it one.
   */
  nextBanner: {
    label: 'Next message',
    description: 'The next one under the pull request’s header.',
    control: '"+1" on the banner under the pull request’s header',
    group: 'Tabs',
    keys: [],
  },
  /**
   * Dismisses the pull request's banner on screen, as its Dismiss does, where it has one: news for
   * good, and an offer where the reader chooses, in its menu, which opens with its first row ready.
   */
  dismissBanner: {
    label: 'Dismiss message',
    description: 'The one under the pull request’s header. An offer asks where.',
    control: 'Dismiss on the banner under the pull request’s header',
    group: 'Tabs',
    keys: [],
  },
  /**
   * The tab on screen, or the one right-clicked. On Linux it's Ctrl+W, over Vim's window keys,
   * which code views don't use; in a comment box in insert mode Ctrl+W deletes a word instead.
   */
  close: {
    label: 'Close tab',
    group: 'Tabs',
    keys: ['cmd+w'],
    targets: ['tab', 'none'],
    overVim: true,
    when: outside,
    bar: { menu: 'File', section: 'tab', order: 10 },
    menu: { on: 'tab', order: 10 },
  },
});
