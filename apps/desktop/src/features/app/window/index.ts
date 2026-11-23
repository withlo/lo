import { handlers } from '@lo/ui/commands';

import { IpcError } from '../../../ipc/contract.ts';
import { notify } from '../../../window/commands/notices.tsx';
import type { WindowFeature } from '../../../window/features.ts';
import { client, type Client } from '../../../window/ipc.ts';
import { contract, type Theme } from '../contract.ts';
import keys from '../keys.ts';
import { offerCodeViews } from './codeviews.ts';
import Rows from './Rows.tsx';

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

/** Why the licenses didn't open, as a reason and what the system said, behind Details. */
export function unopened(error: unknown): { reason: string; details: string | undefined } {
  if (!(error instanceof IpcError)) return { reason: '', details: String(error) };
  switch (error.code) {
    case 'missing':
      return { reason: 'The file is missing from this copy of Lo.', details: undefined };
    case 'noApp':
      return {
        reason: 'No app is set for text files.',
        details: 'xdg-mime query default text/plain',
      };
    default:
      return { reason: '', details: error.message === '' ? undefined : error.message };
  }
}

/** Opens the licenses file, and says why in a toast if it can't be. */
async function showLicenses(): Promise<void> {
  try {
    await main().licenses();
  } catch (error) {
    console.error("Lo couldn't open the licenses file:", error);
    const { reason, details } = unopened(error);
    notify('Couldn’t open the licenses', reason, { details, tone: 'danger' });
  }
}

export default {
  commands: handlers(keys, {
    about: { run: () => main().about() },
    licenses: { run: showLicenses },
    quit: { run: () => main().quit() },
    zoomIn: { run: () => main().zoom({ step: 'in' }) },
    zoomOut: { run: () => main().zoom({ step: 'out' }) },
    actualSize: { run: () => main().zoom({ step: 'reset' }) },
    fullScreen: { run: () => main().fullScreen() },
  }),
  views: Rows,
  start() {
    const app = main();
    // Subscribed first, so no change between the two is missed.
    app.subscribe('theme', showTheme);
    app
      .info()
      .then(({ theme, packaged, nonce }) => {
        showTheme(theme);
        if (!packaged) offerCodeViews(nonce);
      })
      .catch((error: unknown) => console.error("Lo couldn't read the theme:", error));
  },
} satisfies WindowFeature;
