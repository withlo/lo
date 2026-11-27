// The diff's layout as the window shows it: `gi` and the menu change it at once in the view on
// screen, then for every tab, as the setting.

import { shownAtOnce } from '../../settings/window/shared.ts';
import { layout } from '../settings.ts';
import type { Drawn } from './tabs.ts';

/**
 * The layout every tab's diff is drawn in: the one asked for here while it's saving, then the
 * setting's, so two quick `gi`s never come back as two more changes.
 */
export const shownLayout = shownAtOnce(layout);

/** The diff's layout, at once in the view on screen, then for every tab, as the setting. */
export async function setLayout({ view }: Drawn, next: 'split' | 'inline'): Promise<void> {
  view.setLayout(next);
  await shownLayout.change(next);
}
