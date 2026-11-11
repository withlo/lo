import { handlers } from '@lo/ui/commands';

import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract, type Theme } from '../contract.ts';
import keys from '../keys.ts';

/** The design system themes everything under `<html>` from its `data-theme`. */
function showTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

let connected: Client<typeof contract> | undefined;

/** The feature's client, made when it's first needed, once the window's bridge is there. */
function main(): Client<typeof contract> {
  connected ??= client(contract);
  return connected;
}

export default {
  commands: handlers(keys, {
    quit: { run: () => main().quit() },
    zoomIn: { run: () => main().zoom({ step: 'in' }) },
    zoomOut: { run: () => main().zoom({ step: 'out' }) },
    actualSize: { run: () => main().zoom({ step: 'reset' }) },
    fullScreen: { run: () => main().fullScreen() },
  }),
  start() {
    const app = main();
    // Subscribed first, so no change between the two is missed.
    app.subscribe('theme', showTheme);
    app
      .info()
      .then(({ theme }) => showTheme(theme))
      .catch((error: unknown) => console.error("Lo couldn't read the theme:", error));
  },
} satisfies WindowFeature;
