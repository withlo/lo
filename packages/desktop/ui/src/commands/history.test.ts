import { describe, expect, test } from 'vitest';

import { HISTORY_LIMIT, History, type Entry, type View } from './history.ts';
import type { Side, Target } from './targets.ts';

function line(file: string, side: Side, at: number): Entry {
  return { view: 'diff', at: { kind: 'line', at: { file, side, line: at } } };
}

function block(id: string): Entry {
  return { view: 'overview', at: { kind: 'block', block: id } };
}

/** The file a line place is in. */
const fileOf = (at: Target) => (at.kind === 'line' ? at.at.file : '');

/** A view that reveals whatever it's asked to and remembers it, like a live diff view. */
function viewer(
  history: History,
  tab: string,
  view: View,
  can: (at: Target) => boolean = () => true,
) {
  const shown: Target[] = [];
  const unregister = history.register(tab, view, (at) => {
    if (!can(at)) return false;
    shown.push(at);
    return true;
  });
  return { shown, unregister };
}

describe('history', () => {
  test('going back after Tab lands on the side the jump was made on', () => {
    const history = new History();
    const diff = viewer(history, '', 'diff');
    // `Tab` from the old side's line 10 to the new side's line 12.
    history.record(line('a.ts', 'old', 10));
    const here = line('a.ts', 'new', 12);
    expect(history.back(here)).toEqual(line('a.ts', 'old', 10));
    expect(diff.shown).toEqual([line('a.ts', 'old', 10).at]);
    // And forward again, to where `Tab` went.
    expect(history.forward()).toEqual(here);
    expect(history.forward()).toBeUndefined();
  });

  test('crosses views: from code back to an overview block', () => {
    const history = new History();
    viewer(history, '', 'diff');
    const overview = viewer(history, '', 'overview');
    history.record(block('b2'));
    expect(history.back(line('a.ts', 'new', 41))).toEqual(block('b2'));
    expect(overview.shown).toEqual([block('b2').at]);
  });

  test('skips places no view can reveal: a closed view, a file that’s gone', () => {
    const history = new History();
    const diff = viewer(
      history,
      '',
      'diff',
      (at) => !(at.kind === 'line' && at.at.file === 'gone.ts'),
    );
    const file = viewer(history, '', 'file');
    history.record(line('a.ts', 'new', 1));
    history.record({
      view: 'file',
      at: { kind: 'line', at: { file: 'b.ts', side: 'new', line: 5 } },
    });
    history.record(line('gone.ts', 'new', 3));
    // The file view is closed: it can't be reached, and its entries are passed over.
    file.unregister();
    expect(history.back(line('c.ts', 'new', 9))).toEqual(line('a.ts', 'new', 1));
    expect(file.shown).toEqual([]);
    expect(diff.shown).toEqual([line('a.ts', 'new', 1).at]);
    // Nothing earlier, so going back stays put.
    expect(history.back()).toBeUndefined();
    expect(history.forward()).toEqual(line('c.ts', 'new', 9));
  });

  test('holds places, never the editor or anything else a caller hands it', () => {
    const history = new History();
    const editor = { dom: {}, focus() {} };
    const from: Entry = {
      view: 'diff',
      at: { kind: 'line', at: { file: 'a.ts', side: 'old', line: 3 } },
    };
    // A caller's object with more on it than a place.
    Object.assign(from.at, { editor });
    Object.assign(from, { editor });
    history.record(from);
    const entries = history.entries();
    expect(entries).toEqual([line('a.ts', 'old', 3)]);
    // Plain data all through: an editor (functions, DOM nodes) can't be cloned.
    expect(() => structuredClone(entries)).not.toThrow();
    expect(JSON.stringify(entries)).not.toContain('editor');
  });

  test('a jump after going back drops the places ahead, as a browser does', () => {
    const history = new History();
    viewer(history, '', 'diff');
    history.record(line('a.ts', 'new', 1));
    history.record(line('a.ts', 'new', 2));
    history.back(line('a.ts', 'new', 3));
    history.back();
    history.record(line('a.ts', 'new', 1));
    expect(history.entries()).toEqual([line('a.ts', 'new', 1)]);
    expect(history.forward()).toBeUndefined();
  });

  test('a jump a view makes while revealing a place keeps the places ahead', () => {
    const history = new History();
    // As a code view does: moving there is a jump, which it reports.
    history.register('', 'diff', (at) => {
      history.record({
        view: 'diff',
        at: { kind: 'line', at: { file: 'z.ts', side: 'new', line: 99 } },
      });
      return at.kind === 'line';
    });
    history.record(line('a.ts', 'new', 1));
    history.record(line('a.ts', 'new', 2));
    expect(history.back(line('a.ts', 'new', 3))).toEqual(line('a.ts', 'new', 2));
    expect(history.back()).toEqual(line('a.ts', 'new', 1));
    expect(history.forward()).toEqual(line('a.ts', 'new', 2));
    expect(history.forward()).toEqual(line('a.ts', 'new', 3));
    expect(history.entries()).toHaveLength(3);
  });

  test('records a place once when the jump starts where the list ends', () => {
    const history = new History();
    history.record(line('a.ts', 'new', 1));
    history.record({
      view: 'diff',
      at: { kind: 'line', at: { file: 'a.ts', side: 'new', line: 1, column: 4 } },
    });
    expect(history.entries()).toHaveLength(1);
  });

  test('goes back to what the view showed, as the diff’s comparison, and forward again', () => {
    const history = new History();
    const revealed: [Target, string | undefined][] = [];
    history.register('', 'diff', (at, within) => {
      revealed.push([at, within]);
      return true;
    });
    const left = { ...line('a.ts', 'new', 8), within: 'whole' };
    history.record(left);
    // The same line in another comparison is another place.
    const here = { ...line('a.ts', 'new', 8), within: 'base..r1' };
    expect(history.back(here)).toEqual(left);
    expect(history.forward()).toEqual(here);
    expect(revealed).toEqual([
      [left.at, 'whole'],
      [here.at, 'base..r1'],
    ]);
    // An entry without one is revealed without one.
    history.record(line('b.ts', 'new', 1));
    history.back();
    expect(revealed.at(-1)).toEqual([line('b.ts', 'new', 1).at, undefined]);
  });

  test('keeps the view that was beside a place, which isn’t part of the place', () => {
    const history = new History();
    viewer(history, '', 'diff');
    const left = { ...line('a.ts', 'new', 8), beside: 'timeline.view' };
    history.record(left);
    expect(history.entries()).toEqual([left]);
    // Back at the same line, with or without it, the tab is there already.
    expect(history.canBack(line('a.ts', 'new', 8))).toBe(false);
    expect(history.back(line('a.ts', 'new', 9))).toEqual(left);
  });

  test('keeps one history per tab', () => {
    const history = new History();
    const one = viewer(history, 'one', 'diff');
    const two = viewer(history, 'two', 'diff');
    history.tab('one');
    history.record(line('a.ts', 'new', 1));
    history.tab('two');
    history.record(line('b.ts', 'new', 2));
    expect(history.back(line('b.ts', 'new', 20))).toEqual(line('b.ts', 'new', 2));
    expect(history.back()).toBeUndefined();
    expect(one.shown).toEqual([]);
    history.tab('one');
    expect(history.back(line('a.ts', 'new', 10))).toEqual(line('a.ts', 'new', 1));
    expect(one.shown).toEqual([line('a.ts', 'new', 1).at]);
    expect(two.shown).toEqual([line('b.ts', 'new', 2).at]);
    // A closed tab's history goes with it.
    history.close('one');
    expect(history.entries()).toEqual([]);
  });

  test('keeps the last 100 places, as Vim does', () => {
    const history = new History();
    viewer(history, '', 'diff');
    for (let at = 1; at <= 150; at++) history.record(line('a.ts', 'new', at));
    expect(history.entries()).toHaveLength(HISTORY_LIMIT);
    expect(history.entries()[0]).toEqual(line('a.ts', 'new', 51));
    // Going back adds where the tab is, and the oldest place goes to make room.
    let last: Entry | undefined;
    for (let entry = history.back(line('a.ts', 'new', 151)); entry; entry = history.back())
      last = entry;
    expect(last).toEqual(line('a.ts', 'new', 52));
    expect(history.entries()).toHaveLength(HISTORY_LIMIT);
  });

  test('says whether Back and Forward have anywhere to go, without going, as back and forward find', () => {
    const history = new History();
    // Nowhere yet, from anywhere.
    expect(history.canBack()).toBe(false);
    expect(history.canBack(line('a.ts', 'new', 5))).toBe(false);
    expect(history.canForward()).toBe(false);
    // A place recorded, with no view to reveal it, is nowhere to go.
    history.record(line('a.ts', 'new', 1));
    expect(history.canBack(line('a.ts', 'new', 5))).toBe(false);
    const diff = viewer(history, '', 'diff');
    expect(history.canBack(line('a.ts', 'new', 5))).toBe(true);
    expect(diff.shown).toEqual([]);
    // Back from the very place it would go to goes nowhere, as `back` keeps it once.
    expect(history.canBack(line('a.ts', 'new', 1))).toBe(false);
    expect(history.back(line('a.ts', 'new', 1))).toBeUndefined();
    // Back once, and there's nowhere further back, and somewhere forward.
    history.record(line('a.ts', 'new', 2));
    expect(history.back(line('a.ts', 'new', 5))).toEqual(line('a.ts', 'new', 2));
    expect(history.back()).toEqual(line('a.ts', 'new', 1));
    expect(history.canBack()).toBe(false);
    expect(history.canForward()).toBe(true);
    expect(history.forward()).toEqual(line('a.ts', 'new', 2));
    expect(history.forward()).toEqual(line('a.ts', 'new', 5));
    expect(history.canForward()).toBe(false);
    expect(history.canBack()).toBe(true);
    // With the view gone, there's nowhere either way.
    diff.unregister();
    expect(history.canBack()).toBe(false);
    // Each tab asks of its own places.
    viewer(history, 'other', 'diff');
    history.tab('other');
    expect(history.canBack(line('b.ts', 'new', 1))).toBe(false);
  });

  test('tells who listens of each change to where Back and Forward could go', () => {
    const history = new History();
    let heard = 0;
    const stop = history.subscribe(() => {
      heard += 1;
    });
    const diff = viewer(history, '', 'diff');
    expect(heard).toBe(1);
    history.record(line('a.ts', 'new', 1));
    expect(heard).toBe(2);
    history.back(line('a.ts', 'new', 2));
    expect(heard).toBe(3);
    history.forward();
    expect(heard).toBe(4);
    // Nowhere to go changes nothing.
    history.forward();
    expect(heard).toBe(4);
    history.tab('other');
    history.tab('other');
    expect(heard).toBe(5);
    history.close('other');
    expect(heard).toBe(6);
    diff.unregister();
    expect(heard).toBe(7);
    stop();
    history.record(line('a.ts', 'new', 3));
    expect(heard).toBe(7);
  });

  test('drops the places a view says are gone, keeping the one the tab is at, and skips them', () => {
    const history = new History();
    const gone = new Set<string>();
    const shown: string[] = [];
    history.register(
      '',
      'diff',
      (at) => {
        shown.push(fileOf(at));
        return true;
      },
      (at) => !gone.has(fileOf(at)),
    );
    for (const file of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) history.record(line(file, 'new', 1));
    expect(history.back()).toEqual(line('d.ts', 'new', 1));
    expect(history.back()).toEqual(line('c.ts', 'new', 1));
    // A push removes b.ts and d.ts, and c.ts, where the tab is: Back and Forward skip what's gone.
    gone.add('b.ts');
    gone.add('d.ts');
    expect(history.canForward()).toBe(false);
    expect(history.canBack()).toBe(true);
    gone.add('c.ts');
    let heard = 0;
    history.subscribe(() => {
      heard += 1;
    });
    history.dropGone('');
    expect(heard).toBe(1);
    // Gone from the list but the place the tab is at, which the walk goes on from.
    expect(history.entries().map((entry) => fileOf(entry.at))).toEqual(['a.ts', 'c.ts']);
    expect(history.back()).toEqual(line('a.ts', 'new', 1));
    expect(shown).toEqual(['d.ts', 'c.ts', 'a.ts']);
    // Left, c.ts goes too; then there's nothing more to drop, which says nothing.
    history.dropGone('');
    expect(history.entries().map((entry) => fileOf(entry.at))).toEqual(['a.ts']);
    // Heard as it dropped them, as it went back, and as it dropped c.ts.
    expect(heard).toBe(3);
    history.dropGone('');
    expect(heard).toBe(3);
  });

  test('skips a place that’s where the tab is now, either way', () => {
    const history = new History();
    viewer(history, '', 'diff');
    history.record(line('a.ts', 'new', 1));
    history.record(line('b.ts', 'new', 1));
    // The cursor has gone back to a.ts by hand: Back from b.ts's end goes nowhere new.
    const here = line('a.ts', 'new', 1);
    expect(history.canBack(here)).toBe(true);
    expect(history.back(here)).toEqual(line('b.ts', 'new', 1));
    expect(history.canBack(here)).toBe(false);
    expect(history.back(here)).toBeUndefined();
    // Forward from b.ts goes to a.ts, kept as Back left it, unless the cursor is there already.
    expect(history.canForward()).toBe(true);
    expect(history.canForward(here)).toBe(false);
    expect(history.forward(here)).toBeUndefined();
    expect(history.forward()).toEqual(line('a.ts', 'new', 1));
  });
});
