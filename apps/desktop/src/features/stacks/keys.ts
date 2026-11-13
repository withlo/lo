// The stacks' keys: `gS` makes the chain the pull request on screen is in a GitHub stack, once you
// confirm what will change. It works anywhere in a pull request's tab, and over Vim in code views
// in normal mode, as `gv` does.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('stacks', {
  /**
   * Plans making the chain the pull request on screen is in a GitHub stack, and asks before
   * anything changes, or says every reason it can't. `g` already prefixes places and toggles, and
   * the capital keeps it a key apart from them.
   */
  convert: {
    label: 'Make this a GitHub stack',
    group: 'Review',
    keys: ['g S'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
});
