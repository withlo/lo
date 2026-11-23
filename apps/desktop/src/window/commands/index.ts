// The window's command registry: every feature's commands and handlers, found with
// `import.meta.glob`, the one key listener, and what catches focus that falls to the page.

import { catchFocus, listen } from '@lo/ui/commands';

import { featureCommands } from '../features.ts';
import { FIELDLESS } from './fieldless.ts';
import { createRegistry, systemOf } from './registry.ts';

/**
 * Builds the registry from every feature's commands and starts listening for keys, and gives focus
 * that the focused element took with it as it left the page to the nearest part of the view,
 * first, so a key that catches it goes there. A field that has focus in a scope listed as holding
 * none is logged as an error.
 */
export function startCommands(): void {
  catchFocus(window);
  listen(window, createRegistry(featureCommands(), systemOf(navigator.platform)), {
    fieldless: FIELDLESS,
  });
}
