import { app, nativeTheme } from 'electron';

import { defineFeature } from '../../../main/features.ts';
import { contract, type Theme } from '../contract.ts';

// Lo follows the system's appearance.
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

export default defineFeature(contract, {
  handlers: {
    info: () => ({ version: app.getVersion(), platform: process.platform, theme: currentTheme() }),
  },
  start({ publish }) {
    nativeTheme.on('updated', () => publish('theme', currentTheme()));
  },
});
