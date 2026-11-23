// How the timeline says when something happened.

import { ago } from '@lo/ui';

/** When ISO time `at` was, from `now`, or nothing for a time that doesn't read as one. */
export function when(at: string, now: number): string {
  return ago(Date.parse(at), now);
}
