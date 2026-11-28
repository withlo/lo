// A diff's file headers in Chromium itself, where they're laid out, at the widths narrow windows
// give them, a few pixels apart: inline from 340 px, as a 356 px code view beside a reading view or
// a 368 or 408 px diff beside a panel is, and side by side from two 240 px sides. Narrow, a header
// gives up its note, then its folder, which it cuts first, and only then cuts its name, each step
// whole, nothing under `min-w-cut` and nothing drawn over anything else, and its end group is drawn
// whole, 8 px short of the band's end: inline and side by side, in the flow and pinned. And from
// 184 px, each step is given up only where it's needed, and a pinned copy gives up what its header
// does, so nothing comes or goes as it pins.

import { readFileSync } from 'node:fs';

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

const VIEW = readFileSync(new URL('../src/code/view.css', import.meta.url), 'utf8');

/** Where the page is built, once in each worker: Lo's stylesheet, and the code view's. */
const harness = () =>
  buildPage(
    'heads.ts',
    'File headers',
    async () => `${await utilities()}\n${VIEW}\n#root { height: 600px; }`,
  );

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(layout: 'split' | 'inline', width: number): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'heads' in window);
  await page.evaluate(({ shown, wide }) => window.heads.open(shown, wide), {
    shown: layout,
    wide: width,
  });
  await frames(page);
  return page;
}

function frames(page: Page): Promise<void> {
  return page.evaluate(() => window.heads.frames(3));
}

function read(page: Page) {
  return page.evaluate(() => window.heads.read());
}

/** The least a cut name keeps, `min-w-cut`, short of a rounding. */
const CUT = 47.5;

type Drawn = Awaited<ReturnType<typeof read>>[number];

/** Each header in `drawn` follows the order it gives up in, and draws nothing cut past its rules. */
function inOrder(drawn: readonly Drawn[], parts: readonly string[], width: number): void {
  expect(new Set(drawn.map((each) => each.part))).toEqual(new Set(parts));
  for (const head of drawn) {
    const where = `${width} px: ${head.part} header of ${head.path} (${head.gaveUp || 'whole'})`;
    if (head.endWhole !== undefined) expect(head.endWhole, where).toBe(true);
    if (head.startFits === undefined) continue;
    expect(head.startFits, where).toBe(true);
    expect(head.apart, where).toBe(true);
    // A folder shows only while the name is whole, and keeps a few letters.
    if (head.folder) {
      expect(head.name.whole, where).toBe(true);
      expect(head.folder.whole || head.folder.width >= CUT, where).toBe(true);
    }
    // The note shows only while the path is whole.
    if (head.note) {
      expect(head.name.whole && (head.folder?.whole ?? true), where).toBe(true);
    }
    expect(head.name.whole || head.name.width >= CUT, where).toBe(true);
    // And it gave up nothing it had room for: a folder is cut to `min-w-cut` before it goes, and
    // what's given up but still heard takes no room.
    expect(head.needed, where).toBe(true);
  }
}

/** Every width from `from` to `to`, 8 px apart. */
function widths(from: number, to: number): number[] {
  return Array.from({ length: (to - from) / 8 + 1 }, (_, index) => from + index * 8);
}

/** Each header drawn follows its order at each of `sizes`, the box made that wide in turn. */
async function across(
  page: Page,
  sizes: readonly number[],
  parts: readonly string[],
): Promise<void> {
  const found = await page.evaluate((each) => window.heads.across(each), sizes);
  for (const { width, drawn } of found) inOrder(drawn, parts, width);
}

test('inline, from 340 to 476 px, as a code view beside a reading view or a diff beside a panel is, each header gives up its note, then its folder, then cuts its name, and its end is whole, in the flow and pinned', async () => {
  const page = await open('inline', 340);
  await page.evaluate(() => window.heads.pin());
  await across(page, widths(340, 476), ['both', 'pinned']);
});

test('side by side, from 480 to 600 px, each half of a header gives up on its own, in the flow and pinned, and a wide diff gives up nothing', async () => {
  const page = await open('split', 480);
  expect(await page.evaluate(() => window.heads.layout())).toBe('split');
  await page.evaluate(() => window.heads.pin());
  await across(page, [...widths(480, 600), 1200], ['start', 'end', 'pinned']);
  const usage = (await read(page)).filter((each) => each.path === 'docs/usage.md');
  expect(usage.map((each) => each.gaveUp)).toEqual(usage.map(() => ''));
});

test('inline, from 184 to 512 px, each header gives up a step only where it doesn’t fit without it, its folder cut to `min-w-cut` before it goes, in the flow and pinned', async () => {
  const page = await open('inline', 184);
  await page.evaluate(() => window.heads.pin());
  const found = await page.evaluate((each) => window.heads.across(each), widths(184, 512));
  for (const { width, drawn } of found) {
    expect(new Set(drawn.map((each) => each.part))).toEqual(new Set(['both', 'pinned']));
    for (const head of drawn) {
      const where = `${width} px: ${head.part} header of ${head.path} (${head.gaveUp || 'whole'})`;
      expect(head.needed, where).toBe(true);
      if (head.folder) {
        expect(head.name.whole, where).toBe(true);
        expect(head.folder.whole || head.folder.width >= CUT, where).toBe(true);
      }
    }
  }
});

test('side by side, a header’s pinned copy gives up what it does in the flow, so nothing in it moves as it pins', async () => {
  const page = await open('split', 480);
  for (const path of [
    'packages/desktop/ui/src/code/widgets/pin.ts',
    'packages/desktop/ui/src/code/a-name-long-enough-to-cut.ts',
  ]) {
    await page.evaluate((each) => window.heads.pinAt(each), path);
    const found = await page.evaluate((each) => window.heads.across(each), widths(480, 720));
    for (const { width, drawn } of found) {
      const where = `${width} px: ${path}`;
      const flow = drawn.find((each) => each.path === path && each.part === 'start');
      const pinned = drawn.find((each) => each.path === path && each.part === 'pinned');
      expect(flow, where).toBeDefined();
      expect(pinned?.steps.start, where).toBe(flow?.steps.start);
      expect(pinned?.folder?.text, where).toBe(flow?.folder?.text);
    }
    await page.evaluate(() => window.heads.size(480));
  }
});

test('a path given up to its name shows whole in its tooltip', async () => {
  const page = await open('inline', 356);
  const long = 'packages/desktop/ui/src/code/a-name-long-enough-to-cut.ts';
  const head = (await read(page)).find((each) => each.path === long);
  expect(head?.folder).toBeUndefined();
  await page.locator(`.cm-editor:not([hidden]) .lo-diffhead[data-path="${long}"] .lo-path`).hover();
  await expect(page.locator('.lo-tip')).toHaveText(long);
});
