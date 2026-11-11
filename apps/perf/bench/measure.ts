// One run of the bench on a pull request at a width: open it, press the keys, scroll from the top to
// the bottom twice, check blank rows at other speeds, hold PageDown from the top, and read the
// memory along the way. And one run of `zR` on a file.

import { readManifest } from '../src/data/manifest.ts';
import type { Marks } from '../src/window/marks.ts';
import type { Recording } from './recorder.ts';
import { checkLength, checkSpeeds, scrollSpeed } from './bars.ts';
import type { RunResult, SpeedCheck, Stretch, Width, ZRResult } from './results.ts';
import {
  addTimes,
  flingDown,
  goToFile,
  holdKey,
  noKeys,
  pageDown,
  record,
  scrollDown,
  stopRecording,
  stretchOf,
  timeKey,
  typeSlowly,
} from './scenarios.ts';
import {
  checkDisplay,
  focusSide,
  footprintOf,
  gpuOf,
  launch,
  memoryOf,
  refreshOf,
  residentOf,
  scrollOf,
  settle,
  type Suite,
} from './suite.ts';

export interface RunOptions {
  /** Stops each full scroll after this many px, for a short trial. */
  limit?: number;
  /** A large file to load at the end, kept out of the documents until then. */
  large?: string;
  /** Called with each frame check's median frame time. */
  frameCheck?: (median: number) => void;
  /** Called with every frame recorded in each stretch, to keep beside the report. */
  keep?: (stretch: string, recording: Recording) => void;
  /** Called with what's happening, for the log. */
  progress?: (line: string) => void;
}

/** Opens `pull` at `width` and measures everything the bars read. */
export async function measureRun(
  pull: string,
  width: Width,
  run: number,
  options: RunOptions = {},
): Promise<RunResult> {
  const suite = await launch(pull, width);
  try {
    return await measureOpened(suite, pull, width, run, options);
  } finally {
    await suite.app.close();
  }
}

async function measureOpened(
  suite: Suite,
  pull: string,
  width: Width,
  run: number,
  options: RunOptions,
): Promise<RunResult> {
  const { page } = suite;
  const notes: string[] = [];
  await settle(page, 2000);
  // Read once the first file's frame has surely been drawn, which can come after the rest arrive.
  const marks = await page.evaluate(() => window.perfMarks!);
  options.frameCheck?.(await checkDisplay(suite));
  const refresh = await refreshOf(suite);
  await checkWidth(suite, width, notes);
  const afterLoad = await memoryOf(suite);

  // The keys first, on a pull request just opened, as a person presses them.
  await focusSide(page, 'new');
  await settle(page, 300);
  await record(page);
  const keysStarted = performance.now();
  const top = async (): Promise<void> => {
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    await settle(page, 600);
  };
  await top();
  const nextFile = await timeKey(page, 10, 'f', { prefix: [']'] });
  await top();
  const nextChange = await timeKey(page, 10, 'c', { prefix: [']'] });
  const end = await timeKey(page, 3, 'G', { between: top, wait: 1000 });
  await top();
  await page.keyboard.press(']');
  await page.keyboard.press('c');
  await settle(page, 400);
  const heldJ = await holdKey(page, 'j', 150);
  // The floor: a key whose only effect is to recolour a 4 px square. And a key that changes
  // nothing, so paints nothing.
  const floor = await holdKey(page, 'F7', 150);
  const nothing = await holdKey(page, 'Escape', 60);
  // A comment on each side, which grows as it's typed, crossing with Tab between.
  const comment =
    'This reads well, but the error path still needs a test, and the name could say what it ' +
    'holds. Could we keep the old one for a release, so callers have time to move over to it?';
  const typing = noKeys();
  for (const side of ['new', 'old'] as const) {
    if (side === 'old') await page.keyboard.press('Tab');
    await settle(page, 300);
    await page.keyboard.press('c');
    await settle(page, 300);
    addTimes(typing, await typeSlowly(page, comment));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settle(page, 300);
  }
  const otherSide = await timeKey(page, 6, 'Tab');
  const keysRecording = await stopRecording(page);
  options.keep?.('keys', keysRecording);
  const keysStretch = stretchOf(
    keysRecording,
    { scrolled: 0, ms: performance.now() - keysStarted, inputs: 0 },
    refresh,
  );

  // The first full scroll, from the top.
  await top();
  const scroll = await scrollDown(suite, 'new', refresh, scrollSpeed, options.limit, (recording) =>
    options.keep?.('scroll', recording),
  );
  const height = (await scrollOf(page)).height;
  const afterFirst = await memoryOf(suite);

  // The second, the same, for the heap.
  await focusSide(page, 'new');
  await top();
  await scrollDown(suite, 'new', refresh, scrollSpeed, options.limit);
  const afterSecond = await memoryOf(suite);

  // Blank rows at each speed, each over the same distance from the top, then flings that slow down.
  const speeds: SpeedCheck[] = [];
  for (const speed of checkSpeeds) {
    await focusSide(page, 'new');
    await top();
    const stretch = await scrollDown(suite, 'new', refresh, speed, checkLength);
    speeds.push({ speed, stretch });
  }
  await focusSide(page, 'new');
  await top();
  const fling = await flingDown(suite, 'new', refresh, checkLength);

  // PageDown from the top.
  await focusSide(page, 'new');
  await top();
  const paged = await pageDown(
    suite,
    refresh,
    options.limit,
    (recording) => options.keep?.('pageDown', recording),
    options.progress,
  );
  const footprint = footprintOf(suite.pid);
  const resident = await residentOf(suite);
  const gpu = await gpuOf(suite);

  let large: RunResult['large'];
  if (options.large) large = await loadLarge(suite, pull, options.large, notes);

  const stretches: Stretch[] = [
    keysStretch,
    scroll,
    paged.stretch,
    ...speeds.map((check) => check.stretch),
    fling,
  ];
  return {
    pull,
    width,
    run,
    inner: suite.inner,
    height,
    open: openOf(marks),
    scroll: { ...scroll, speed: scrollSpeed },
    speeds,
    fling,
    pageDown: paged.stretch,
    stuck: paged.stuck,
    reached: paged.reached,
    keys: {
      heldJ,
      nextFile,
      nextChange,
      end,
      otherSide,
      pageDown: paged.keys,
      typing,
      floor,
      nothing,
      stretch: keysStretch,
    },
    alignment: {
      worst: Math.max(...stretches.map((stretch) => stretch.worst)),
      misaligned: stretches.reduce((sum, stretch) => sum + stretch.misaligned, 0),
      frames: stretches.reduce((sum, stretch) => sum + stretch.frames.frames + 1, 0),
    },
    memory: {
      afterLoad,
      afterFirst,
      afterSecond,
      peak: { footprint: footprint.peak, resident: resident.peak },
      gpu: gpuMemory(gpu),
      growth: ((afterSecond.heap - afterFirst.heap) / afterFirst.heap) * 100,
    },
    ...(large ? { large } : {}),
    notes,
  };
}

/** The GPU process's footprint now and at its largest, in MB. */
function gpuMemory(pid: number | undefined): RunResult['memory']['gpu'] {
  if (pid === undefined) return undefined;
  const { now, peak } = footprintOf(pid);
  return { footprint: now, peak };
}

/**
 * The opening's times: from the page starting to open the pull request, as a tab opens one, to its
 * first file drawn; and from the background process getting the files to the moves arriving.
 * Main reading the files and the window starting come before the page opens it, on their own.
 */
function openOf(marks: Marks): RunResult['open'] {
  const until = marks.loaded ?? Infinity;
  const from = marks.asked ?? marks.started;
  const longTasks = marks.longTasks.filter((task) => task.start >= from && task.start < until);
  return {
    firstDrawn: since(marks.firstDrawn, marks.asked),
    loaded: since(marks.loaded, marks.read),
    longestTask: Math.max(0, ...longTasks.map((task) => task.duration)),
    read: since(marks.read, marks.opened),
    window: since(marks.started, marks.read),
    headStart: since(marks.asked, marks.read),
    steps: {
      'main reads every file': since(marks.read, marks.opened),
      'the window starts and loads the page': since(marks.started, marks.read),
      'the page loads its code': since(marks.asked, marks.started),
      'the page gets the pull request and makes the view': since(marks.view, marks.asked),
      'the first file’s diff and highlighting arrive': since(marks.firstArrived, marks.view),
      'the first file is drawn': since(marks.firstDrawn, marks.firstArrived),
      'the rest arrive, then the moves': since(marks.loaded, marks.firstArrived),
    },
    longTasks,
    longFrames: marks.longFrames.filter((frame) => frame.start >= from && frame.start < until),
  };
}

/** The time from `from` to `time`, when both happened. */
function since(time: number | undefined, from: number | undefined): number | undefined {
  return time === undefined || from === undefined ? undefined : time - from;
}

/** Notes when the window isn't as wide as asked: 1440 px, or the screen's width. */
async function checkWidth(suite: Suite, width: Width, notes: string[]): Promise<void> {
  const wanted =
    width === '1440'
      ? 1440
      : await suite.app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.width);
  if (suite.inner.width !== wanted) {
    notes.push(`The window's inner width was ${suite.inner.width} px, not ${wanted} px.`);
  }
}

/**
 * Loads a file kept out of the documents with `za` on its header, and times its lines and then its
 * diff, from the view asking for it to each one drawn.
 */
async function loadLarge(
  suite: Suite,
  pull: string,
  path: string,
  notes: string[],
): Promise<RunResult['large']> {
  const { page } = suite;
  const paths = readManifest(pull).files.map((file) => file.path);
  const index = paths.indexOf(path);
  await focusSide(page, 'new');
  await goToFile(page, paths, path);
  await page.keyboard.press('z');
  await page.keyboard.press('a');
  try {
    await page.waitForFunction((file) => window.perfMarks!.loads[file]?.diffDrawn, index, {
      timeout: 120_000,
      polling: 100,
    });
  } catch {
    notes.push(`${path} didn't finish loading in two minutes.`);
  }
  const load = await page.evaluate((file) => window.perfMarks!.loads[file], index);
  return {
    path,
    lines: load?.linesDrawn === undefined ? undefined : load.linesDrawn - load.asked,
    diff: load?.diffDrawn === undefined ? undefined : load.diffDrawn - load.asked,
  };
}

/** Opens `pull` at `width`, goes to `path`, and times `zR` there. */
export async function measureZR(
  pull: string,
  path: string,
  width: Width,
  run: number,
  frameCheck?: (median: number) => void,
): Promise<ZRResult> {
  const suite = await launch(pull, width);
  try {
    const { page } = suite;
    const notes: string[] = [];
    await settle(page, 2000);
    frameCheck?.(await checkDisplay(suite));
    await checkWidth(suite, width, notes);
    await focusSide(page, 'new');
    await goToFile(
      page,
      readManifest(pull).files.map((file) => file.path),
      path,
    );
    await settle(page, 1000);
    // The floor, as in every run: a key that only recolours a 4 px square.
    const floor = await holdKey(page, 'F7', 60);
    const before = await scrollOf(page);
    await record(page);
    const started = performance.now();
    const keyToPaint = await timeKey(page, 1, 'R', { prefix: ['z'], wait: 1500 });
    const recording = await stopRecording(page);
    const after = await scrollOf(page);
    const refresh = await refreshOf(suite);
    if (after.height - before.height < 100_000) {
      notes.push(`zR grew the document by only ${Math.round(after.height - before.height)} px.`);
    }
    return {
      pull,
      path,
      width,
      run,
      keyToPaint,
      floor,
      stretch: stretchOf(
        recording,
        { scrolled: after.top - before.top, ms: performance.now() - started, inputs: 2 },
        refresh,
      ),
      notes,
    };
  } finally {
    await suite.app.close();
  }
}
