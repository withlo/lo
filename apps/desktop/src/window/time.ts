// Times as the window's notes say them, for every feature: a time of day, and when something was
// saved.

/** A time of day, as the system shows it: "14:05". */
export function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** When something was saved, as a note says it: "today, 09:12", "yesterday, 18:40", "Nov 1, 09:12". */
export function savedWhen(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const time = clockOf(at);
  if (when.toDateString() === today.toDateString()) return `today, ${time}`;
  if (when.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}
