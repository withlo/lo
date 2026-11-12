// The clock the overview's quick diffs are timed by, and the frame they're spent in, for the
// window's tests: whether a small file's diff fits a frame's share is for the test to say, not for
// how fast the machine it runs on is. Time stands still, so a diff takes none of the share and
// never runs out of its budget, until a test says otherwise.

import { afterEach, beforeEach, vi } from 'vitest';

export interface QuickClock {
  /** From now on, each quick diff takes `ms` of its frame's share, as it's counted. */
  takes(ms: number): void;
  /** From now on, each quick diff runs out of its budget and settles for a coarser diff. */
  runsOut(): void;
  /** The frame ends, and its share is whole again. */
  endFrame(): void;
}

/**
 * Stands in for the clock and the frames, in each test of the file that calls it. `performance`
 * counts the share, and `Date` is what the diff holds itself to its budget by.
 */
export function quickClock(): QuickClock {
  let step = 0;
  let late = 0;
  let time = 0;
  let date = 0;
  let frames: FrameRequestCallback[] = [];
  let spies: { mockRestore(): void }[] = [];

  const endFrame = () => {
    const ended = frames;
    frames = [];
    for (const frame of ended) frame(time);
  };

  beforeEach(() => {
    step = 0;
    late = 0;
    time = 0;
    date = Date.now();
    frames = [];
    // A diff is timed from one read of the clock to the next, so each read moves it on by what a
    // diff takes.
    spies = [
      vi.spyOn(performance, 'now').mockImplementation(() => (time += step)),
      vi.spyOn(Date, 'now').mockImplementation(() => (date += late)),
    ];
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
  });

  afterEach(() => {
    // The share is spent for the frame it's in, so a test leaves none of it spent for the next.
    endFrame();
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllGlobals();
  });

  return {
    takes(ms) {
      step = ms;
    },
    runsOut() {
      // Past any budget a quick diff is given.
      late = 1000;
    },
    endFrame,
  };
}
