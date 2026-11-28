// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, expect, test } from 'vitest';

import {
  ballTip,
  markerGutter,
  type NoteEnds,
  notesLaneUpdate,
  notesName,
  setNotesLane,
} from './markers.ts';
import type { LaneRange } from './ranges.ts';

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

/** An editor of three lines with the overview's lane, which says what each press asked. */
function lane(ranges: readonly LaneRange[], ends: ReadonlyMap<number, NoteEnds>): string[] {
  const asked: string[] = [];
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: 'one\ntwo\nthree',
      extensions: markerGutter({
        clicked: (first, last) => asked.push(`ball ${first}–${last}`),
        stem: (key) => asked.push(`stem ${key}`),
      }),
    }),
  });
  const { doc } = view.state;
  const span = { from: 0, to: doc.length };
  view.dispatch({
    effects: setNotesLane.of([notesLaneUpdate(doc, span, ranges, ends, new Set())]),
  });
  return asked;
}

/** A press with the main button on `element`, as the pointer's. */
function press(element: Element): void {
  element.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }),
  );
}

test('a press anywhere in a ball’s cell opens every note ending there, as the ball does', () => {
  const asked = lane(
    [],
    new Map([[1, { keys: ['one', 'two'], open: false, words: 'line 1', between: false }]]),
  );
  const cell = view!.dom.querySelector('.lo-ovcolumn .lo-lanemark')!;
  // Beside the ball, in its cell.
  press(cell);
  press(cell.querySelector('.lo-ov-marker')!);
  expect(asked).toEqual(['ball 1–1', 'ball 1–1']);
});

test('a press on a stem, off any ball, opens its note', () => {
  const range: LaneRange = { key: 'up', from: 1, to: 3, tick: true, foot: true, tone: 'note' };
  const asked = lane(
    [range],
    new Map([[3, { keys: ['up'], open: false, words: 'lines 1–3', between: false }]]),
  );
  const cells = view!.dom.querySelectorAll('.lo-ovcolumn .lo-lanemark');
  press(cells[1]!.querySelector('.lo-stem')!);
  expect(asked).toEqual(['stem up']);
});

test('a ball is heard by its notes and their lines, and between lines says what a press does', () => {
  expect(notesName(1, 'lines 2–15')).toBe('Overview note, lines 2–15');
  expect(notesName(2, 'lines 2–15')).toBe('2 overview notes, lines 2–15');
  expect(notesName(1, '')).toBe('Overview note');
  expect(ballTip(1, false)).toBe('Show overview note');
  expect(ballTip(1, true)).toBe('Close overview note');
  expect(ballTip(2, false)).toBe('Show 2 overview notes');
  expect(ballTip(2, true)).toBe('Close 2 overview notes');
  lane([], new Map([[1, { keys: ['one'], open: true, words: 'line 1', between: true }]]));
  const ball = view!.dom.querySelector<HTMLElement>('.lo-ov-marker')!;
  expect(ball.getAttribute('role')).toBe('button');
  expect(ball.getAttribute('aria-label')).toBe('Overview note, line 1');
  expect(ball.getAttribute('aria-expanded')).toBe('true');
  expect(ball.dataset.tip).toBe('Close overview note');
});
