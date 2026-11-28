// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { afterEach, describe, expect, test } from 'vitest';

import {
  type Cell,
  cellOf,
  type LaneRange,
  lightOf,
  lineBeside,
  nearestStem,
  type Row,
  type Slotted,
  slotLeft,
  slotted,
} from './ranges.ts';

class Block extends WidgetType {
  toDOM(): HTMLElement {
    return document.createElement('div');
  }
}

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

test('a block on an empty line is before or after it as it’s drawn, as on a line with text', () => {
  const doc = 'one\n\nthree';
  const blank = 4;
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: EditorView.decorations.of(
        Decoration.set(
          [
            Decoration.widget({ widget: new Block(), block: true, side: -1 }).range(blank),
            Decoration.widget({ widget: new Block(), block: true, side: 1 }).range(blank),
            Decoration.widget({ widget: new Block(), block: true, side: 1 }).range(3),
            Decoration.widget({ widget: new Block(), block: true, side: -1 }).range(5),
          ],
          true,
        ),
      ),
    }),
  });
  // The blocks drawn beside line `line`, as the gutters are given them.
  const blocks = (line: number) => {
    const { from, to } = view!.state.doc.line(line);
    return view!.viewportLineBlocks
      .flatMap((block) => (Array.isArray(block.type) ? block.type : [block]))
      .filter((block) => block.widget && block.from >= from && block.to <= to);
  };
  expect(blocks(2).map((block) => lineBeside(view!, block))).toEqual([
    { line: 2, after: false },
    { line: 2, after: true },
  ]);
  expect(blocks(1).map((block) => lineBeside(view!, block))).toEqual([{ line: 1, after: true }]);
  expect(blocks(3).map((block) => lineBeside(view!, block))).toEqual([{ line: 3, after: false }]);
});

/** A range on lines `from` to `to`, its own first and last lines, amber. */
function range(key: string, from: number, to: number, more: Partial<LaneRange> = {}): LaneRange {
  return { key, from, to, tick: true, foot: true, tone: 'warn', ...more };
}

/** What a cell draws, in words: each stem's slot and ends, `lit` where it's lit, then the tick. */
function drawn({ stems, tick }: Cell): string[] {
  return [
    ...stems.map(
      (stem) => `${stem.key} s${stem.slot} ${stem.from}-${stem.to}${stem.lit ? ' lit' : ''}`,
    ),
    ...(tick
      ? [`tick s${tick.slot} ${tick.tone}${tick.lit ? ' lit' : ''}${tick.under ? ' under' : ''}`]
      : []),
  ];
}

/** What a lane draws beside each of `lines`, `marks` the lines that hold a mark. */
function lane(
  ranges: readonly Slotted[],
  lines: readonly number[],
  marks: readonly number[],
  lit: readonly string[] = [],
): Record<number, string[]> {
  const rows: Record<number, string[]> = {};
  for (const line of lines) {
    const row: Row = { first: line, last: line };
    const at = { marked: marks.includes(line), above: marks.includes(line - 1) };
    rows[line] = drawn(cellOf(ranges, row, at, new Set(lit)));
  }
  return rows;
}

describe('slots', () => {
  test('ranges take the first slot free over their lines, by first line, then longest, then oldest', () => {
    const placed = slotted([range('c', 38, 39), range('b', 37, 45), range('a', 35, 40)]);
    expect(placed.map(({ key, slot }) => `${key} ${slot}`)).toEqual(['a 0', 'b 1', 'c 2']);
    // One that starts past another's end takes its slot again.
    const after = slotted([range('a', 2, 4), range('b', 3, 9), range('c', 5, 6)]);
    expect(after.map(({ key, slot }) => `${key} ${slot}`)).toEqual(['a 0', 'b 1', 'c 0']);
    const same = slotted([range('short', 4, 5), range('long', 4, 9), range('old', 4, 9)]);
    expect(same.map(({ key, slot }) => `${key} ${slot}`)).toEqual(['long 0', 'old 1', 'short 2']);
  });

  test('a fourth range over the same lines, and any deeper, shares the last slot', () => {
    const placed = slotted([
      range('a', 1, 9),
      range('b', 2, 9),
      range('c', 3, 9),
      range('d', 4, 9),
      range('e', 5, 9),
    ]);
    expect(placed.map(({ slot }) => slot)).toEqual([0, 1, 2, 2, 2]);
  });

  test('a range on one line has no stem, and takes no slot', () => {
    const placed = slotted([range('one', 4, 4), range('two', 3, 6)]);
    expect(placed.map(({ key, slot }) => `${key} ${slot}`)).toEqual(['two 0']);
  });

  test('the slots are 4 px apart, from 2 px in the threads’ lane and 1 px in the overview’s', () => {
    expect([0, 1, 2].map((slot) => slotLeft('threads', slot))).toEqual([2, 6, 10]);
    expect([0, 1, 2].map((slot) => slotLeft('notes', slot))).toEqual([1, 5, 9]);
  });
});

describe('stems', () => {
  test('three ranges nest as the rule’s drawing: A on 35 to 40, B on 37 to 45, C on 38 and 39', () => {
    const placed = slotted([range('a', 35, 40), range('b', 37, 45), range('c', 38, 39)]);
    expect(lane(placed, [35, 36, 37, 38, 39, 40, 41, 45], [39, 40, 45])).toEqual({
      35: ['a s0 mid-edge', 'tick s0 warn'],
      36: ['a s0 edge-edge'],
      37: ['a s0 edge-edge', 'b s1 mid-edge', 'tick s1 warn'],
      38: ['a s0 edge-edge', 'b s1 edge-edge', 'c s2 mid-edge', 'tick s2 warn'],
      // C's mark: A's and B's stems skip its row, and go on under it.
      39: ['a s0 under-edge', 'b s1 under-edge', 'c s2 edge-mark'],
      // A's mark, right under C's: A's is its mark alone. B's stem skips the row.
      40: ['b s1 under-edge'],
      // B alone, still in slot 1.
      41: ['b s1 edge-edge'],
      45: ['b s1 edge-mark'],
    });
  });

  test('ticks on one line draw once, at the outermost’s width, in the lit one’s colour', () => {
    const placed = slotted([range('long', 4, 9, { tone: 'quiet' }), range('short', 4, 6)]);
    expect(lane(placed, [4], [])[4]).toEqual([
      'long s0 mid-edge',
      'short s1 mid-edge',
      'tick s0 quiet',
    ]);
    expect(lane(placed, [4], [], ['short'])[4]).toEqual([
      'long s0 mid-edge',
      'short s1 mid-edge lit',
      'tick s0 warn lit',
    ]);
  });

  test('a range that starts on the line another ends on starts under its mark', () => {
    const placed = slotted([range('first', 2, 5), range('next', 5, 8)]);
    expect(lane(placed, [5, 6, 8], [5, 8])).toEqual({
      5: ['first s0 edge-mark', 'next s1 under-edge', 'tick s1 warn under'],
      // Its stem goes on from its tick, under the other's mark.
      6: ['next s1 edge-edge'],
      8: ['next s1 edge-mark'],
    });
  });

  test('a range that runs on from or into the other side’s lines has no tick, or no foot, here', () => {
    const into = slotted([range('across', 4, 6, { foot: false })]);
    expect(lane(into, [4, 6], [])).toEqual({
      4: ['across s0 mid-edge', 'tick s0 warn'],
      6: ['across s0 edge-edge'],
    });
    const from = slotted([range('across', 4, 6, { tick: false })]);
    expect(lane(from, [4, 6], [6])).toEqual({
      4: ['across s0 edge-edge'],
      6: ['across s0 edge-mark'],
    });
  });

  test('a fold carries the stems past it, and starts and ends those whose lines it holds', () => {
    const placed = slotted([range('in', 12, 20), range('out', 7, 12), range('past', 5, 30)]);
    const fold: Row = { first: 9, last: 17 };
    const marked = { marked: true, above: false };
    expect(drawn(cellOf(placed, fold, marked, new Set()))).toEqual([
      'past s0 under-edge',
      'out s1 edge-mark',
      'in s2 under-edge',
      'tick s2 warn under',
    ]);
    // Lines a fold holds alone are its mark alone.
    const inside = slotted([range('inside', 10, 12)]);
    expect(drawn(cellOf(inside, fold, marked, new Set()))).toEqual([]);
  });

  test('a block between lines carries the stems that pass it', () => {
    const placed = slotted([range('one', 4, 6)]);
    const between = { marked: false, above: false };
    expect(drawn(cellOf(placed, { first: 4.5, last: 4.5 }, between, new Set()))).toEqual([
      'one s0 edge-edge',
    ]);
    expect(drawn(cellOf(placed, { first: 6.5, last: 6.5 }, between, new Set()))).toEqual([]);
  });

  test('the pointer across a cell means the nearest stem, the cell split halfway between two', () => {
    const stems = [
      { key: 'a', slot: 0 },
      { key: 'b', slot: 1 },
    ];
    // Stems' middles at 3 and 7 px in the threads' lane.
    expect(nearestStem(stems, 0, 'threads')).toBe('a');
    expect(nearestStem(stems, 4.9, 'threads')).toBe('a');
    expect(nearestStem(stems, 5.1, 'threads')).toBe('b');
    expect(nearestStem(stems, 16, 'threads')).toBe('b');
    expect(nearestStem([{ key: 'a', slot: 0 }], 15, 'notes')).toBe('a');
    expect(nearestStem([], 3, 'threads')).toBeUndefined();
  });
});

describe('what’s lit', () => {
  const a = { lane: 'threads', key: 'a' } as const;
  const b = { lane: 'threads', key: 'b' } as const;
  const note = { lane: 'notes', key: 'n' } as const;

  test('one range at a time: the pinned, else where a key landed, else the pointer’s', () => {
    expect(lightOf({}).range).toBeUndefined();
    expect(lightOf({ pointed: a }).range).toBe(a);
    expect(lightOf({ keyed: b, pointed: a }).range).toBe(b);
    expect(lightOf({ pinned: { cards: [note] }, keyed: b, pointed: a }).range).toBe(note);
  });

  test('the pointer on another range while one is pinned brings its stem to its lit colour alone', () => {
    const lit = lightOf({ pinned: { cards: [a] }, pointed: b });
    expect(lit.range).toBe(a);
    expect([...lit.stems.threads]).toEqual(['a', 'b']);
  });

  test('of a pinned popover’s cards, the pointer’s, else the keyboard’s, else the first', () => {
    const cards = { cards: [a, b] };
    expect(lightOf({ pinned: cards }).range).toBe(a);
    expect(lightOf({ pinned: cards, focused: b }).range).toBe(b);
    expect(lightOf({ pinned: cards, focused: b, pointed: a }).range).toBe(a);
    expect(lightOf({ pinned: cards, focused: b, pointed: note }).range).toBe(b);
  });

  test('a comment box open on lines counts as pinned, and its lines are picked', () => {
    expect(lightOf({ pinned: { picked: a }, pointed: b })).toMatchObject({
      range: a,
      picked: true,
    });
    expect(lightOf({ pinned: { picked: undefined }, keyed: b })).toMatchObject({
      range: undefined,
      picked: true,
    });
  });

  test('a note’s stem is lit in the overview’s lane, a thread’s in the threads’', () => {
    const lit = lightOf({ keyed: note, pointed: a });
    expect([...lit.stems.notes]).toEqual(['n']);
    expect([...lit.stems.threads]).toEqual(['a']);
  });
});
