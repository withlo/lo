// An edge between panes, dragged in Chromium itself: jsdom lays nothing out, and has no pointer
// capture to keep a drag going outside the edge.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('panes.tsx', 'Panes', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The page, with the left panel at its default width, 300, and its edge's grip from 300 to 308. */
async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', '300');
  return page;
}

/** What the edge did, and the keys that reached the page, since this was last asked. */
function said(page: Page): Promise<string[]> {
  return page.evaluate(() => window.paneLog.splice(0));
}

/** The left panel's width as drawn. */
function leftWidth(page: Page): Promise<number> {
  return page.locator('#left').evaluate((left) => left.getBoundingClientRect().width);
}

test('the edge follows the pointer each frame, stops at its limits, and leaves focus where it was', async () => {
  const page = await open();
  const edge = page.getByRole('separator', { name: 'Resize left panel' });
  await page.locator('#row-button').focus();
  await page.mouse.move(304, 300);
  await page.mouse.down();
  // Drawn as the pointer moves, with no frame between.
  await page.mouse.move(354, 300);
  expect(await leftWidth(page)).toBe(350);
  await page.mouse.move(1000, 300);
  expect(await leftWidth(page)).toBe(480);
  await expect(edge).toHaveAttribute('data-at', 'max');
  expect(await page.evaluate(() => document.documentElement.dataset.loResizing)).toBe('w');
  // Over the middle, nothing takes the hover while the edge is dragged.
  expect(await page.locator('#open').evaluate((button) => button.matches(':hover'))).toBe(false);
  await page.mouse.move(200, 300);
  expect(await leftWidth(page)).toBe(220);
  expect(await page.evaluate(() => document.documentElement.dataset.loResizing)).toBe('e');
  await page.mouse.up();
  expect(await page.evaluate(() => document.documentElement.dataset.loResizing)).toBeUndefined();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('row-button');
  expect((await said(page)).at(-1)).toBe('end 220');
});

test('`Esc` puts it back where the press found it, and goes no further; a double-click puts it back to its default', async () => {
  const page = await open();
  await page.mouse.move(304, 300);
  await page.mouse.down();
  await page.mouse.move(404, 300);
  expect(await leftWidth(page)).toBe(400);
  await said(page);
  await page.keyboard.press('Escape');
  expect(await leftWidth(page)).toBe(300);
  expect(await said(page)).toEqual(['drag 300', 'end 300']);
  // The drag is over: the pointer moves nothing, and `Esc` is the keys' again.
  await page.mouse.move(450, 300);
  await page.mouse.up();
  expect(await leftWidth(page)).toBe(300);
  await page.keyboard.press('Escape');
  expect(await said(page)).toEqual(['key Escape']);

  await page.mouse.move(304, 300);
  await page.mouse.down();
  await page.mouse.move(404, 300);
  await page.mouse.up();
  expect(await leftWidth(page)).toBe(400);
  await page.mouse.dblclick(404, 300);
  expect(await leftWidth(page)).toBe(300);
  expect(await said(page)).toContain('reset');
});

test('let go near the window’s side, it closes the panel, which shows gone from there and keeps its width', async () => {
  const page = await open();
  await page.mouse.move(304, 300);
  await page.mouse.down();
  await page.mouse.move(400, 300);
  await page.mouse.up();
  expect(await leftWidth(page)).toBe(396);

  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.move(100, 300);
  await expect(page.locator('#left')).toBeHidden();
  // Back out of reach, it's there again, at its narrowest.
  await page.mouse.move(200, 300);
  await expect(page.locator('#left')).toBeVisible();
  expect(await leftWidth(page)).toBe(220);
  await page.mouse.move(40, 300);
  await page.mouse.up();
  await expect(page.locator('#left')).toHaveCount(0);
  expect((await said(page)).slice(-2)).toEqual(['end 396', 'close']);
  await page.locator('#open').click();
  expect(await leftWidth(page)).toBe(396);
});

test('the window losing focus ends a drag where it is', async () => {
  const page = await open();
  await page.mouse.move(304, 300);
  await page.mouse.down();
  await page.mouse.move(364, 300);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
  expect((await said(page)).at(-1)).toBe('end 360');
  await page.mouse.move(500, 300);
  await page.mouse.up();
  expect(await leftWidth(page)).toBe(360);
});

test('the edge draws nothing at rest, a line under the pointer, and the accent while pressed', async () => {
  const page = await open();
  const line = () =>
    page.getByRole('separator').evaluate((edge) => {
      const probe = document.createElement('div');
      document.body.append(probe);
      const name = (color: string) => {
        probe.style.backgroundColor = color;
        return getComputedStyle(probe).backgroundColor;
      };
      const drawn = getComputedStyle(edge, '::after').backgroundColor;
      const found =
        [
          ['border', name('var(--lo-border)')],
          ['accent', name('var(--lo-accent)')],
        ].find(([, color]) => color === drawn)?.[0] ?? drawn;
      probe.remove();
      return found;
    });
  await page.mouse.move(600, 300);
  await expect.poll(line).toBe('rgba(0, 0, 0, 0)');
  await page.mouse.move(304, 300);
  await expect.poll(line).toBe('border');
  await page.mouse.down();
  await expect.poll(line).toBe('accent');
  await page.mouse.up();
  await expect.poll(line).toBe('border');
});
