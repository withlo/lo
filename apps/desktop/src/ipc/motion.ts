// How main turns every move off in the window from its first frame: a switch on the window's
// command line, which its preload reads and turns into the motion switch on `<html>` before the
// page's own code runs.

/**
 * The switch main adds to the window's command line when a test asks for every move off, with
 * `LO_MOTION=reduce`, which only a build run from source takes.
 */
export const REDUCE_MOTION = '--lo-motion=reduce';
