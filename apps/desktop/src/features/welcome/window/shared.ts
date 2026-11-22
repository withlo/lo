// What the welcome feature shares with other features' window code: the slot for the rows of its
// set-up step, "Use Lo with your other tools". A feature puts a row there with `SetupItem` from
// `@lo/ui`; the rows go in `order`, lower first. What opens the welcome again is its command,
// `welcome.show`, which a control anywhere can run.

import { defineSlot } from '../../../window/slots.tsx';

/**
 * The rows of the welcome's set-up step, one view each: a row that says what it adds in a line,
 * with one button, which gives way to the row's state once it's done (`done`). Lo's own take 10
 * (the `lo` command) and 20 (sending pull request links to Lo); later rows go after them. A feature
 * that needs set-up adds its row here and a row in Settings, never a banner.
 */
export const setup = defineSlot('welcome.setup');
