import { defineService } from '../../main/services.ts';

/** Whether there are overviews, for features that read what only an overview needs. */
export interface OverviewSwitch {
  /**
   * Whether overviews are on: false too until Lo has read the settings file, so nothing is read for
   * one that turns out to be off.
   */
  on(): boolean;
  /**
   * Calls `listener` each time overviews turn on or off, the first time once Lo has read the
   * settings file and they're on. Returns a function that stops it.
   */
  onChange(listener: (on: boolean) => void): () => void;
}

export const overviews = defineService<OverviewSwitch>('overview.switch');
