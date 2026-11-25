// `EmptyState` as Chromium lays it out, which jsdom doesn't: its text at most 320 px wide, its
// icon alone in a box too narrow for its words, a column that scrolls in a box too short for it,
// and a list's buttons going under its words in a narrow row.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('empty.tsx', 'Empty states', utilities);

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

/** The dark sheet's box called `name`. */
const box = (page: Page, name: string) => page.locator(`[data-sheet="dark"] [data-box="${name}"]`);

test('its text keeps to 320 px however wide its box, centred in it', async () => {
  const page = await open();
  const wide = box(page, 'view-wide');
  const title = await wide.locator('p').first().boundingBox();
  const frame = await wide.boundingBox();
  expect(title!.width).toBeLessThanOrEqual(320);
  expect(Math.abs(title!.x + title!.width / 2 - (frame!.x + frame!.width / 2))).toBeLessThan(1);
  // In a view, the icon is 24 px over the title, 12 px above it.
  const icon = await wide.locator('svg').boundingBox();
  expect([icon!.width, Math.round(title!.y - icon!.y - icon!.height)]).toEqual([24, 12]);
});

test('in a box under 160 px wide it’s its icon alone, named by its title, which its tooltip shows', async () => {
  const page = await open();
  const narrow = box(page, 'narrow');
  await expect(narrow.locator('p')).toHaveCount(0);
  await expect(narrow.getByRole('button')).toHaveCount(0);
  const icon = narrow.getByRole('img', { name: 'No threads yet' });
  await expect(icon).toBeVisible();
  await icon.hover();
  await expect(page.locator('.tooltip')).toHaveText('No threads yet');

  // Widened, its words come back.
  await narrow.evaluate((element) => {
    element.style.width = '200px';
  });
  await expect(narrow.locator('p')).toHaveText('No threads yet');
  await expect(narrow.getByRole('img')).toHaveCount(0);
});

test('in a box too short for it, it starts at the top and scrolls, and the box keeps its height', async () => {
  const page = await open();
  const short = box(page, 'short');
  const frame = (await short.boundingBox())!;
  const column = short.locator('[data-lo-empty]');
  const icon = (await column.locator('svg').first().boundingBox())!;
  expect(frame.height).toBe(120);
  // Its padding, then the icon: never above the top, where it couldn't be scrolled to.
  expect(Math.round(icon.y - frame.y)).toBe(24 + 1);
  expect(
    await column.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBeTruthy();
});

test('a list’s buttons sit at the end of its row, and under its words in a row under 480 px', async () => {
  const page = await open();
  const atEnd = async (name: string) => {
    const row = box(page, name);
    const text = (await row.locator('p').first().boundingBox())!;
    const button = (await row.getByRole('button').boundingBox())!;
    return button.y > text.y + text.height;
  };
  expect(await atEnd('list')).toBe(false);
  expect(await atEnd('list-narrow')).toBe(true);
});
