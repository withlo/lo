// The settings feature in main: the settings file, which main reads, watches and writes, and the
// two settings this feature applies itself: the theme, and how much room the local copies may
// take.

import { join } from 'node:path';

import { app, nativeTheme } from 'electron';

import { launch, query } from '../../../main/editor.ts';
import { configFolder, keymapEditor } from '../../../main/environment.ts';
import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { IpcError } from '../../../ipc/contract.ts';
import { github } from '../../accounts/service.ts';
import { contract } from '../contract.ts';
import { clearing, settings as service } from '../service.ts';
import { applySettings } from './apply.ts';
import { clear, measure } from './cache.ts';
import { written } from './file.ts';
import { openSettingsFile } from './open.ts';
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

/** What other features clear with the cache. */
const clearers = new Set<() => void>();

function settings(): Settings {
  if (!kept) throw new IpcError('unavailable', "Lo isn't keeping the settings file yet.");
  return kept;
}

export default defineFeature(contract, {
  // Clearing the cache clears the answers the accounts keep, too.
  uses: [github],
  provide({ publish }) {
    const path = settingsPath();
    kept = createSettings({
      path,
      shown: written(path, app.getPath('home')),
      changed: (state) => publish('state', state),
      log: (message, error) => console.error(message, error),
    });
    return [
      provides(service, kept),
      provides(clearing, {
        onClear(each) {
          // Each its own, so one feature adding the same function twice stops each separately.
          const added = () => each();
          clearers.add(added);
          return () => {
            clearers.delete(added);
          };
        },
      }),
    ];
  },
  handlers: {
    read: () => settings().state(),
    set: ({ key, value }) => settings().set(key, value),
    async openFile() {
      // The only file it opens is the settings file. It is checked and opened as text, never run.
      const result = await openSettingsFile(settingsPath(), {
        platform: process.platform,
        launch,
        linux: { query, env: process.env, home: app.getPath('home') },
        editor: keymapEditor({ packaged: app.isPackaged, env: process.env }),
      });
      if (!result.ok) throw new IpcError('unopened', result.reason);
    },
    cacheUsage: (_input, { git }) => measure(git),
    clearCache: (_input, { git, use }) => clear(git, use(github), [...clearers]),
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
