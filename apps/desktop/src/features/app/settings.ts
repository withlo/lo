// The app feature's settings: how large the window draws, and whether Lo draws with the graphics
// card. The zoom is the window's, which `⌘+`, `⌘-` and `⌘0` change and Settings shows. The graphics
// card is read before Lo starts drawing, so a change applies at the next start, and it's only in
// the settings file, not in Settings: a window that draws nothing couldn't reach it.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Whether Lo uses hardware acceleration. Off, it draws with the processor alone, which is the
 * way out when a graphics driver leaves the window blank or flickering: what `--disable-gpu` does,
 * which a packaged Lo refuses with every other switch. Main reads it before `ready`. Only the
 * person editing the file changes it: the window, which has no control for it, can't.
 */
export const gpu = defineSetting('app.gpu', z.boolean(), true, 'true or false', {
  group: 'file',
  label: 'Hardware acceleration',
  description: 'Draws with the graphics card. A change applies at the next start.',
  window: 'read',
});

/** The zoom levels `⌘+` and `⌘-` step through, in percent, as browsers step theirs. */
export const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

/** How large the window draws everything, in percent of its actual size. */
export const zoom = defineSetting(
  'window.zoom',
  z
    .number()
    .int()
    .min(ZOOM_STEPS[0])
    .max(ZOOM_STEPS.at(-1) ?? 200),
  100,
  'a whole percent, from 50 to 200',
  {
    group: 'appearance',
    label: 'Zoom',
    description: 'The size of everything in the window.',
  },
);
