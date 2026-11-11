// When the pull request opened and was shown, for the bench, which reads `window.perfMarks`: the
// times main sends, the page's own, and the long tasks and frames on the page's main thread until
// everything has arrived. Times are milliseconds since the epoch, on the clock main reads too, so
// the two processes' times can be compared. The page imports this first, so its observers start
// before the rest of the page runs.

/** A large file's load, as `Marks.loads` times it. */
export interface Load {
  asked: number;
  lines?: number;
  linesDrawn?: number;
  diff?: number;
  diffDrawn?: number;
}

/** A frame that took over 50 ms, with the scripts that took the longest in it. */
export interface LongFrame {
  start: number;
  duration: number;
  /** How long it kept input waiting: its time past 50 ms. */
  blocking: number;
  scripts: { invoker: string; source: string; duration: number }[];
}

export interface Marks {
  /** When main started opening the pull request, and when it had read every file. */
  opened?: number;
  read?: number;
  /** When the page started running, and when, its code loaded, it started opening the pull request. */
  started: number;
  asked?: number;
  /** When the view was made, with every file's lines and nothing else. */
  view?: number;
  /** The file at the top: the pull request's first with lines to show. */
  first?: number;
  /** When its diff and highlighting arrived, and when the next frame after the one that drew it began. */
  firstArrived?: number;
  firstDrawn?: number;
  /** When the last diff and the moves had arrived. */
  loaded?: number;
  /**
   * Each large file loaded, by its index: when `za` asked for it, when its lines and its diff
   * arrived, and when the frame after each was drawn began.
   */
  loads: Record<number, Load>;
  /** Tasks over 50 ms on the page's main thread until then, and the frames over 50 ms. */
  longTasks: { start: number; duration: number }[];
  longFrames: LongFrame[];
}

/** Now, in milliseconds since the epoch. */
export function now(): number {
  return performance.timeOrigin + performance.now();
}

export const marks: Marks = { started: now(), longTasks: [], longFrames: [], loads: {} };
Object.assign(window, { perfMarks: marks });

const tasks = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    marks.longTasks.push({
      start: performance.timeOrigin + entry.startTime,
      duration: entry.duration,
    });
  }
});
const frames = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) marks.longFrames.push(longFrame(entry));
});
const observed = PerformanceObserver.supportedEntryTypes;
if (observed.includes('longtask')) tasks.observe({ type: 'longtask', buffered: true });
if (observed.includes('long-animation-frame')) {
  frames.observe({ type: 'long-animation-frame', buffered: true });
}

/** Marks everything as arrived, and stops watching for long tasks. */
export function markLoaded(): void {
  marks.loaded = now();
  // What's queued for the observers is theirs too.
  for (const entry of tasks.takeRecords()) {
    marks.longTasks.push({
      start: performance.timeOrigin + entry.startTime,
      duration: entry.duration,
    });
  }
  for (const entry of frames.takeRecords()) marks.longFrames.push(longFrame(entry));
  tasks.disconnect();
  frames.disconnect();
}

/** Marks the first file as arrived, and as drawn once the frame after the one that drew it starts. */
export function markFirst(): void {
  marks.firstArrived = now();
  afterDrawn((time) => {
    marks.firstDrawn = time;
  });
}

/** Marks a step of a large file's load, and when it's drawn. */
export function markLoad(file: number, step: 'asked' | 'lines' | 'diff'): void {
  if (step === 'asked') {
    marks.loads[file] = { asked: now() };
    return;
  }
  const load = marks.loads[file];
  if (!load || load[step] !== undefined) return;
  load[step] = now();
  afterDrawn((time) => {
    load[step === 'lines' ? 'linesDrawn' : 'diffDrawn'] = time;
  });
}

/**
 * Calls `then` with the time the frame after the next one starts running, once the frame that
 * draws the change has gone to the compositor. Not the frames' own timestamps, which are when the
 * display asked for them, and can come before the change was even made.
 */
function afterDrawn(then: (time: number) => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => then(now())));
}

/** The parts of a Long Animation Frames entry the bench reports. */
interface AnimationFrameEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: {
    invoker?: string;
    sourceURL?: string;
    sourceFunctionName?: string;
    duration: number;
  }[];
}

function longFrame(entry: AnimationFrameEntry): LongFrame {
  const scripts = (entry.scripts ?? [])
    .toSorted((a, b) => b.duration - a.duration)
    .slice(0, 3)
    .map((script) => ({
      invoker: script.invoker ?? '',
      source: `${script.sourceFunctionName ?? ''} ${script.sourceURL ?? ''}`.trim(),
      duration: script.duration,
    }));
  return {
    start: performance.timeOrigin + entry.startTime,
    duration: entry.duration,
    blocking: entry.blockingDuration ?? 0,
    scripts,
  };
}
