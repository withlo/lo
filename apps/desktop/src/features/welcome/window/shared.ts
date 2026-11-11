// What the welcome feature shares with other features' window code: the slot for the optional
// steps under its sign-in, "Set up, if you like". A feature puts a step there with `SetupItem`
// from `@lo/ui`; the steps go in `order`, lower first.

import { defineSlot } from '../../../window/slots.tsx';

/**
 * The welcome screen's optional steps, one view each: a row that says what it does and has a
 * button of its own. Lo's own take 10 (the `lo` command) and 20 (sending pull request links to
 * Lo); later steps go after them. The screen draws the list and its label while any step is here.
 */
export const setup = defineSlot('welcome.setup');
