// The code view in Chromium itself, where lines and threads take the room they're drawn in: what's
// held on screen for the reader's next input comes with it, and what they read stays where it is,
// side by side and inline: the cursor's line as `j` moves it, the comment box they type in, and the
// thread they click. A change the view takes on its own as the view narrows, lines wrapping anew,
// leaves the line at the top of the screen where it is, and the reader's own scroll as it narrows,
// by key, wheel or jump, goes where it says.

import { readFileSync } from 'node:fs';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import type { DiffLayout } from '../src/code/index.ts';
import { buildPage, launch } from './electron.ts';

const STYLE = [
  readFileSync(new URL('../src/code/view.css', import.meta.url), 'utf8'),
  'body { margin: 0; } #root { width: 1000px; height: 600px; } .card { background: #ddd; }',
].join('\n');

/** Where the page is built. */
let harness = '';

test.beforeAll(async () => {
  harness = await buildPage('code.ts', 'Code', STYLE);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/**
 * The page, its view in `layout`, new line 20 at the top of the screen or `below` pixels below it,
 * and the first `wrapped` lines long enough to wrap.
 */
async function open(
  layout: DiffLayout,
  { wrapped = 0, below = 0 }: { wrapped?: number; below?: number } = {},
): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(
    ({ shown, lines, under }) => {
      window.harness.open(shown, lines);
      window.harness.scrollTo(20, under);
    },
    { shown: layout, lines: wrapped, under: below },
  );
  await frames(page);
  return page;
}

/**
 * The page, its view in `layout`, with the lines above new line 20 long enough to wrap, the last
 * rows of line 19 across the top of the screen and line 20 below them, and the reader's cursor on
 * line 25, on screen, so the jump that put them there is over. As the view narrows, the lines
 * above the screen wrap onto more rows, line 19 among them, which moves the lines on screen down
 * until the view puts them back.
 */
async function wrapping(layout: DiffLayout, below = 30): Promise<Page> {
  const page = await open(layout, { wrapped: 19, below });
  await page.evaluate(() => window.harness.cursor(25));
  await frames(page);
  return page;
}

/** The view narrows to 640 px, and a frame starts before the view has taken it. */
function narrowed(page: Page): Promise<void> {
  return page.evaluate(() => {
    window.harness.narrow(640);
    return window.harness.frames(1);
  });
}

/** Where unchanged line `line` starts, down from the top of the screen. */
function lineTop(page: Page, line: number): Promise<number | undefined> {
  return page.evaluate((at) => window.harness.lineTop(at), line);
}

/** The layout `layout` isn't. */
function other(layout: DiffLayout): DiffLayout {
  return layout === 'split' ? 'inline' : 'split';
}

/** Waits for a few frames, which lay out and measure what changed, and line it up. */
function frames(page: Page): Promise<void> {
  return page.evaluate(() => window.harness.frames(3));
}

/** The unchanged lines all on screen, top to bottom. */
function onScreen(page: Page): Promise<{ line: number; top: number }[]> {
  return page.evaluate(() => window.harness.onScreen());
}

/** Waits until the threads drawn are `ids`, in order, none held. */
async function drawn(page: Page, ids: string[]): Promise<void> {
  const shown = () =>
    page.evaluate(() => ({
      ids: [...document.querySelectorAll<HTMLElement>('[data-thread-id]')].map(
        (each) => each.dataset.threadId,
      ),
      held: document.querySelectorAll('.is-held').length,
    }));
  await expect.poll(shown, { timeout: 20_000 }).toEqual({ ids, held: 0 });
}

for (const layout of ['split', 'inline'] as const) {
  test.describe(layout === 'split' ? 'Side by side' : 'Inline', () => {
    test('`j` lets threads waiting and held above the cursor come, and the line it goes to stays where it is, near the foot', async () => {
      const page = await open(layout);
      const first = await onScreen(page);
      const held = first[1]!.line;
      const late = first[3]!.line;
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'held', line, height: 60 }], true),
        held,
      );
      await frames(page);
      // The last line on screen with an unchanged line after it, which `j` goes to.
      const lines = await onScreen(page);
      const cursor = lines.findLast(({ line }) => lines.some((next) => next.line === line + 1))!;
      await page.evaluate((line) => window.harness.cursor(line), cursor.line);
      await frames(page);
      // Grown with no input, as when an image in it loads, it's held as it was drawn.
      await page.evaluate(() => window.harness.grow('held', 140));
      await expect(page.locator('[data-thread-id="held"]')).toHaveClass(/is-held/);
      await page.evaluate(
        (at) =>
          window.harness.threads([
            { id: 'held', line: at.held, height: 140 },
            { id: 'late', line: at.late, height: 120 },
          ]),
        { held, late },
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate((line) => window.harness.lineTop(line), cursor.line + 1);

      await page.keyboard.press('j');
      await drawn(page, ['held', 'late']);
      await frames(page);
      const after = await page.evaluate((line) => window.harness.lineTop(line), cursor.line + 1);
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('typing in a comment box lets a thread waiting above it come, and the box stays where it is', async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      const late = lines[2]!.line;
      await page.evaluate((line) => window.harness.compose(line), lines[10]!.line);
      await frames(page);
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'late', line, height: 120 }]),
        late,
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate(() => window.harness.top('.lo-diffcomposer'));

      await page.keyboard.type('x');
      await drawn(page, ['late']);
      await frames(page);
      const after = await page.evaluate(() => window.harness.top('.lo-diffcomposer'));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a click on a thread lets a thread waiting above it come, and the one clicked stays under the pointer', async () => {
      const page = await open(layout);
      const lines = await onScreen(page);
      const late = lines[2]!.line;
      const clicked = lines[10]!.line;
      await page.evaluate(
        (line) => window.harness.threads([{ id: 'clicked', line, height: 80 }], true),
        clicked,
      );
      await frames(page);
      await page.evaluate(
        (at) =>
          window.harness.threads([
            { id: 'late', line: at.late, height: 120 },
            { id: 'clicked', line: at.clicked, height: 80 },
          ]),
        { clicked, late },
      );
      await frames(page);
      await expect(page.locator('[data-thread-id="late"]')).toHaveCount(0);
      const before = await page.evaluate(() => window.harness.top('[data-thread-id="clicked"]'));

      await page.click('[data-thread-id="clicked"] .card');
      await drawn(page, ['late', 'clicked']);
      await frames(page);
      const after = await page.evaluate(() => window.harness.top('[data-thread-id="clicked"]'));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('the view narrowing leaves the line at the top where it is', async () => {
      const page = await wrapping(layout);
      const before = await page.evaluate(() => window.harness.lineTop(20));

      await page.evaluate(() => window.harness.narrow(640));
      await frames(page);
      const after = await page.evaluate(() => window.harness.lineTop(20));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a thread above the screen that changes as the view narrows leaves the line at the top where it is', async () => {
      const page = await wrapping(layout);
      await page.evaluate(() =>
        window.harness.threads([{ id: 'above', line: 18, height: 60 }], true),
      );
      await frames(page);
      // Drawn, and all of it above the screen.
      await expect(page.locator('[data-thread-id="above"]')).toHaveCount(1);
      expect(
        await page.evaluate(() => window.harness.top('[data-thread-id="above"]')),
      ).toBeLessThan(-60);
      const before = await page.evaluate(() => window.harness.lineTop(20));

      // It grows with no input, so the view takes the change in a frame of its own, keeping what's
      // at the top of the screen; the view narrows at the start of that frame, as when a panel
      // opens beside it then.
      await page.evaluate(() => window.harness.growAsItNarrows('above', 140, 640));
      await frames(page);
      const after = await page.evaluate(() => window.harness.lineTop(20));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });

    test('a new line typed in a comment box as the view narrows leaves the box where it is', async () => {
      const page = await wrapping(layout);
      await page.evaluate(() => window.harness.compose(30));
      await frames(page);
      const box = () => page.evaluate(() => window.harness.top('.lo-diffcomposer'));
      const height = () =>
        page.locator('.lo-diffcomposer').evaluate((each) => each.getBoundingClientRect().height);
      const before = { top: await box(), height: await height() };

      // The box grows with the new line as the key is handled, at the width the key came at.
      await page.evaluate(() => window.harness.narrowOnKey(640));
      await page.keyboard.press('Enter');
      await frames(page);
      expect(await height()).toBeGreaterThan(before.height);
      expect(Math.abs((await box())! - before.top!)).toBeLessThan(1);
    });

    test('the cursor moved below the screen as the view narrows comes on screen', async () => {
      const page = await wrapping(layout);

      // The editor brings it on screen as it next measures, at the new width.
      await page.evaluate(() => {
        window.harness.cursor(80);
        window.harness.narrow(640);
      });
      await frames(page);
      expect(await page.evaluate(() => window.harness.cursorOnScreen())).toBe(true);
    });

    test('a jump is over once the layout changes, so the view narrowing after leaves the screen where it is', async () => {
      const page = await open(layout);
      await page.evaluate((shown) => window.harness.layout(shown), other(layout));
      await frames(page);
      const before = await lineTop(page, 20);

      await page.evaluate(() => window.harness.narrow(640));
      await frames(page);
      expect(Math.abs((await lineTop(page, 20))! - before!)).toBeLessThan(1);
    });

    // The reader's input as the view narrows, or as it's still putting back what the narrowing
    // moved: the narrowing is put back, the input's scroll never is.
    for (const when of ['as', 'after'] as const) {
      const narrowing = when === 'as' ? 'as the view narrows' : 'a frame after the view narrows';

      test(`\`Ctrl-d\` ${narrowing} scrolls half a screen from what the reader saw, the cursor staying on its row`, async () => {
        const page = await wrapping(layout, 0);
        const cursor = () => page.evaluate(() => window.harness.cursorTop());
        const before = { cursor: await cursor(), line: await lineTop(page, 40) };

        if (when === 'as') await page.evaluate(() => window.harness.narrowOnKey(640));
        else await narrowed(page);
        await page.keyboard.press('Control+d');
        await frames(page);
        expect(Math.abs((await cursor())! - before.cursor!)).toBeLessThan(1);
        expect(before.line! - (await lineTop(page, 40))!).toBeGreaterThan(200);
      });

      test(`the wheel ${narrowing} scrolls as far as it turns from what the reader saw`, async () => {
        const page = await wrapping(layout);
        await page.mouse.move(300, 300);
        const before = await lineTop(page, 40);

        if (when === 'as') await page.evaluate(() => window.harness.narrowOnWheel(640));
        else await narrowed(page);
        await page.mouse.wheel(0, 200);
        await frames(page);
        expect(Math.abs((await lineTop(page, 40))! - (before! - 200))).toBeLessThan(1);
      });

      test(`a jump ${narrowing} puts its line at the top`, async () => {
        const page = await wrapping(layout);

        // Made before the frame the view takes the narrowing in, there or as it starts.
        await page.evaluate((now) => {
          window.harness.narrow(640);
          if (now) window.harness.scrollTo(60);
          else requestAnimationFrame(() => window.harness.scrollTo(60));
        }, when === 'as');
        await frames(page);
        expect(Math.abs((await lineTop(page, 60))!)).toBeLessThan(1);
      });
    }
  });
}
