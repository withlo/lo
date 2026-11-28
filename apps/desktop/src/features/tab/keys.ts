// The tab strip's keys: a tab by its place, the next and previous tab, moving one, the tabs that
// don't fit and closing one. They work wherever focus is, a text field included, but not under a
// dialog or a palette, which hold the keys while they're open. And a pull request's tab's: its left
// and right panels, the code beside a reading view, the width of what has focus and the window's
// layout, its middle views and going from one to the other, its local copy's folder, and the
// account to open it as. And reading the tab on screen from GitHub again.

import { defineCommands, type When } from '@lo/ui/commands';

const outside: When = { except: ['dialog', 'palette'] };

/**
 * Where the keys that size what has focus work: in a pull request's tab, but not in a menu, a dialog,
 * a palette or a comment box, and in code views in normal mode, over Vim's own, as `` ` `` does.
 */
const sizing: When = { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' };

/** Where `o` puts the code beside: as the keys that size what has focus, but not in the merge panel. */
const besideWhen: When = { except: ['menu', 'dialog', 'palette', 'box', 'merge'], mode: 'normal' };

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
   * Puts the diff beside the reading view, the overview or the timeline, inline, in every pull
   * request's tab, or takes it away: an arrangement of the window's, kept as it is. From the diff
   * alone, the tab's reading view comes on its left. Focus stays where it is; taken away, the view
   * that had focus stays.
   */
  beside: {
    label: 'Code beside',
    description: 'The diff to the right of the overview or the timeline.',
    group: 'View',
    keys: ['o'],
    overVim: true,
    when: besideWhen,
    bar: { menu: 'View', section: 'panels', order: 30 },
    toggle: 'switch',
  },
  /**
   * Gives focus to the other of two views on screen, the reading view or the code, as a click in it
   * does. With room for only one, the other is drawn in its place.
   */
  otherView: {
    label: 'Go to other view',
    group: 'Go',
    keys: ['\\'],
    when: sizing,
    control: 'a click in the other view',
    bar: { menu: 'Go', section: 'history', order: 30 },
  },
  /**
   * Widens what has focus by a step, as dragging its edge does: a panel, while focus is in it; with
   * the code beside, the view focus is in; or in a side-by-side diff, the side the cursor is on. A
   * held key goes on widening it, to its limit.
   */
  widen: {
    label: 'Widen',
    description: 'The panel, view or side that has focus.',
    group: 'View',
    keys: ['>'],
    overVim: true,
    repeat: true,
    when: sizing,
    control: 'the edge beside what has focus, dragged',
    bar: { menu: 'View', section: 'layout', order: 10 },
  },
  narrow: {
    label: 'Narrow',
    description: 'The panel, view or side that has focus.',
    group: 'View',
    keys: ['<'],
    overVim: true,
    repeat: true,
    when: sizing,
    control: 'the edge beside what has focus, dragged',
    bar: { menu: 'View', section: 'layout', order: 20 },
  },
  /** Puts what has focus back to its default width, as a double-click on its edge does. */
  resetWidth: {
    label: 'Reset width',
    description: 'The panel, view or side that has focus.',
    group: 'View',
    keys: ['='],
    overVim: true,
    when: sizing,
    control: 'a double-click on the edge beside what has focus',
    bar: { menu: 'View', section: 'layout', order: 30 },
  },
  /**
   * Puts the window's layout back as it first was: the left panel open and the threads panel
   * closed, each at its default width. The window changing is all it says.
   */
  resetLayout: {
    label: 'Reset layout',
    description: 'Panels, views and widths as they first were.',
    group: 'View',
    keys: [],
    bar: { menu: 'View', section: 'layout', order: 40 },
  },
  /**
   * The next of a pull request's middle views the header's switch lists: overview, diff, timeline,
   * round the end; with the code beside, the next reading view, in the reading view's place. A file
   * whole isn't one of them: it opens from a file, and `⌃o` goes back.
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
   * Reads what the tab on screen shows from GitHub again, at once: a pull request's tab its pull
   * request, and all it shows of it; a merge queue's tab its queue. `⌘R` as in browsers on macOS,
   * and `F5`, as there and on Linux, where Ctrl+R stays Vim's `⌃r`.
   */
  refresh: {
    label: 'Refresh',
    description: 'Reads this tab again from GitHub.',
    group: 'Tabs',
    keys: [{ keys: 'cmd+r', on: 'mac' }, 'f5'],
    when: outside,
    bar: { menu: 'View', section: 'refresh', order: 10 },
  },
  /**
   * Shows the pull request on screen's local copy in Finder, or the system's file manager, as its
   * status bar item's details do. Done once in a while, so it has no key.
   */
  showLocalCopy: {
    label: 'Show local copy folder',
    control: 'Show in Finder in the local copy’s details, in the status bar',
    group: 'Tabs',
    keys: [],
  },
  /** Copies where the pull request on screen's local copy is, as its details' Copy path does. */
  copyLocalPath: {
    label: 'Copy local copy path',
    control: 'Copy path in the local copy’s details, in the status bar',
    group: 'Tabs',
    keys: [],
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
