// The stacks feature in the window: `gS`, which makes the chain the pull request on screen is in a
// GitHub stack once the reader confirms what will change, and the dialog that asks and says how it
// goes; and the banner that offers where the layer on screen's diff starts, once its stack says so
// after the diff was drawn.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners, dialogs } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { canMakeStack, makeStackOnScreen, take } from './actions.ts';
import { ConversionDialog } from './Conversion.tsx';
import { main } from './main.ts';
import { startSwitch, takeStack } from './offers.ts';
import { StartBanner } from './StartBanner.tsx';

export default {
  commands: handlers(keys, {
    convert: { run: makeStackOnScreen, enabled: canMakeStack },
  }),
  views: [
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
    main().subscribe('conversion', take);
    main().subscribe('stack', takeStack);
  },
} satisfies WindowFeature;
