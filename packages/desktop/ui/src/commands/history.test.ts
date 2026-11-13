import { describe, expect, test } from 'vitest';

import { HISTORY_LIMIT, History, type Entry, type View } from './history.ts';
import type { Side, Target } from './targets.ts';

function line(file: string, side: Side, at: number): Entry {
  return { view: 'diff', at: { kind: 'line', at: { file, side, line: at } } };
}

function block(id: string): Entry {
  return { view: 'overview', at: { kind: 'block', block: id } };
}

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
});
