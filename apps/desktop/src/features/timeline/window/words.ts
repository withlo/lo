// How the timeline says when something happened.

/** How many days back a time is still said as how long ago it was, rather than as its date. */
const AGO_DAYS = 30;

/**
 * How long before `now` `at` was, in the largest whole unit: "just now", "40 min ago", "2 h ago",
 * "3 d ago"; past 30 days, its date: "Nov 12", or "Nov 12, 2025" in another year.
 */
export function ago(at: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - at) / 1000);
  if (seconds > AGO_DAYS * 86_400) {
    const date = new Date(at);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  }
  if (seconds < 60) return 'just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** When ISO time `at` was, from `now`, or nothing for a time that doesn't read as one. */
export function when(at: string, now: number): string {
  const time = Date.parse(at);
  return Number.isNaN(time) ? '' : ago(time, now);
}
