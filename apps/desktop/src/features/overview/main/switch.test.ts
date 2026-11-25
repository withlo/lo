// Overviews turned off and on in main: nothing is read until the settings file says they're on;
// off, every followed tab's overview closes; on, each open tab's is read again; and the features
// that read for overviews are told of each change, once.

import { describe, expect, it } from 'vitest';

import { Overviews } from './switch.ts';

/** Tabs `open`, each followed while overviews are on, as main follows them; with what it did. */
function tabsOf(overviews: Overviews, open: string[]) {
  const followed = new Set<string>();
  const done: string[] = [];
  return {
    followed,
    done,
    tabs: {
      followed: () => followed.values(),
      open: () => open,
      follow(id: string) {
        if (overviews.on()) {
          followed.add(id);
          done.push(`follow ${id}`);
        } else {
          followed.delete(id);
          done.push(`close ${id}`);
        }
      },
    },
  };
}

describe('overviews in main', () => {
  it('are off until the settings file says, so nothing is read for ones that turn out off', () => {
    const overviews = new Overviews();
    const { tabs, done } = tabsOf(overviews, ['t1', 't2']);
    expect(overviews.on()).toBe(false);
    overviews.turn(false, tabs);
    expect(done).toEqual([]);
  });

  it('read each open tab’s as they turn on, close every one as they turn off, and tell each change once', () => {
    const overviews = new Overviews();
    const { tabs, done, followed } = tabsOf(overviews, ['t1', 't2']);
    const heard: boolean[] = [];
    const stop = overviews.onChange((on) => heard.push(on));

    overviews.turn(true, tabs);
    expect(done).toEqual(['follow t1', 'follow t2']);
    expect([...followed]).toEqual(['t1', 't2']);
    // As they are already, nothing.
    overviews.turn(true, tabs);
    expect(done).toHaveLength(2);

    overviews.turn(false, tabs);
    expect(done.slice(2)).toEqual(['close t1', 'close t2']);
    expect(followed.size).toBe(0);
    expect(heard).toEqual([true, false]);

    stop();
    overviews.turn(true, tabs);
    expect(heard).toEqual([true, false]);
    expect([...followed]).toEqual(['t1', 't2']);
  });

  it('are off again, with no one told, once the feature stops', () => {
    const overviews = new Overviews();
    const { tabs } = tabsOf(overviews, ['t1']);
    const heard: boolean[] = [];
    overviews.onChange((on) => heard.push(on));
    overviews.turn(true, tabs);
    overviews.reset();
    expect(overviews.on()).toBe(false);
    overviews.turn(true, tabs);
    expect(heard).toEqual([true]);
  });
});
