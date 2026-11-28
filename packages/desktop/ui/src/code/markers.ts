// Overview notes' marks, in a lane of their own, last before the code on the side an overview
// marks, drawn as every range is (`ranges.ts`): a ball on the first row of each note's last line,
// ringed brighter while its note is open, and a stem up the lane to a tick on its first. Notes that
// end on one line share its ball, which opens them together. The lane is there from the start, as
// wide with no marks as with them, so marks that arrive later change no line's width or height,
// and nothing on screen moves. Unchanged lines collapsed into one block carry the stems that pass
// or start in them, and the ball of a note that ends among them.

import type { Extension, Text } from '@codemirror/state';
import { type EditorView, gutter } from '@codemirror/view';

import {
  defineLane,
  type LaneMark,
  type LaneRange,
  type LaneUpdate,
  laneUpdate,
  rangeUnder,
} from './ranges.ts';

/**
 * What a ball's notes are called, and the popover they open in, as a screen reader hears them:
 * "Overview note, lines 2–15", or for several, which end on one line, "2 overview notes, lines
 * 2–15", by the lines of the one that starts first, which take in the others'. `words` are those
 * lines, as `lineRefText` puts them after other words.
 */
export function notesName(count: number, words: string): string {
  const what = count === 1 ? 'Overview note' : `${count} overview notes`;
  return words === '' ? what : `${what}, ${words}`;
}

/** What a click on a ball does between lines, as its tooltip says: show its notes, or close them. */
export function ballTip(count: number, open: boolean): string {
  const verb = open ? 'Close' : 'Show';
  return count === 1 ? `${verb} overview note` : `${verb} ${count} overview notes`;
}

/**
 * The notes that end on a line, by their keys in the overview's order, whether one is open, the
 * words for the lines of the one that starts first, which take in the others', and whether threads
 * show between lines: there the ball's tooltip says what a click does, and beside lines it has
 * none, as a bubble has none there, since the pointer resting on it previews its notes.
 */
export interface NoteEnds {
  readonly keys: readonly string[];
  readonly open: boolean;
  readonly words: string;
  readonly between: boolean;
}

/** A ball as the lane's mark: a control a screen reader hears by its notes' name. */
class BallMark implements LaneMark {
  readonly keys: readonly string[];
  readonly open: boolean;
  readonly words: string;
  readonly between: boolean;

  constructor({ keys, open, words, between }: NoteEnds) {
    this.keys = keys;
    this.open = open;
    this.words = words;
    this.between = between;
  }

  same(other: LaneMark): boolean {
    return (
      other instanceof BallMark &&
      other.open === this.open &&
      other.words === this.words &&
      other.between === this.between &&
      other.keys.length === this.keys.length &&
      other.keys.every((key, index) => key === this.keys[index])
    );
  }

  draw(): HTMLElement {
    const ball = document.createElement('span');
    ball.className = `lo-ov-marker${this.open ? ' is-open' : ''}`;
    ball.setAttribute('role', 'button');
    ball.setAttribute('aria-label', notesName(this.keys.length, this.words));
    ball.setAttribute('aria-expanded', String(this.open));
    if (this.between) ball.dataset.tip = ballTip(this.keys.length, this.open);
    return ball;
  }
}

/**
 * The overview's lane in each editor's state. A fold holds the ball of every note ending in it,
 * named by the first's lines, as many notes as they are.
 */
const lane = defineLane('notes', {
  foldMark: (marks) => {
    const balls = marks.filter((mark) => mark instanceof BallMark);
    return new BallMark({
      keys: balls.flatMap((mark) => mark.keys),
      open: balls.some((mark) => mark.open),
      words: balls[0]?.words ?? '',
      between: balls[0]?.between ?? false,
    });
  },
  markTarget: true,
});

/** The lane draws, in each part of the text, what each update says, as for a file's notes. */
export const setNotesLane = lane.set;

/**
 * The lane's cells for the part of `doc` from `from` to `to`, by document line: a ball on each line
 * of `ends`, and the stems of `ranges` beside each line they cover, those `lit` names lit.
 */
export function notesLaneUpdate(
  doc: Text,
  span: { readonly from: number; readonly to: number },
  ranges: readonly LaneRange[],
  ends: ReadonlyMap<number, NoteEnds>,
  lit: ReadonlySet<string>,
): LaneUpdate {
  const marks = new Map<number, LaneMark>();
  for (const [line, end] of ends) marks.set(line, new BallMark(end));
  return laneUpdate(doc, 'notes', span, ranges, marks, {
    lit,
    target: () => true,
    markTarget: true,
  });
}

/** What the overview's lane asks of its code view. */
export interface NotesSource {
  /** A press on the ball beside document lines `first` to `last`: the notes ending there open. */
  clicked(first: number, last: number): void;
  /** A press on the stem of the note `key`: it opens, or closes. */
  stem(key: string): void;
}

/** The document lines a line block covers, first to last. */
function linesOf(view: EditorView, from: number, to: number): { first: number; last: number } {
  const { doc } = view.state;
  return { first: doc.lineAt(from).number, last: doc.lineAt(to).number };
}

/** Whether `event` is on a marker's ball. */
function onBall(event: Event): boolean {
  return event.target instanceof Element && event.target.closest('.lo-ov-marker') !== null;
}

/**
 * The overview's lane, drawn from what the editor's state keeps of it (`setNotesLane`). A ball, or a
 * stem, acts as it's pressed, in the press's own frame, so what its note moves comes with the
 * reader's input, never in a frame after it; a click then does nothing more. A click on a ball with
 * no press before it, as a screen reader's, acts the same. Focus stays where it is, and no text is
 * selected.
 */
export function markerGutter(source: NotesSource): Extension {
  return [
    lane.field,
    gutter({
      class: 'lo-ovcolumn',
      markers: lane.cells,
      widgetMarker: lane.widgetMarker,
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setNotesLane)),
        ),
      domEventHandlers: {
        mousedown: (view, line, event) => {
          if (!(event instanceof MouseEvent)) return false;
          if (onBall(event)) {
            event.preventDefault();
            if (event.button === 0) {
              const { first, last } = linesOf(view, line.from, line.to);
              source.clicked(first, last);
            }
            return true;
          }
          const under = rangeUnder(event);
          if (under?.kind !== 'notes') return false;
          event.preventDefault();
          if (event.button === 0) source.stem(under.key);
          return true;
        },
        click: (view, line, event) => {
          if (!onBall(event)) return false;
          if (event instanceof MouseEvent && event.detail === 0) {
            const { first, last } = linesOf(view, line.from, line.to);
            source.clicked(first, last);
          }
          return true;
        },
      },
    }),
  ];
}
