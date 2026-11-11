// Starting the built suite on a recorded pull request, as the bench measures it: the production
// bundle run unpackaged, with V8's `gc()` exposed, in a window 1440 px wide or as large as the
// screen allows; and what the bench reads from it from outside the page.

import { fileURLToPath } from 'node:url';

import {
  _electron as electron,
  type CDPSession,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';

import { recorderSource } from './recorder.ts';
import type { Width } from './results.ts';

/** The suite's folder. Electron starts the built main process its `package.json` names. */
const suiteFolder = fileURLToPath(new URL('..', import.meta.url));

const electronBinary: unknown = electronPackage;

/** What Chromium records into a trace: what the DevTools Performance panel shows. */
export const traceCategories = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
  'blink.user_timing',
  'latencyInfo',
  'loading',
  'toplevel',
];

export interface Suite {
  app: ElectronApplication;
  page: Page;
  cdp: CDPSession;
  /** The renderer's process ID. */
  pid: number;
  inner: { width: number; height: number };
}

export interface LaunchOptions {
  /** Records a video into this folder, at the window's size. */
  video?: string;
  /** Traces the opening into this file. */
  trace?: string;
}

/** Starts the suite on `pull` and waits until every diff and the moves have arrived. */
export async function launch(
  pull: string,
  width: Width,
  options: LaunchOptions = {},
): Promise<Suite> {
  if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LO_PERF_PULL;
  if (width === 'screen') env.LO_PERF_WINDOW = 'screen';
  else delete env.LO_PERF_WINDOW;
  const trace = options.trace
    ? [
        `--trace-startup=${traceCategories.join(',')}`,
        `--trace-startup-file=${options.trace}`,
        '--trace-startup-duration=30',
      ]
    : [];
  const app = await electron.launch({
    args: ['--js-flags=--expose-gc', ...trace, suiteFolder, pull],
    executablePath: electronBinary,
    env,
    chromiumSandbox: true,
    timeout: 60_000,
    ...(options.video
      ? { recordVideo: { dir: options.video, size: { width: 1440, height: 868 } } }
      : {}),
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.diffLoaded === true, null, {
      timeout: 300_000,
      polling: 100,
    });
    await page.evaluate(recorderSource());
    const cdp = await page.context().newCDPSession(page);
    const pid = await app.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      if (!window) throw new Error('The suite has no window.');
      return window.webContents.getOSProcessId();
    });
    const inner = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    return { app, page, cdp, pid, inner };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** The screen the window opens on, and whether the screen is locked. */
export function screenOf(app: ElectronApplication): Promise<{
  label: string;
  width: number;
  height: number;
  workArea: { width: number; height: number };
  scale: number;
  hz: number;
  locked: boolean;
}> {
  return app.evaluate(({ screen, powerMonitor }) => {
    const display = screen.getPrimaryDisplay();
    return {
      label: display.label,
      width: display.size.width,
      height: display.size.height,
      workArea: { width: display.workArea.width, height: display.workArea.height },
      scale: display.scaleFactor,
      hz: display.displayFrequency,
      locked: powerMonitor.getSystemIdleState(1) === 'locked',
    };
  });
}

/**
 * Stops unless the display is awake and showing the window: the screen unlocked, and frames
 * coming at the display's rate. A sleeping display, or a hidden window, gets few or none.
 * Returns the frames' median time.
 */
export async function checkDisplay(suite: Suite): Promise<number> {
  const screen = await screenOf(suite.app);
  if (screen.locked)
    throw new Error('The screen is locked. The bench needs it unlocked and awake.');
  const rate = await suite.page.evaluate(() => window.perfBench!.frameRate(1000));
  const expected = 1000 / screen.hz;
  if (rate.frames < 0.5 * (1000 / expected) || rate.median > expected * 1.5) {
    throw new Error(
      `Frames came every ${rate.median.toFixed(1)} ms (${rate.frames} in a second), not every ` +
        `${expected.toFixed(1)} ms: the display looks asleep, or the window hidden.`,
    );
  }
  return rate.median;
}

/** The display's refresh period, in ms. */
export async function refreshOf(suite: Suite): Promise<number> {
  return 1000 / (await screenOf(suite.app)).hz;
}

/** Collects garbage twice, then reads the renderer's resident memory and JS heap, in MB. */
export async function memoryOf(suite: Suite): Promise<{ resident: number; heap: number }> {
  await suite.page.evaluate(() => {
    const collect = Reflect.get(globalThis, 'gc');
    if (typeof collect !== 'function') throw new Error('gc() isn’t exposed.');
    collect();
    collect();
  });
  await suite.page.waitForTimeout(300);
  const { usedSize } = await suite.cdp.send('Runtime.getHeapUsage');
  const resident = await residentOf(suite);
  return { resident: resident.now, heap: usedSize / 1e6 };
}

/** The renderer's resident memory now and at its largest so far, in MB. */
export async function residentOf(suite: Suite): Promise<{ now: number; peak: number }> {
  const memory = await suite.app.evaluate(
    ({ app }, pid) => app.getAppMetrics().find((metric) => metric.pid === pid)?.memory,
    suite.pid,
  );
  if (!memory) throw new Error('The renderer isn’t in the app’s metrics.');
  // Electron gives kilobytes of 1,024 bytes.
  return {
    now: (memory.workingSetSize * 1024) / 1e6,
    peak: (memory.peakWorkingSetSize * 1024) / 1e6,
  };
}

/** Where the view's box that scrolls is, how far it can scroll, and how tall its screen is. */
export function scrollOf(
  page: Page,
): Promise<{ top: number; max: number; height: number; screen: number }> {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('.lo-diffview')!;
    return {
      top: box.scrollTop,
      max: box.scrollHeight - box.clientHeight,
      height: box.scrollHeight,
      screen: box.clientHeight,
    };
  });
}

/**
 * Where to point at a side: a little into its text, halfway down the screen. In the inline layout,
 * its one column.
 */
export async function pointAt(page: Page, side: 'old' | 'new'): Promise<{ x: number; y: number }> {
  const inline = await page.evaluate(() => window.diffView.layout === 'inline');
  const label = inline ? 'Changes' : side === 'old' ? 'Before' : 'After';
  const column = await page.locator(`.cm-content[aria-label="${label}"]`).boundingBox();
  const screen = await page.locator('.lo-diffview').boundingBox();
  if (!column || !screen) throw new Error('The view isn’t drawn.');
  return { x: column.x + 120, y: screen.y + screen.height / 2 };
}

/** Gives a side focus with a click, as a person does. */
export async function focusSide(page: Page, side: 'old' | 'new'): Promise<void> {
  const at = await pointAt(page, side);
  await page.mouse.click(at.x, at.y);
}

/** Waits `ms`, then until what was asked for is painted. */
export async function settle(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.perfBench!.painted());
}

/** The file the cursor is in. */
export async function cursorFile(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const at = window.diffView.cursor()?.at;
    return at?.kind === 'line' ? at.at.file : at?.file;
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, Math.max(0, ms)));
}
