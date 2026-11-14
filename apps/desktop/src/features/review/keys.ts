// The review's key: `⌘⏎` submits your review of the pull request on screen, through a dialog that
// asks for a verdict and a summary first. It works anywhere in a pull request's tab but where `⌘⏎`
// means something else already: in a comment box, which adds the comment to your review, and in a
// dialog, the palette or a menu. The status bar's item for your pending review opens it too.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('review', {
  /** Opens the submit dialog for the pull request on screen, or the layer of a stack on screen. */
  submit: {
    label: 'Submit review',
    group: 'Review',
    keys: ['cmd+enter'],
    when: { except: ['box', 'dialog', 'palette', 'menu'] },
    bar: { menu: 'Review', order: 10 },
  },
});
