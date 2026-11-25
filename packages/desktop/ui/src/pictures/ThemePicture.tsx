// A picture of a theme: a small Lo window in it, pinned to that theme whatever the window's is, or
// for System, the light one and the dark one side by side.

import type { ReactNode } from 'react';

import { CHANGE, MiniCode, PictureFrame } from './MiniCode.tsx';

/** The themes a picture shows: each of Lo's, or the computer's, which is either. */
export type PictureTheme = 'dark' | 'light' | 'system';

/** How tall the window's strip is. */
const STRIP = 12;

/**
 * A small Lo window in `theme`: a strip of chrome with its title and its main button, over a few
 * lines of a change. `data-theme` pins it, so its tokens are that theme's.
 */
function Window({ theme, clip }: { theme: 'dark' | 'light'; clip?: string }) {
  return (
    <span
      data-theme={theme}
      className="absolute inset-0 flex flex-col bg-bg"
      style={clip === undefined ? undefined : { clipPath: clip }}
    >
      <span className="relative flex-none bg-bg-chrome" style={{ height: STRIP }}>
        <span
          className="absolute rounded-pill bg-fg"
          style={{ left: 8, top: 4, width: 40, height: 4 }}
        />
        <span
          className="absolute rounded-pill bg-accent"
          style={{ right: 8, top: 3, width: 22, height: 6 }}
        />
      </span>
      <MiniCode
        lines={[
          CHANGE.before,
          CHANGE.removed[0],
          CHANGE.added[0],
          CHANGE.added[1],
          CHANGE.after[0],
        ]}
      />
    </span>
  );
}

/**
 * What `theme` looks like. The frame's hairline is the window's, outside the theme it shows, so a
 * dark picture reads as a dark tile in a light card and the other way round. System is the two
 * windows in one frame, the light one's left half beside the dark one's right half, with no seam.
 */
export function ThemePicture({ theme }: { theme: PictureTheme }): ReactNode {
  return (
    <PictureFrame>
      {theme === 'system' ? (
        <>
          <Window theme="light" clip="inset(0 50% 0 0)" />
          <Window theme="dark" clip="inset(0 0 0 50%)" />
        </>
      ) : (
        <Window theme={theme} />
      )}
    </PictureFrame>
  );
}
