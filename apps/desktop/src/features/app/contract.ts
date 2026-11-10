import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

export const theme = z.enum(['dark', 'light']);
export type Theme = z.output<typeof theme>;

export interface AppInfo {
  /** Lo's version. */
  version: string;
  /** The system Lo runs on, as Node names it: `darwin` or `linux`. */
  platform: string;
  /** The current theme, which `app.theme` then keeps up to date. */
  theme: Theme;
}

export const contract = defineContract('app', {
  requests: {
    info: { input: z.undefined(), reply: reply<AppInfo>() },
  },
  topics: {
    /** The system's appearance, each time it changes. */
    theme,
  },
});
