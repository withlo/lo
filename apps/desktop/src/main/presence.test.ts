import type { Presence } from '@lo/github';
import { expect, test } from 'vitest';

import { presenceOf, Presences, type Sight } from './presence.ts';

const sight = (seen: Partial<Sight>): Sight => ({
  focused: false,
  shown: false,
  locked: false,
  ...seen,
});

test('in front with focus, on screen without it, and away off screen or locked', () => {
  expect(presenceOf(sight({ focused: true, shown: true }))).toBe('front');
  expect(presenceOf(sight({ shown: true }))).toBe('shown');
  expect(presenceOf(sight({}))).toBe('away');
  // A window that keeps focus as it's minimized is off screen all the same.
  expect(presenceOf(sight({ focused: true }))).toBe('away');
  expect(presenceOf(sight({ focused: true, shown: true, locked: true }))).toBe('away');
  expect(presenceOf(sight({ shown: true, locked: true }))).toBe('away');
});

test('listeners hear where lo is at once, then each change once', () => {
  const presences = new Presences(sight({}));
  const heard: Presence[] = [];
  const stop = presences.watch((presence) => heard.push(presence));
  presences.look(sight({ shown: true }));
  presences.look(sight({ shown: true }));
  presences.look(sight({ shown: true, focused: true }));
  presences.look(sight({ shown: true, focused: true, locked: true }));
  expect(heard).toEqual(['away', 'shown', 'front', 'away']);
  expect(presences.presence).toBe('away');
  stop();
  presences.look(sight({ shown: true }));
  expect(heard).toHaveLength(4);
});
