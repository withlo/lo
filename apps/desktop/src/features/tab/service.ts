import { defineService } from '../../main/services.ts';
import type { Opening, Tabs } from './contract.ts';

/** The window's tabs, for features that open them from main, as links from other apps do. */
export interface TabService {
  /** The tabs in the strip's order, and the one on screen. */
  list(): Tabs;
  /**
   * Opens a tab and shows it, and returns its id. A pull request already open, by any name it's
   * known by, or Settings when it's open, shows the tab it's in.
   */
  open(opening: Opening): string;
}

export const tabs = defineService<TabService>('tab.tabs');
