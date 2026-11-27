// What narrows in Chromium itself, where it's laid out: jsdom lays nothing out. An out-of-date
// overview's callout is one column only where its button doesn't fit beside its text, and a path
// wraps only after a slash.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('narrow.tsx', 'Narrow', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('#frame .lo-ov-stale');
  return page;
}

/** Where the callout's parts are, once its frame is `width` wide and laid out, in its own pixels. */
function callout(page: Page, width: number) {
  return page.evaluate(async (wide) => {
    document.querySelector<HTMLElement>('#frame')!.style.width = `${wide}px`;
    // What it gives up is measured as the frame is laid out, before it's painted.
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const box = document.querySelector<HTMLElement>('#frame .lo-ov-stale')!;
    const rect = (selector: string) => box.querySelector(selector)!.getBoundingClientRect();
    const [banner, icon, title, sub, button] = [
      box.getBoundingClientRect(),
      rect('.lo-i'),
      rect('.lo-ov-stale__title'),
      rect('.lo-ov-stale__sub'),
      rect('.lo-ov-stale__actions button'),
    ];
    return {
      gaveUp: box.getAttribute('data-gave-up') ?? '',
      height: banner.height,
      // The icon's middle on the title's, the button's top under what changed since.
      iconOff: icon.top + icon.height / 2 - (title.top + title.height / 2),
      under: button.top - sub.bottom,
      // Its left edge on the text's.
      left: button.left - title.left,
      // What's under the button, inside the callout: its padding alone.
      below: banner.bottom - button.bottom,
      padding: Number.parseFloat(getComputedStyle(box).paddingBottom),
      subLines:
        sub.height /
        Number.parseFloat(getComputedStyle(box.querySelector('.lo-ov-stale__sub')!).lineHeight),
      beside: button.left > title.right && button.top < sub.bottom,
    };
  }, width);
}

test('the callout keeps its button beside its text while it fits, and is one column once it doesn’t', async () => {
  const page = await open();
  for (const width of [680, 494]) {
    const at = await callout(page, width);
    expect(at.gaveUp, String(width)).toBe('');
    expect(at.beside, String(width)).toBe(true);
  }

  const narrow = await callout(page, 316);
  expect(narrow.gaveUp).toBe('beside');
  expect(narrow.beside).toBe(false);
  expect(Math.abs(narrow.iconOff)).toBeLessThanOrEqual(1);
  expect(narrow.under).toBeCloseTo(8, 0);
  expect(narrow.left).toBeCloseTo(0, 0);
  expect(narrow.below).toBeCloseTo(narrow.padding, 0);
  expect(narrow.subLines).toBeCloseTo(1, 1);

  // What changed since comes in its line, and nothing moves.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('say', { detail: '1 file changed' })),
  );
  await expect(page.locator('.lo-ov-stale__sub')).toHaveText('1 file changed');
  expect((await callout(page, 316)).height).toBe(narrow.height);

  // Wide again, the button is beside its text again.
  expect((await callout(page, 680)).gaveUp).toBe('');
});

test('a path wraps only after a slash, and inside a name only where the name is longer than the line', async () => {
  const page = await open();
  const lines = (box: string) =>
    page.locator(`${box} code`).evaluate((code) => {
      const line = Number.parseFloat(getComputedStyle(code).lineHeight);
      const names = [...code.querySelectorAll('span')].map((name) => ({
        text: name.textContent ?? '',
        lines: Math.round(name.getBoundingClientRect().height / line),
        top: name.getBoundingClientRect().top,
      }));
      return { names, rows: new Set(names.map((name) => name.top)).size };
    });
  const path = await lines('#path');
  // It wraps, and each name, hyphens, dots and spaces and all, is whole on its line.
  expect(path.rows).toBeGreaterThan(1);
  for (const name of path.names) expect(name.lines, name.text).toBe(1);

  const long = await lines('#long');
  expect(long.names.map((name) => name.lines)).toEqual([1, expect.any(Number), 1]);
  expect(long.names[1]!.lines).toBeGreaterThan(1);
});
