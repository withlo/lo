// Times and sizes as `design/writing.md` writes them, under "Punctuation and formats". Everything in
// the window that says how long ago, how long or how large says it through these, so each is
// written one way.

/** A unit of time, as the guide writes it after a number. */
export type TimeUnit = 's' | 'min' | 'h' | 'd';

/** A length of time in one whole unit: 2 of `h` is "2 h". */
export interface Span {
  readonly count: number;
  readonly unit: TimeUnit;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How many days back {@link ago} says how long ago a time was. Past them, it says the date. */
const AGO_DAYS = 30;

/**
 * How a length of time rounds to its unit. `down` for time gone, so 59 s stays 59 s, and for what's
 * left before a deadline, which is never more than it says: a code with 14 min 59 s left expires in
 * 14 min. `up` for a wait, as a countdown counts: never under a second, and 1 h 59 min is 2 h.
 */
export type Round = 'down' | 'up';

/** `milliseconds` in its largest whole unit only, never two: 2 h 14 min is 2 h, rounded `round`. */
export function spanOf(milliseconds: number, round: Round = 'down'): Span {
  const at = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
  const whole = round === 'up' ? Math.ceil : Math.floor;
  const seconds = round === 'up' ? Math.max(1, whole(at / SECOND)) : whole(at / SECOND);
  if (seconds < 60) return { count: seconds, unit: 's' };
  const minutes = whole(seconds / 60);
  if (minutes < 60) return { count: minutes, unit: 'min' };
  const hours = whole(minutes / 60);
  if (hours < 24) return { count: hours, unit: 'h' };
  return { count: whole(hours / 24), unit: 'd' };
}

/** A length of time, as {@link spanOf} rounds it: "20 s", "5 min", "2 h", "3 d". */
export function duration(milliseconds: number, round: Round = 'down'): string {
  const { count, unit } = spanOf(milliseconds, round);
  return `${count} ${unit}`;
}

/** An estimate, to the nearest minute and a minute at least: "about 12 min", "about 2 h". */
export function about(milliseconds: number): string {
  const at = Number.isFinite(milliseconds) ? milliseconds : 0;
  return `about ${duration(Math.max(1, Math.round(at / MINUTE)) * MINUTE)}`;
}

/**
 * How long before `now` `at` was, in its largest whole unit: "just now" under a minute, "5 min ago",
 * "2 h ago", "3 d ago". More than 30 days back it's the date as the system writes one, "Nov 12",
 * with the year when it isn't this one: "Nov 12, 2025". A time after `now`, from a clock that runs
 * ahead, is "just now", and a time that isn't one says nothing.
 */
export function ago(at: number, now: number): string {
  if (!Number.isFinite(at)) return '';
  const gone = Math.max(0, now - at);
  if (gone < MINUTE) return 'just now';
  if (gone <= AGO_DAYS * DAY) return `${duration(gone)} ago`;
  const date = new Date(at);
  const year = date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year });
}

/**
 * {@link ago} where it stands alone, as a fact's value does, and so starts with a capital: "Just
 * now", then "5 min ago", "2 h ago", "Nov 12". In a line, after other words, it's {@link ago}'s.
 */
export function agoAlone(at: number, now: number): string {
  const said = ago(at, now);
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}

let timeFormat: Intl.DateTimeFormat | undefined;

/** A time of day, as the system writes one: "14:05", or "2:05 PM". */
export function clock(at: number): string {
  // Made once: making one takes a while.
  timeFormat ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return timeFormat.format(at);
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * How a size shows in the unit at `unit` of {@link SIZE_UNITS}: whole below a MB, to one decimal
 * from it, rounded to the nearest or up.
 */
function shown(value: number, unit: number, round: 'nearest' | 'up'): number {
  const step = unit < 2 ? 1 : 10;
  return (round === 'up' ? Math.ceil(value * step) : Math.round(value * step)) / step;
}

/**
 * A size in bytes, counted in 1,024s: "512 B", "38 KB", "6.2 GB". Whole below 1 MB, one decimal from
 * it, and never ".0": "6 GB". A size that would show as 1,024 of a unit is one of the next, and one
 * below nothing is nothing. A size over a limit rounds `up`, so it never reads as the limit itself:
 * a byte over 1 MB is "1.1 MB".
 */
export function bytes(size: number, round: 'nearest' | 'up' = 'nearest'): string {
  let value = Number.isFinite(size) ? Math.max(0, size) : 0;
  let unit = 0;
  while (unit < SIZE_UNITS.length - 1 && shown(value, unit, round) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  return `${shown(value, unit, round).toLocaleString('en-US')} ${SIZE_UNITS[unit]}`;
}
