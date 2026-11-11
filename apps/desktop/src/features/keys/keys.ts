// The registry's own commands.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('keys', {
  /**
   * Back to the middle view, from anywhere but the widgets that close on `Esc` themselves (menus,
   * dialogs, the palette), a comment box, whose `Esc` is Vim's, and Vim's visual mode.
   */
  escape: {
    label: 'Back to the middle view',
    group: 'Tabs and window',
    keys: ['esc'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
  /** Back through the tab's history. In a comment box, `⌃o` is Vim's, on the box's own list. */
  back: {
    label: 'Back',
    group: 'Code',
    keys: ['ctrl+o'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', order: 10 },
  },
  forward: {
    label: 'Forward',
    group: 'Code',
    keys: ['ctrl+i'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', order: 20 },
  },
});
