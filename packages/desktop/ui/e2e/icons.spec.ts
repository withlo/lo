// The icons' strokes in Chromium itself, where the stylesheet applies: jsdom applies none. Each size
// sets its stroke in pixels, on Lucide's 24 grid, and an icon still drawn by hand on a 16 grid keeps
// the stroke it had.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('icons.tsx', 'Icons', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('[data-drawn]');
  return page;
}

/**
 * Each svg `selector` matches, as its box's width in px and its stroke as drawn on screen, in px:
 * its stroke on its grid, scaled to its box.
 */
function strokes(page: Page, selector: string): Promise<[number, number][]> {
  return page.evaluate((matching) => {
    return [...document.querySelectorAll<SVGSVGElement>(matching)].map((svg) => {
      const width = svg.getBoundingClientRect().width;
      const grid = svg.viewBox.baseVal.width;
      const stroke = Number.parseFloat(getComputedStyle(svg).strokeWidth);
      return [width, Math.round((stroke * width * 100) / grid) / 100];
    });
  }, selector);
}

test('each size draws its stroke in pixels, and an icon drawn by hand keeps its own', async () => {
  const page = await open();
  for (const [size, stroke] of [
    [12, 1.25],
    [14, 1.25],
    [16, 1.5],
    [24, 1.5],
  ]) {
    const drawn = await strokes(page, `[data-size="${size}"] svg`);
    expect(drawn.length).toBeGreaterThan(0);
    expect(new Set(drawn.map((each) => each.join(' ')))).toEqual(new Set([`${size} ${stroke}`]));
  }
  // Beside small text and beside text-ui, the characters are icons of those sizes.
  expect(new Set((await strokes(page, '[data-glyphs="12"] svg')).map(String))).toEqual(
    new Set(['12,1.25']),
  );
  expect(new Set((await strokes(page, '[data-glyphs="14"] svg')).map(String))).toEqual(
    new Set(['14,1.25']),
  );
  // Drawn by hand on a 16 grid: 1.5 on its grid at 16 and 14 px, and 1.75 at 12, as before.
  expect((await strokes(page, '[data-drawn] svg')).slice(0, 3)).toEqual([
    [16, 1.5],
    [14, 1.31],
    [12, 1.31],
  ]);
});
