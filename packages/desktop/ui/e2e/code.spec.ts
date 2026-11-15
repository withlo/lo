// The code view in Chromium itself, where lines and threads take the room they're drawn in: what's
// held on screen for the reader's next input comes with it, and what they read stays where it is,
// side by side and inline: the cursor's line as `j` moves it, the comment box they type in, and the
// thread they click. A change the view takes on its own as the view narrows, lines wrapping anew,
// leaves the line at the top of the screen where it is.

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
 * The page, its view in `layout`, new line 20 at the top of the screen, and the first `wrapped` lines
 * long enough to wrap.
 */
async function open(layout: DiffLayout, wrapped = 0): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  await page.evaluate(
    ({ shown, lines }) => {
      window.harness.open(shown, lines);
      window.harness.scrollTo(20);
    },
    { shown: layout, lines: wrapped },
  );
  await frames(page);
  return page;
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

    test('a thread below the screen that changes as the view narrows leaves the line at the top where it is', async () => {
      // The lines above the top of the screen wrap onto more rows as the view narrows, which moves
      // the lines on screen down until the view puts them back.
      const page = await open(layout, 19);
      await page.evaluate(() => {
        window.harness.threads([{ id: 'below', line: 60, height: 60 }], true);
        // The reader's cursor on a line on screen: the jump that put line 20 at the top is over.
        window.harness.cursor(25);
      });
      await frames(page);
      await expect(page.locator('[data-thread-id="below"]')).toHaveCount(1);
      const before = await page.evaluate(() => window.harness.lineTop(20));

      // It grows with no input, so the view takes the change in a frame of its own, keeping what's
      // at the top of the screen; the view narrows at the start of that frame, as when a panel
      // opens beside it then.
      await page.evaluate(() => window.harness.growAsItNarrows('below', 140, 640));
      await frames(page);
      const after = await page.evaluate(() => window.harness.lineTop(20));
      expect(Math.abs(after! - before!)).toBeLessThan(1);
    });
  });
}
