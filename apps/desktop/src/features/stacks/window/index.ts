// The stacks feature in the window: the banner that offers where the layer on screen's diff starts,
// once its stack says so after the diff was drawn.

import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners } from '../../tab/window/shared.ts';
import { StartBanner } from './StartBanner.tsx';
import { main } from './main.ts';
import { takeStack } from './store.ts';

export default {
  views: [
    defineView(banners, {
      id: 'stacks.start',
      order: 10,
      render: ({ tab }) => createElement(StartBanner, { tab }),
    }),
  ],
  start() {
    main().subscribe('stack', takeStack);
  },
} satisfies WindowFeature;
