// The stacks feature in the window: `gS`, which makes the chain the pull request on screen is in a
// GitHub stack once the reader confirms what will change, and the dialog that asks and says how it
// goes.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { canMakeStack, makeStackOnScreen, take } from './actions.ts';
import { ConversionDialog } from './Conversion.tsx';
import { main } from './main.ts';

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
  ],
  start() {
    main().subscribe('conversion', take);
  },
} satisfies WindowFeature;
