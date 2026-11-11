// The settings feature in main: the settings file, which main reads, watches and writes, and the
// two settings this feature applies itself: the theme, and how much room the local copies may
// take.

import { join } from 'node:path';

import { app, nativeTheme } from 'electron';

import { configFolder } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { contract } from '../contract.ts';
import { settings as service } from '../service.ts';
import { applySettings } from './apply.ts';
import { clear, measure } from './cache.ts';
import { written } from './file.ts';
import { createSettings, type Settings } from './store.ts';

/** The settings file's path, in the folder Lo keeps the files people edit in. */
function settingsPath(): string {
  return join(
    configFolder({
      packaged: app.isPackaged,
      platform: process.platform,
      home: app.getPath('home'),
      appData: app.getPath('appData'),
      env: process.env,
    }),
    'settings.json',
  );
}

let kept: Settings | undefined;

function settings(): Settings {
  if (!kept) throw new IpcError('unavailable', "Lo isn't keeping the settings file yet.");
  return kept;
}

export default defineFeature(contract, {
  provide({ publish }) {
    const path = settingsPath();
    kept = createSettings({
      path,
      shown: written(path, app.getPath('home')),
      changed: (state) => publish('state', state),
      log: (message, error) => console.error(message, error),
    });
    return [provides(service, kept)];
  },
  handlers: {
    read: () => settings().state(),
    set: ({ key, value }) => settings().set(key, value),
    cacheUsage: (_input, { git }) => measure(git),
    clearCache: (_input, { git }) => clear(git),
  },
  start({ git }) {
    // The window follows the system's appearance, which this sets: the app feature reports it.
    applySettings(settings(), {
      appearance: nativeTheme,
      git,
      log: (message, error) => console.error(message, error),
    });
  },
  async stop() {
    await kept?.stop();
  },
});
