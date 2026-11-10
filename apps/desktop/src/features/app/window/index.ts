import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { contract, type Theme } from '../contract.ts';

/** The design system themes everything under `<html>` from its `data-theme`. */
function showTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export default {
  start() {
    const app = client(contract);
    // Subscribed first, so no change between the two is missed.
    app.subscribe('theme', showTheme);
    app
      .info()
      .then(({ theme }) => showTheme(theme))
      .catch((error: unknown) => console.error("Lo couldn't read the theme:", error));
  },
} satisfies WindowFeature;
