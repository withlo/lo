// The stacks feature in the window: the stack's tree, at the top of a pull request's tab's left
// panel; `]s` and `[s`, which walk it; `-` from the file tree, which goes up to it, and its keys;
// `gS`, which makes the chain the pull request on screen is in a GitHub stack once the reader
// confirms what will change, with the dialog that asks and says how it goes; and the banner that
// offers where the layer on screen's diff starts, once its stack says so after the diff was drawn.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners, dialogs, left } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { take } from './actions.ts';
import { ConversionDialog } from './Conversion.tsx';
import { takeStack } from './layers.ts';
import { main } from './main.ts';
import { startSwitch, takeStack as takeOffer } from './offers.ts';
import { Stack } from './Stack.tsx';
import { StartBanner } from './StartBanner.tsx';
import {
  convertible,
  convertTarget,
  goToStack,
  moveFocus,
  onLayer,
  openOnGithub,
  pullOnScreen,
  showTarget,
  stackShown,
  walking,
} from './walk.ts';

/** Why a key for the stack's tree can't run: there's no pull request on screen. */
function inPull(): true | string {
  const tab = pullOnScreen();
  return typeof tab === 'string' ? tab : true;
}

export default {
  commands: handlers(keys, {
    nextLayer: walking(1),
    previousLayer: walking(-1),
    focus: { run: goToStack, enabled: stackShown },
    down: { run: () => moveFocus(1), enabled: inPull },
    up: { run: () => moveFocus(-1), enabled: inPull },
    show: { run: showTarget, enabled: onLayer },
    openOnGithub: { run: openOnGithub, enabled: onLayer },
    convert: { run: convertTarget, enabled: convertible },
  }),
  views: [
    // Above the files.
    defineView(left, {
      id: 'stacks.tree',
      order: 10,
      render: ({ tab }) => createElement(Stack, { tab }),
    }),
    // After the accounts' dialogs, the open box and the file finder.
    defineView(dialogs, {
      id: 'stacks.conversion',
      order: 30,
      render: () => createElement(ConversionDialog),
    }),
    defineView(banners, {
      id: 'stacks.start',
      order: 10,
      render: ({ tab }) => createElement(StartBanner, { tab }),
      ...startSwitch,
    }),
  ],
  start() {
    main().subscribe('stack', (state) => {
      takeStack(state);
      takeOffer(state);
    });
    main().subscribe('conversion', take);
  },
} satisfies WindowFeature;
