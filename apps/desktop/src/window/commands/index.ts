// The window's command registry: every feature's commands and handlers, found with
// `import.meta.glob`, and the one key listener.

import { listen } from '@lo/ui/commands';

import { featureCommands } from '../features.ts';
import { createRegistry, systemOf } from './registry.ts';

/** Builds the registry from every feature's commands and starts listening for keys. */
export function startCommands(): void {
  listen(window, createRegistry(featureCommands(), systemOf(navigator.platform)));
}
