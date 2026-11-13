// The key spec's suite: a small pull request it writes itself, a few files with a rename, a move and
// threads on both sides, opened in the built suite with nothing to fetch, and the page's probe.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CursorReading, Mark, Place, Probe, Spot } from '@lo/ui/code';
import { _electron as electron, test as base, expect, type Page } from '@playwright/test';
// Imported from Node, the electron package is the path to its binary, whatever its types say.
import electronPackage from 'electron';

import type { Fixture } from '../src/main/fixture.ts';

/** The suite's folder. Electron starts the built main process its `package.json` names. */
const suiteFolder = fileURLToPath(new URL('..', import.meta.url));

const electronBinary: unknown = electronPackage;

/** `count` lines of code, each different, so every line and word can be told apart. */
export function code(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `const ${prefix}${index + 1} = compute(${index + 1}, '${prefix}');`,
  );
}

/** The moved block: deleted from one file, added to another. */
const moved = [
  'export function parseHeader(line: string): Header {',
  "  const [name, ...rest] = line.split(':');",
  '  const value = rest.join(":").trim();',
  '  if (!name) throw new Error(`No header in ${line}`);',
  '  return { name: name.trim().toLowerCase(), value };',
  '}',
  '',
  'export function formatHeader(header: Header): string {',
  '  return `${header.name}: ${header.value}`;',
  '}',
];

/** `app.ts`, before: 300 lines. After: every 25th changed, and two added after line 100. */
export const app = {
  old: code('app', 300),
  new: code('app', 300).flatMap((line, index) => {
    const changed = (index + 1) % 25 === 0 ? [`${line} // changed`] : [line];
    return index === 99 ? [...changed, 'const added1 = 1;', 'const added2 = 2;'] : changed;
  }),
};

export const files: Fixture['files'] = [
  { path: 'src/app.ts', status: 'modified', old: text(app.old), new: text(app.new) },
  {
    path: 'src/new-name.ts',
    previousPath: 'src/old-name.ts',
    status: 'renamed',
    old: text(code('named', 60)),
    new: text(code('named', 60).map((line, index) => (index === 30 ? `${line} // renamed` : line))),
  },
  {
    path: 'src/from.ts',
    status: 'modified',
    old: text([...code('from', 40), ...moved, ...code('rest', 40)]),
    new: text([...code('from', 40), ...code('rest', 40)]),
  },
  {
    path: 'src/to.ts',
    status: 'modified',
    old: text(code('to', 40)),
    new: text([...code('to', 20), ...moved, ...code('to', 40).slice(20)]),
  },
  { path: 'docs/added.ts', status: 'added', new: text(code('added', 250)) },
  { path: 'src/removed.ts', status: 'removed', old: text(code('removed', 200)) },
];

/** Threads on both sides, the recorded way: each comment's length. */
export const threads: Fixture['threads'] = [
  { path: 'src/app.ts', side: 'new', line: 40, comments: [120, 300] },
  { path: 'src/app.ts', side: 'old', line: 150, comments: [80] },
  { path: 'docs/added.ts', side: 'new', line: 120, comments: [200] },
  { path: 'src/removed.ts', side: 'old', line: 60, comments: [60, 60] },
];

function text(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

declare global {
  interface Window {
    diffView: Probe;
    diffLoaded?: boolean;
    /** Brings the local copy's files that are waiting, and says how many there were. */
    perfCopy(): number;
    /** Gives the view an overview's markers, in place of those it had. */
    perfOverview(marks: readonly Mark[]): void;
    /** Opens the notes of the markers on a line, and says whether there were any. */
    perfOpenNote(at: Place): boolean;
    /** Closes the note opened last, and says whether there was one. */
    perfCloseNote(): boolean;
    /** Puts a thread of `comments` under the line at `at`, in place of the one there. */
    perfThread(at: Place, comments: readonly { author: string; body: string }[]): void;
    /** What moved on screen while a test watched, on a frame with no input. */
    perfMoved?: string[];
    /** Stops watching. */
    perfStill?: boolean;
  }
}

export const test = base.extend<{ pull: Fixture; page: Page }>({
  /** The pull request a test opens. */
  pull: [{ repo: 'withlo/example', number: 1, files, threads }, { option: true }],
  page: async ({ pull }, use) => {
    const fixture = base.info().outputPath('pull.json');
    writeFileSync(fixture, JSON.stringify(pull));
    if (typeof electronBinary !== 'string') throw new Error('The electron package gave no path.');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    delete env.ELECTRON_RUN_AS_NODE;
    env.LO_PERF_PULL = fixture;
    const suite = await electron.launch({
      args: [suiteFolder],
      executablePath: electronBinary,
      env,
      // Playwright turns the sandbox off on Linux unless asked; the suite runs with it, as Lo does.
      chromiumSandbox: true,
    });
    const page = await suite.firstWindow();
    await page.waitForFunction(() => window.diffLoaded === true, null, { timeout: 30_000 });
    await use(page);
    await suite.close();
  },
});

export { expect };

/** The cursor, as the probe reads it. */
export function cursor(page: Page): Promise<CursorReading | undefined> {
  return page.evaluate(() => window.diffView.cursor());
}

/** The file a spot is in. */
export function fileOf(spot: Spot | undefined): string | undefined {
  return spot?.kind === 'line' ? spot.at.file : spot?.file;
}

/** The line a spot is on, or 0 on a header. */
export function lineOf(spot: Spot | undefined): number | undefined {
  if (!spot) return undefined;
  return spot.kind === 'line' ? spot.at.line : 0;
}

/** Gives a side focus, with a click in the middle of what it shows. */
export async function focusSide(page: Page, side: 'old' | 'new'): Promise<void> {
  const label = side === 'old' ? 'Before' : 'After';
  const column = await page.locator(`.cm-content[aria-label="${label}"]`).boundingBox();
  const screen = await page.locator('.lo-diffview').boundingBox();
  if (!column || !screen) throw new Error('The view isn’t drawn.');
  await page.mouse.click(column.x + 120, screen.y + screen.height / 2);
}

/** Presses each of `keys` in turn. */
export async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The text in the comment box, a line at a time. */
export function boxText(page: Page): Promise<string[]> {
  return page
    .locator('.lo-diffcomposer .cm-line')
    .evaluateAll((lines) => lines.map((line) => line.textContent ?? ''));
}

/** Whether focus is in the comment box. */
export function inBox(page: Page): Promise<boolean> {
  return page.evaluate(() => Boolean(document.activeElement?.closest('.lo-diffcomposer')));
}

/** The layout's name, as a test's title says it. */
export function name(layout: 'split' | 'inline'): string {
  return layout === 'split' ? 'side by side' : 'inline';
}

/** Scrolls part way down `src/app.ts`, in `layout`, and waits for the scroll to settle. */
export async function partWay(page: Page, layout: 'split' | 'inline'): Promise<void> {
  if (layout === 'inline') {
    await focusSide(page, 'new');
    await press(page, 'g', 'i');
    await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('inline');
  }
  await page.evaluate(() => {
    document.querySelector('.lo-diffview')!.scrollTop = 1600;
  });
  await frames(page, 10);
}

/** Scrolls by `by` pixels, as the wheel does, and waits for the scroll to settle. */
export async function scrollBy(page: Page, by: number): Promise<void> {
  await page.evaluate((distance) => {
    const box = document.querySelector('.lo-diffview')!;
    box.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    box.scrollTop += distance;
  }, by);
  await frames(page, 15);
}

/** The first line of a file drawn `share` of the way down the screen, or below it. */
export async function lineAt(page: Page, share: number): Promise<Place> {
  const spot = await page.evaluate((down) => {
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    for (let y = box.top + 1 + (box.height - 2) * down; y < box.bottom; y += 4) {
      const found = window.diffView.spotAt(y);
      if (found?.kind === 'line') return found;
    }
    return undefined;
  }, share);
  const file = fileOf(spot);
  const line = lineOf(spot);
  if (!file || !line || line < 7) throw new Error('No line is on the screen there.');
  return { file, side: 'new', line };
}

/**
 * Watches the lines at the top of the screen and in its middle every frame, until `stopWatching`:
 * one that moves on a frame with no wheel, key or pointer, and is still moved on the next frame,
 * is noted.
 */
export async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = window.diffView;
    const box = document.querySelector('.lo-diffview')!.getBoundingClientRect();
    const find = (from: number) => {
      for (let y = from; y < box.bottom; y += 2) {
        const spot = probe.spotAt(y);
        const top = spot && probe.spotTop(spot);
        if (spot && top !== undefined && top >= box.top) return { spot, y: top };
      }
      throw new Error('Nothing is drawn on screen.');
    };
    const watched = [
      { name: 'top', ...find(box.top + 1), away: 0 },
      { name: 'middle', ...find((box.top + box.bottom) / 2), away: 0 },
    ];
    const noted: string[] = [];
    window.perfMoved = noted;
    window.perfStill = false;
    let input = false;
    const noteInput = () => {
      input = true;
    };
    const types = ['wheel', 'keydown', 'pointerdown'];
    for (const type of types) window.addEventListener(type, noteInput, { capture: true });
    const tick = () => {
      for (const each of watched) {
        const y = probe.spotTop(each.spot);
        if (input) {
          if (y !== undefined) each.y = y;
          each.away = 0;
          continue;
        }
        const off = y === undefined || Math.abs(y - each.y) > 0.5;
        each.away = off ? each.away + 1 : 0;
        if (each.away === 2) {
          noted.push(`${each.name} ${JSON.stringify(each.spot)} ${each.y} → ${y}`);
        }
      }
      input = false;
      if (!window.perfStill) {
        requestAnimationFrame(tick);
        return;
      }
      for (const type of types) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
    requestAnimationFrame(tick);
  });
}

/** Stops watching, and says what moved. */
export function stopWatching(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    window.perfStill = true;
    return window.perfMoved ?? [];
  });
}

/** Waits for `count` frames. */
export function frames(page: Page, count: number): Promise<void> {
  return page.evaluate(async (left) => {
    for (let frame = 0; frame < left; frame++) await new Promise(requestAnimationFrame);
  }, count);
}
