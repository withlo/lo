// Code as bars, for a picture of what a choice does: each line a row 10 px high, its number a bar in
// the gutter and its code one bar, on the diff's own grounds, with a thread lane between the two
// where the picture is of threads. Sizes in a picture are its own, in px.

import type { CSSProperties, ReactNode } from 'react';

/** What a line is: a line both sides have, one taken out, one put in, or the room a side leaves. */
export type MiniKind = 'context' | 'removed' | 'added' | 'filler';

/** One line of code drawn as bars. */
export interface MiniLine {
  readonly kind: MiniKind;
  /** How much of the code's width its bar takes, from 0 to 1. A filler row has none. */
  readonly length?: number;
  /** How far its bar starts in from the others', in px. */
  readonly indent?: number;
  /** What its thread lane holds, such as a thread's bubble: a mark up to 12 px square. */
  readonly mark?: ReactNode;
  /** Its number and lane cells are an open thread's, on the selected ground. */
  readonly selected?: boolean;
}

/** What a picture's code draws in the flow, between two lines, as a thread between lines is. */
export interface MiniBetween {
  /** The line it's under, from 0. */
  readonly after: number;
  /** What's drawn, beside the gutter and the lane: as tall as it is. */
  readonly children: ReactNode;
}

/**
 * Where a picture's code puts things, for what a picture draws over it: how tall a row is, how wide
 * a column of line numbers and a thread lane are, and how far down the first row starts.
 */
export const MINI = { row: 10, gutter: 16, lane: 12, top: 2 } as const;

const ROW = MINI.row;
const GUTTER = MINI.gutter;
const LANE = MINI.lane;
/** How far a mark in a thread lane reaches past its row, above and below. */
const MARK_OVER = 1;
/** How far a line's bar starts in from its gutter. */
const INSET = 6;
/** How tall a bar is, and how far down its row it starts. */
const BAR = 4;
const BAR_TOP = (ROW - BAR) / 2;
/** How wide a line number's bar is, and how far from its column's end. */
const NUMBER = 6;
const NUMBER_END = 4;
const TOP = MINI.top;

const GROUND: Readonly<Record<MiniKind, string>> = {
  context: 'bg-bg',
  removed: 'bg-diff-del-bg',
  added: 'bg-diff-add-bg',
  filler: 'bg-diff-filler',
};

const bar = (style: CSSProperties) => (
  <span
    className="absolute rounded-pill bg-fg-subtle"
    style={{ top: BAR_TOP, height: BAR, ...style }}
  />
);

/** Where a lane's cell, or a number's, is an open thread's: the selected ground. */
const cellGround = (selected: boolean | undefined) => (selected === true ? 'bg-selected' : 'bg-bg');

/** A column of line numbers: a bar for a line its side has, nothing for one it doesn't. */
function LineNumber({ shown, selected }: { shown: boolean; selected?: boolean | undefined }) {
  return (
    <span className={`relative flex-none ${cellGround(selected)}`} style={{ width: GUTTER }}>
      {shown && (
        <span
          className="absolute rounded-pill bg-code-gutter"
          style={{ top: BAR_TOP, height: BAR, width: NUMBER, right: NUMBER_END }}
        />
      )}
    </span>
  );
}

/**
 * A thread lane's cell: empty, or holding a line's mark, centred on its row and over the rows
 * beside it, which it may reach past.
 */
function Lane({ mark, selected }: { mark?: ReactNode; selected?: boolean | undefined }) {
  return (
    <span className={`relative flex-none ${cellGround(selected)}`} style={{ width: LANE }}>
      {mark !== undefined && (
        <span
          className="absolute inset-x-0 flex items-center justify-center"
          style={{ top: -MARK_OVER, bottom: -MARK_OVER, zIndex: 1 }}
        >
          {mark}
        </span>
      )}
    </span>
  );
}

/**
 * The lines of a change as bars, from 2 px down the box it fills, cut off where the box ends. With
 * `numbers` of `2`, as an inline diff draws them, it has a column of the old side's numbers and one
 * of the new side's: a removed line has only the old, an added one only the new. With `lane`, a
 * thread lane 12 px wide sits between the numbers and the code, holding each line's `mark`, and
 * `between` is drawn in the flow under its line, moving the lines after it down, as a thread between
 * lines does.
 */
export function MiniCode({
  lines,
  numbers = 1,
  lane = false,
  between,
}: {
  lines: readonly MiniLine[];
  numbers?: 1 | 2;
  lane?: boolean;
  between?: MiniBetween | undefined;
}): ReactNode {
  return (
    <span
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg"
      style={{ paddingTop: TOP }}
    >
      {lines.flatMap((line, index) => {
        const filler = line.kind === 'filler';
        const row = (
          <span
            key={index}
            className={`flex flex-none ${filler ? GROUND.filler : ''}`}
            style={{ height: ROW }}
          >
            {!filler &&
              (numbers === 2 ? (
                <>
                  <LineNumber shown={line.kind !== 'added'} selected={line.selected} />
                  <LineNumber shown={line.kind !== 'removed'} selected={line.selected} />
                </>
              ) : (
                <LineNumber shown selected={line.selected} />
              ))}
            {!filler && lane && <Lane mark={line.mark} selected={line.selected} />}
            {filler ? (
              <span className="flex-1" />
            ) : (
              <span className={`relative min-w-0 flex-1 ${GROUND[line.kind]}`}>
                {bar({
                  left: INSET + (line.indent ?? 0),
                  width: `${(line.length ?? 0) * 100}%`,
                })}
              </span>
            )}
          </span>
        );
        if (between?.after !== index) return [row];
        return [
          row,
          // Its numbers and lane go on beside it, empty, as a code view's gutter does beside a
          // block between its lines.
          <span key="between" className="flex flex-none">
            {Array.from({ length: numbers }, (_, column) => (
              <LineNumber key={column} shown={false} />
            ))}
            {lane && <Lane />}
            <span className="min-w-0 flex-1 bg-bg">{between.children}</span>
          </span>,
        ];
      })}
    </span>
  );
}

/**
 * The change every picture draws: a line both sides have, two taken out and three put in, a step
 * further in, then two more both sides have.
 */
export const CHANGE = {
  before: { kind: 'context', length: 0.5 },
  removed: [
    { kind: 'removed', indent: 8, length: 0.35 },
    { kind: 'removed', indent: 8, length: 0.6 },
  ],
  added: [
    { kind: 'added', indent: 8, length: 0.45 },
    { kind: 'added', indent: 8, length: 0.7 },
    { kind: 'added', indent: 8, length: 0.3 },
  ],
  after: [
    { kind: 'context', length: 0.15 },
    { kind: 'context', length: 0.4 },
  ],
} as const satisfies {
  before: MiniLine;
  removed: readonly MiniLine[];
  added: readonly MiniLine[];
  after: readonly MiniLine[];
};

/**
 * A picture's frame: as big as the box it's in, round at its corners, with a quiet hairline, and
 * nothing in it reaching out or answering the pointer. A screen reader skips it: the card's title
 * says what it shows.
 */
export function PictureFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none relative flex size-full overflow-hidden rounded-sm border border-border-subtle bg-bg select-none"
    >
      {children}
    </span>
  );
}
