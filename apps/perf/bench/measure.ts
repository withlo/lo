// One run of the bench on a pull request at a width: open it, press the keys, fling from the top to
// the bottom, hold PageDown from the top to the bottom, and read the memory along the way. And one
// run of `zR` on a file.

import { readManifest } from '../src/data/manifest.ts';
import type { Marks } from '../src/window/marks.ts';
import type { Recording } from './recorder.ts';
import type { RunResult, Stretch, Width, ZRResult } from './results.ts';
import type { KeyTimes } from './stats.ts';
import {
  flingDown,
  flingThrough,
  goToFile,
  holdKey,
  keyThreshold,
  pageDown,
  record,
  stopRecording,
  stretchOf,
  timeKey,
  typeSlowly,
} from './scenarios.ts';
import {
  checkDisplay,
  focusSide,
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
  // What any key costs here: one Vim does nothing with in normal mode.
  const nothing = await holdKey(page, 'Escape', 60);
  // A comment on each side, which grows as it's typed, crossing with Tab between.
  const comment =
    'This reads well, but the error path still needs a test, and the name could say what it ' +
    'holds. Could we keep the old one for a release, so callers have time to move over to it?';
  const typing: KeyTimes = { keys: 0, reported: [], under: keyThreshold, parts: [] };
  for (const side of ['new', 'old'] as const) {
    if (side === 'old') await page.keyboard.press('Tab');
    await settle(page, 300);
    await page.keyboard.press('c');
    await settle(page, 300);
    const typed = await typeSlowly(page, comment);
    typing.keys += typed.keys;
    typing.reported.push(...typed.reported);
    typing.parts.push(...typed.parts);
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

  // The first full scroll: flings from the top.
  await top();
  const fling = await flingDown(suite, 'new', refresh, options.limit, (recording) =>
    options.keep?.('fling', recording),
  );
  const height = (await scrollOf(page)).height;
  const afterFirst = await memoryOf(suite);

  // The second, for the heap: flings again from the top, harder. Not with PageDown, which can
  // stop short of the bottom.
  await focusSide(page, 'new');
  await top();
  if (options.limit === undefined) await flingThrough(suite, 'new');
  else await flingDown(suite, 'new', refresh, options.limit);
  const afterSecond = await memoryOf(suite);

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
  const { peak } = await residentOf(suite);

  let large: RunResult['large'];
  if (options.large) large = await loadLarge(suite, pull, options.large, notes);

  const stretches: Stretch[] = [keysStretch, fling, paged.stretch];
  return {
    pull,
    width,
    run,
    inner: suite.inner,
    height,
    open: openOf(marks),
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
      peak,
      growth: ((afterSecond.heap - afterFirst.heap) / afterFirst.heap) * 100,
    },
    ...(large ? { large } : {}),
    notes,
  };
}

/** The opening's times, from main starting to open the pull request. */
function openOf(marks: Marks): RunResult['open'] {
  const until = marks.loaded ?? Infinity;
  const longTasks = marks.longTasks.filter((task) => task.start < until);
  return {
    firstDrawn: since(marks.firstDrawn, marks.opened),
    loaded: since(marks.loaded, marks.opened),
    longestTask: Math.max(0, ...longTasks.map((task) => task.duration)),
    steps: {
      'main reads the files': since(marks.read, marks.opened),
      'the window starts, and loads the page': since(marks.started, marks.read),
      'the page makes the view': since(marks.view, marks.started),
      'the first file’s diff and highlighting arrive': since(marks.firstArrived, marks.view),
      'the first file is drawn': since(marks.firstDrawn, marks.firstArrived),
      'the rest arrive, then the moves': since(marks.loaded, marks.firstArrived),
    },
    longTasks,
    longFrames: marks.longFrames.filter((frame) => frame.start < until),
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
