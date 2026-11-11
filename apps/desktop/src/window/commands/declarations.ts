// Every feature's declarations, from its `keys.ts`: what the checks and `docs/keys.md` read. Node
// imports this, so it holds nothing of the window's.

import type { Declarations } from '@lo/ui/commands';

/**
 * The declarations of the `keys.ts` modules given, keyed by path, in the order of their features'
 * folders, checking that each feature declares its commands under its own folder's name, as the
 * window checks its handlers.
 */
export function checkDeclarations(modules: Readonly<Record<string, Declarations>>): Declarations[] {
  return Object.entries(modules)
    .map(([path, declarations]) => {
      const folder = /(?:^|\/)features\/([^/]+)\/keys\.ts$/.exec(path)?.[1];
      if (declarations.feature !== folder) {
        throw new Error(
          `${path} declares the feature ${declarations.feature}, but its folder is "${folder}".`,
        );
      }
      return declarations;
    })
    .toSorted((a, b) => a.feature.localeCompare(b.feature, 'en'));
}
