import { describe, expect, it } from 'vitest';

import { about, ago, agoAlone, bytes, duration } from './formats.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('ago', () => {
  const now = new Date(2025, 10, 30, 12).getTime();

  it('says how long ago a time was in its largest whole unit, rounded down', () => {
    expect(ago(now, now)).toBe('just now');
    expect(ago(now - 59 * SECOND, now)).toBe('just now');
    expect(ago(now - MINUTE, now)).toBe('1 min ago');
    expect(ago(now - 59 * MINUTE - 59 * SECOND, now)).toBe('59 min ago');
    expect(ago(now - 2 * HOUR - 14 * MINUTE, now)).toBe('2 h ago');
    expect(ago(now - 23 * HOUR - 59 * MINUTE, now)).toBe('23 h ago');
    expect(ago(now - 6 * DAY - 23 * HOUR, now)).toBe('6 d ago');
    expect(ago(now - 9 * DAY, now)).toBe('9 d ago');
    expect(ago(now - 30 * DAY, now)).toBe('30 d ago');
  });

  it('says the date past 30 days, with the year when it isn’t this one', () => {
    expect(ago(now - 30 * DAY - MINUTE, now)).toBe('Oct 31');
    expect(ago(new Date(2024, 10, 12).getTime(), now)).toBe('Nov 12, 2024');
  });

  it('says "just now" for a time from a clock running ahead, and nothing for one that isn’t a time', () => {
    expect(ago(now + 5 * MINUTE, now)).toBe('just now');
    expect(ago(Number.NaN, now)).toBe('');
  });
});

describe('agoAlone', () => {
  const now = new Date(2025, 10, 30, 12).getTime();

  it('says it as ago does, starting with a capital, as a value of its own', () => {
    expect(agoAlone(now, now)).toBe('Just now');
    expect(agoAlone(now - 5 * MINUTE, now)).toBe('5 min ago');
    expect(agoAlone(now - 2 * HOUR, now)).toBe('2 h ago');
    expect(agoAlone(new Date(2025, 9, 12).getTime(), now)).toBe('Oct 12');
    expect(agoAlone(Number.NaN, now)).toBe('');
  });
});

describe('duration', () => {
  it('says time gone, or what’s left before a deadline, in its largest whole unit, rounded down', () => {
    expect(duration(0)).toBe('0 s');
    expect(duration(400)).toBe('0 s');
    expect(duration(59 * SECOND)).toBe('59 s');
    expect(duration(MINUTE)).toBe('1 min');
    expect(duration(HOUR - 1)).toBe('59 min');
    expect(duration(HOUR)).toBe('1 h');
    expect(duration(119 * HOUR + 3 * MINUTE)).toBe('4 d');
    expect(duration(-5 * SECOND)).toBe('0 s');
  });

  it('says a wait rounded up, as a countdown counts it, never under a second', () => {
    expect(duration(0, 'up')).toBe('1 s');
    expect(duration(400, 'up')).toBe('1 s');
    expect(duration(59 * SECOND, 'up')).toBe('59 s');
    expect(duration(59.5 * SECOND, 'up')).toBe('1 min');
    expect(duration(61 * SECOND, 'up')).toBe('2 min');
    expect(duration(HOUR, 'up')).toBe('1 h');
    // In every unit: past an hour and past a day too.
    expect(duration(HOUR + 59 * MINUTE, 'up')).toBe('2 h');
    expect(duration(DAY - MINUTE, 'up')).toBe('1 d');
    expect(duration(2 * DAY, 'up')).toBe('2 d');
    expect(duration(2 * DAY + HOUR, 'up')).toBe('3 d');
  });
});

describe('about', () => {
  it('says an estimate to the nearest minute, a minute at least', () => {
    expect(about(0)).toBe('about 1 min');
    expect(about(20 * SECOND)).toBe('about 1 min');
    expect(about(90 * SECOND)).toBe('about 2 min');
    expect(about(12 * MINUTE + 20 * SECOND)).toBe('about 12 min');
    expect(about(2 * HOUR + 40 * MINUTE)).toBe('about 2 h');
  });
});

describe('bytes', () => {
  it('writes a size counted in 1,024s, whole below a MB and to one decimal from it', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1023)).toBe('1,023 B');
    expect(bytes(1024)).toBe('1 KB');
    expect(bytes(1536)).toBe('2 KB');
    expect(bytes(38 * 1024)).toBe('38 KB');
    expect(bytes(1024 ** 2)).toBe('1 MB');
    expect(bytes(12.34 * 1024 ** 2)).toBe('12.3 MB');
    expect(bytes(6.2 * 1024 ** 3)).toBe('6.2 GB');
    expect(bytes(6 * 1024 ** 3)).toBe('6 GB');
    expect(bytes(1.5 * 1024 ** 4)).toBe('1.5 TB');
    // Past the last unit, it stays in it.
    expect(bytes(2048 * 1024 ** 4)).toBe('2,048 TB');
  });

  it('writes a size that would show as 1,024 of a unit as one of the next', () => {
    expect(bytes(1024 - 0.4)).toBe('1 KB');
    expect(bytes(1024 ** 2 - 1)).toBe('1 MB');
    expect(bytes(1024 ** 3 - 1)).toBe('1 GB');
  });

  it('writes a size over a limit rounded up, so it never reads as the limit itself', () => {
    expect(bytes(1024 ** 2 + 1, 'up')).toBe('1.1 MB');
    expect(bytes(50 * 1024 ** 2 + 1, 'up')).toBe('50.1 MB');
    expect(bytes(50 * 1024 ** 2, 'up')).toBe('50 MB');
    expect(bytes(1023.2, 'up')).toBe('1 KB');
  });

  it('writes a size below nothing, or not a number, as nothing', () => {
    expect(bytes(-5)).toBe('0 B');
    expect(bytes(Number.NaN)).toBe('0 B');
  });
});
