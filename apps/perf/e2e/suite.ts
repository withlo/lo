// The key spec's suite: a small pull request it writes itself, a few files with a rename, a move and
// threads on both sides, opened in the built suite with nothing to fetch, and the page's probe.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { CursorReading, Misalignment, Spot } from '@lo/ui/code';
import { _electron as electron, test as base, type Page } from '@playwright/test';
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
    diffView: {
      cursor(): CursorReading | undefined;
      misalignment(): Misalignment;
      readonly layout: 'split' | 'inline';
    };
    diffLoaded?: boolean;
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
    for (const [name, value] of Object.entries(process.env)) {
      if (value !== undefined) env[name] = value;
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

export { expect } from '@playwright/test';

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
