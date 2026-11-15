// Trust's commands, each with no key: trusting is done once a repository, and through main's own
// dialog. In the palette and the app's Review menu; a pull request's banner offers the first two.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('code', {
  /** Asks main to ask whether to trust the repository of the pull request on screen. */
  trust: {
    label: 'Trust this repo…',
    group: 'Code',
    keys: [],
    bar: { menu: 'Review', order: 40 },
  },
  /** Asks main to ask whether to trust the pull request on screen, from its fork, alone. */
  trustPull: {
    label: 'Trust this PR…',
    group: 'Code',
    keys: [],
    bar: { menu: 'Review', order: 41 },
  },
  /** Stops trusting what trusts the pull request on screen: language servers stop on it. */
  untrust: {
    label: 'Stop trusting this repo',
    group: 'Code',
    keys: [],
    bar: { menu: 'Review', order: 42 },
  },
  /** Dismisses the banner saying language servers are off, for the repository on screen. */
  dismiss: {
    label: 'Dismiss the banner about language servers',
    group: 'Code',
    keys: [],
    bar: { menu: 'Review', order: 43 },
  },
});
