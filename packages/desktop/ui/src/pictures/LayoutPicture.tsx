// A picture of a diff's layout: the same change with its two sides next to each other, or in one
// column with both sides' line numbers.

import type { ReactNode } from 'react';

import { CHANGE, MiniCode, PictureFrame, type MiniLine } from './MiniCode.tsx';

/** The layouts a picture shows, by the diff's own names for them. */
export type PictureLayout = 'split' | 'inline';

/** The old side: the room the third line put in takes on it is the diff's own filler. */
const OLD: readonly MiniLine[] = [
  CHANGE.before,
  ...CHANGE.removed,
  { kind: 'filler' },
  ...CHANGE.after,
];

const NEW: readonly MiniLine[] = [CHANGE.before, ...CHANGE.added, ...CHANGE.after];

const INLINE: readonly MiniLine[] = [CHANGE.before, ...CHANGE.removed, ...CHANGE.added];

/** What `layout` looks like, in the window's theme. */
export function LayoutPicture({ layout }: { layout: PictureLayout }): ReactNode {
  return (
    <PictureFrame>
      {layout === 'split' ? (
        <>
          <MiniCode lines={OLD} />
          <span className="flex-none bg-border" style={{ width: 1 }} />
          <MiniCode lines={NEW} />
        </>
      ) : (
        <MiniCode lines={INLINE} numbers={2} />
      )}
    </PictureFrame>
  );
}
