// When something was saved, as the window's notes say it, for every feature.

import { clock } from '@lo/ui';

/** When something was saved, as a note says it: "today, 09:12", "yesterday, 18:40", "Nov 1, 09:12". */
export function savedWhen(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const time = clock(at);
  if (when.toDateString() === today.toDateString()) return `today, ${time}`;
  if (when.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
