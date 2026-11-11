// The settings this feature applies itself: the theme, and the size the cache is kept under.
// Nothing here calls Electron, so it runs under unit tests; `index.ts` hands it what it needs.

import type { LocalGit } from '../../../main/git.ts';
import type { SettingsStore } from '../service.ts';
import { cacheCap, GB, theme } from '../settings.ts';

/** What `nativeTheme` of Electron's is to this: the theme the window and Lo's chrome follow. */
export interface Appearance {
  themeSource: 'dark' | 'light' | 'system';
}

/**
 * Applies each setting as the file has it, once it has been read, and again as it changes: the
 * window follows `appearance`, which makes the theme whatever the setting says (or the system's
 * own), and `git` keeps the cache under the cap, in bytes. Returns a function that stops it.
 */
export function applySettings(
  store: SettingsStore,
  options: {
    appearance: Appearance;
    git: Pick<LocalGit, 'setCap'>;
    log: (message: string, error: unknown) => void;
  },
): () => void {
  const { appearance, git, log } = options;
  const stops = [
    store.watch(theme, (value) => {
      appearance.themeSource = value;
    }),
    store.watch(cacheCap, (gb) => {
      git.setCap(gb * GB).catch((error: unknown) => {
        log("Lo couldn't set the cache's cap:", error);
      });
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
