// The app feature's setting: whether Lo draws with the graphics card. It's read before Lo starts
// drawing, so a change applies at the next start, and it's only in the settings file, not in
// Settings: a window that draws nothing couldn't reach it.

import { z } from 'zod';

import { defineSetting } from '../settings/contract.ts';

/**
 * Whether Lo uses hardware acceleration. Off, it draws with the processor alone, which is the
 * way out when a graphics driver leaves the window blank or flickering: what `--disable-gpu` does,
 * which a packaged Lo refuses with every other switch. Main reads it before `ready`.
 */
export const gpu = defineSetting('app.gpu', z.boolean(), true, 'true or false');
