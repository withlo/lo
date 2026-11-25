// What the welcome feature shares with other features' window code: the slots for the rows of its
// set-up step, "Use Lo with your other tools", and of the step that says what an overview is. A
// feature puts a row in either with `SetupItem` from `@lo/ui`; the rows go in `order`, lower first.
// What opens the welcome again is its command, `welcome.show`, which a control anywhere can run.

import { defineSlot } from '../../../window/slots.tsx';

/**
 * The rows of the welcome's set-up step, one view each: a row that says what it adds in a line,
 * with one button, which gives way to the row's state once it's done (`done`). Lo's own take 10
 * (the `lo` command) and 20 (sending pull request links to Lo); later rows go after them. A feature
 * that needs set-up adds its row here and a row in Settings, never a banner.
 */
export const setup = defineSlot('welcome.setup');

/**
 * The rows of the welcome's step that says what an overview is, one view each: a setting that
 * follows from it, as a `SetupItem` with no icon, its label, a line, and the control its row in
 * Settings has, written as it's changed. Whether there are overviews takes 10, and what a pull
 * request's tab opens on 20.
 */
export const overviewRows = defineSlot('welcome.overviewRows');
