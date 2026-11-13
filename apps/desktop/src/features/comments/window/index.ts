// The comments feature in the window: posts' text, as other features draw it through `Post`, from
// the HTML main reads for the posts on screen. What it keeps of a view goes as the view's tab
// closes.

import type { WindowFeature } from '../../../window/features.ts';
import { viewIds } from '../../tab/contract.ts';
import { tabs } from './main.ts';
import { keepOnly } from './store.ts';

export default {
  start() {
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(viewIds(open))));
  },
} satisfies WindowFeature;
