// The overview feature in the window: each pull request's tab's overview, checked as main reads
// it, for the views that show it.

import type { WindowFeature } from '../../../window/features.ts';
import { main, tabs } from './main.ts';
import { catchUp, keepOnly, takeState } from './store.ts';

export default {
  start() {
    main().subscribe('state', takeState);
    tabs().subscribe('tabs', ({ tabs: open }) => keepOnly(new Set(open.map(({ id }) => id))));
    tabs()
      .list()
      .then(({ tabs: open }) =>
        catchUp(open.filter(({ kind }) => kind === 'pull').map(({ id }) => id)),
      )
      .catch((error: unknown) => console.error("Lo couldn't list the tabs:", error));
  },
} satisfies WindowFeature;
