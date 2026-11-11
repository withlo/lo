import { defineService } from '../../main/services.ts';
import type { Setting } from './contract.ts';

/** The settings file, for features that apply a setting in main, or keep one the window shows. */
export interface SettingsStore {
  /**
   * Makes a setting known: from then on the file's value for it is checked (a value its schema
   * refuses is reported and ignored), and the window may change it. A feature declares each of
   * its settings once, in `start`.
   */
  declare<T>(setting: Setting<T>): void;
  /**
   * Declares `setting` if it isn't, and calls `listener` with its value once Lo has read the file
   * and again each time it changes, whether the file was edited or Settings changed it. It runs
   * no sooner than the file has been read, so a setting is never applied at its default first.
   * Returns a function that stops it.
   */
  watch<T>(setting: Setting<T>, listener: (value: T) => void): () => void;
}

export const settings = defineService<SettingsStore>('settings.file');
