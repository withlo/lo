// The tab feature in main: it keeps the window's tabs, tells the window each time they change,
// and opens them for other features, as links from other apps will.

import { defineFeature, type FeatureContext } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { contract, opening as openingSchema } from '../contract.ts';
import { tabs } from '../service.ts';
import { createTabs, type TabList } from './tabs.ts';

let kept: TabList | undefined;

/** The tabs, read from the database the first time anything asks for them. */
function tabsOf({ database, publish }: FeatureContext<typeof contract>): TabList {
  kept ??= createTabs({ database, changed: (value) => publish('tabs', value) });
  return kept;
}

export default defineFeature(contract, {
  provide: (context) => [
    provides(tabs, {
      list: () => tabsOf(context).list(),
      // Checked as a request's input is: what another feature hands over may come from a link.
      open: (opening) => tabsOf(context).open(openingSchema.parse(opening)),
    }),
  ],
  handlers: {
    list: (_input, context) => tabsOf(context).list(),
    open: (opening, context) => tabsOf(context).open(opening),
    close({ id }, context) {
      tabsOf(context).close(id);
    },
    select(choice, context) {
      tabsOf(context).select(choice);
    },
    move({ id, to }, context) {
      tabsOf(context).move(id, to);
    },
  },
});
