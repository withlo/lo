// The settings as the window knows them: what main last said. Only this feature writes here; other
// features read the settings through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import type { SettingsState } from '../contract.ts';

export interface SettingsWindowState {
  /** The settings: none only until main first says. */
  readonly settings: SettingsState | undefined;
}

export const settingsStore = createStore<SettingsWindowState>()(() => ({ settings: undefined }));

/** Shows the settings main sent. */
export function showSettings(settings: SettingsState): void {
  settingsStore.setState({ settings }, true);
}
