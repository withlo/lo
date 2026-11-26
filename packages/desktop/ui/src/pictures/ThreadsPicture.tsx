// A picture of how a review thread shows in code: beside its lines, a bubble in the thread lane with
// the thread open over the code, which hasn't moved; or between them, the thread in the flow under
// its line, pushing the code after it down.

import type { ReactNode } from 'react';

import { Icon } from '../Icon.tsx';
import { CHANGE, MINI, MiniCode, PictureFrame, type MiniLine } from './MiniCode.tsx';

/** The ways a thread shows in code that a picture draws, by the setting's own names for them. */
export type PictureThreads = 'beside' | 'between';

/** The line the thread is on, from 0. */
const AT = 2;
/** The room between the thread's line and the thread, beside lines or between them. */
const GAP = 2;
/** The thread's popover: its left edge on the lane's, under its line. */
const POPOVER = {
  left: MINI.gutter,
  top: MINI.top + (AT + 1) * MINI.row + GAP,
  width: 132,
  height: 26,
} as const;
/** The thread between lines: how tall it is, and how far in from the code's edges. */
const CARD = { height: 20, inset: 6 } as const;

/** Inline's six lines, under one column of numbers, with the thread's bubble on the third. */
function lines(selected: boolean): MiniLine[] {
  return [CHANGE.before, ...CHANGE.removed, ...CHANGE.added].map((line, index) =>
    index === AT
      ? {
          ...line,
          mark: <Icon name="message-square" size={12} className="text-warning" />,
          selected,
        }
      : line,
  );
}

/** What a thread holds, as bars: its first comment's author, as a ball and a name, over its words. */
function Comment() {
  return (
    <span className="flex size-full flex-col justify-center gap-2" style={{ paddingInline: 6 }}>
      <span className="flex items-center gap-4">
        <span className="flex-none rounded-pill bg-fg-muted" style={{ width: 8, height: 8 }} />
        <span className="flex-none rounded-pill bg-fg" style={{ width: 28, height: 4 }} />
      </span>
      <span className="flex-none rounded-pill bg-fg-muted" style={{ width: 96, height: 4 }} />
    </span>
  );
}

/**
 * What `threads` looks like, in the window's theme. Beside lines, the thread's popover is open over
 * the lines under its own, its line's number and lane on the selected ground, and every line where
 * it was. Between lines, the thread is a card under its line, and the line after it starts under
 * the card, cut off by the frame: the thread moved the code.
 */
export function ThreadsPicture({ threads }: { threads: PictureThreads }): ReactNode {
  return (
    <PictureFrame>
      {threads === 'beside' ? (
        <>
          <MiniCode lines={lines(true)} lane />
          <span
            className="absolute rounded-sm border border-border bg-bg-overlay shadow-pop"
            style={POPOVER}
          >
            <Comment />
          </span>
        </>
      ) : (
        <MiniCode
          lines={lines(false)}
          lane
          between={{
            after: AT,
            children: (
              <span className="block" style={{ paddingBlock: GAP, paddingInline: CARD.inset }}>
                <span
                  className="block rounded-sm border border-border bg-bg-raised"
                  style={{ height: CARD.height }}
                >
                  <Comment />
                </span>
              </span>
            ),
          }}
        />
      )}
    </PictureFrame>
  );
}
