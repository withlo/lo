// How the timeline says when something happened.

/** How long before `now` `at` was, in words: "just now", "40 min ago", "3 days ago". */
export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/** When ISO time `at` was, from `now`, or nothing for a time that doesn't read as one. */
export function when(at: string, now: number): string {
  const time = Date.parse(at);
  return Number.isNaN(time) ? '' : ago(time, now);
}
