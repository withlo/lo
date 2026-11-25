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

test('a key chip draws its symbols as 12 px icons, and its names and letters as text', async () => {
  const page = await open();
  expect(new Set((await strokes(page, '[data-keys] kbd svg')).map(String))).toEqual(
    new Set(['12,1.25']),
  );
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-keys] kbd')].map((chip) => ({
      system: chip.closest<HTMLElement>('[data-keys]')?.dataset['keys'],
      text: chip.textContent,
      icons: chip.querySelectorAll('svg').length,
      // What it shows as text, leaving out each symbol's character, which is visually hidden.
      shown: [...chip.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(''),
    })),
  );
  // No chip shows a character outside the code font's Latin: a symbol is an icon.
  expect(chips.filter((chip) => !/^[\x20-\x7e]*$/.test(chip.shown))).toEqual([]);
  // On macOS a chord with every modifier is four icons and its letter, and Tab is an icon alone too.
  expect(chips).toContainEqual({ system: 'mac', text: '⌘⌃⌥⇧K', icons: 4, shown: 'K' });
  expect(chips).toContainEqual({ system: 'mac', text: '⇧⇥', icons: 2, shown: '' });
  expect(chips).toContainEqual({ system: 'mac', text: 'Esc', icons: 0, shown: 'Esc' });
  // On Linux only the arrows are icons; the rest are words.
  expect(
    new Set(
      chips.filter((chip) => chip.system === 'linux' && chip.icons > 0).map((chip) => chip.text),
    ),
  ).toEqual(new Set(['↑', '↓', '←', '→']));
  expect(chips).toContainEqual({
    system: 'linux',
    text: 'Ctrl+Shift+P',
    icons: 0,
    shown: 'Ctrl+Shift+P',
  });
});
