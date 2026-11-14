// The tab strip's keys: a tab by its place, the next and previous tab, moving one, the tabs that
// don't fit and closing one. They work wherever focus is, a text field included, but not under a
// dialog or a palette, which hold the keys while they're open. And a pull request's tab's: its left
// panel, and its middle views.

import { defineCommands, type When } from '@lo/ui/commands';

const outside: When = { except: ['dialog', 'palette'] };

/** The command that shows the tab at `position` in the strip, by `⌘` and its number. */
const place = (position: number) => ({
  label: `Tab ${position}`,
  group: 'Tabs and window' as const,
  keys: [`cmd+${position}`],
  when: outside,
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
  showLast: { label: 'Last tab', group: 'Tabs and window', keys: ['cmd+9'], when: outside },
  /**
   * Round the ends of the tabs the strip shows: one folded into "N more" moves into the strip as
   * it's shown, so stepping on to it would only step back. `⌃⇥` too, on both systems, as browsers
   * have it.
   */
  next: {
    label: 'Next tab',
    group: 'Tabs and window',
    keys: ['cmd+shift+]', 'ctrl+tab'],
    when: outside,
    repeat: true,
    bar: { menu: 'Window', order: 10 },
  },
  previous: {
    label: 'Previous tab',
    group: 'Tabs and window',
    keys: ['cmd+shift+[', 'ctrl+shift+tab'],
    when: outside,
    repeat: true,
    bar: { menu: 'Window', order: 20 },
  },
  /**
   * The tab on screen, or the one right-clicked, one place along the strip, but not past its ends
   * or the last tab it shows. `⌃⇧PgUp` and `⌃⇧PgDn` move a tab in browsers and terminals, on both
   * systems.
   */
  moveLeft: {
    label: 'Move tab left',
    group: 'Tabs and window',
    keys: ['ctrl+shift+pageup'],
    targets: ['tab', 'none'],
    when: outside,
    repeat: true,
    menu: { on: 'tab', order: 1 },
  },
  moveRight: {
    label: 'Move tab right',
    group: 'Tabs and window',
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
    label: 'Tabs that don’t fit',
    group: 'Tabs and window',
    keys: ['cmd+shift+a'],
    when: { except: ['dialog', 'palette', 'box'] },
  },
  /** Opens and closes a pull request's left panel: its stack and files. */
  leftPanel: {
    label: 'Left panel',
    group: 'Panels',
    keys: ['cmd+\\'],
    when: outside,
    bar: { menu: 'View', order: 10 },
  },
  /**
   * The next of a pull request's middle views the header's switch lists: overview, diff, timeline,
   * round the end. A file whole isn't one of them: it opens from a file, and `⌃o` goes back.
   */
  nextView: {
    label: 'Next middle view',
    group: 'View',
    keys: ['`'],
    overVim: true,
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
  previousView: {
    label: 'Previous middle view',
    group: 'View',
    keys: ['~'],
    overVim: true,
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
  /**
   * The tab on screen, or the one right-clicked. On Linux it's Ctrl+W, over Vim's window keys,
   * which code views don't use; in a comment box in insert mode Ctrl+W deletes a word instead.
   */
  close: {
    label: 'Close tab',
    group: 'Tabs and window',
    keys: ['cmd+w'],
    targets: ['tab', 'none'],
    overVim: true,
    when: outside,
    bar: { menu: 'File', order: 10 },
    menu: { on: 'tab', order: 10 },
  },
});
