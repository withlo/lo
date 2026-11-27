// What a row gives up, in Chromium itself, where it's laid out: jsdom lays nothing out.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('giveup.tsx', 'Give up', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('#frame .give-up');
  return page;
}

/**
 * Makes the frame `width` wide, as a window or a panel beside it would, drawing nothing of it again,
 * and says what each row that gives up, `rows`, has given up once it's laid out: by default the
 * header's second row and the merge status's own.
 */
function at(page: Page, width: number, rows = '#frame .give-up:not(:has(h1))'): Promise<string[]> {
  return page.evaluate(
    async ({ wide, found }) => {
      const frame = document.querySelector<HTMLElement>(found.split(' ')[0]!)!;
      frame.style.width = `${wide}px`;
      // What it gives up is measured as the frame is laid out, before it's painted.
      for (let count = 0; count < 3; count += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return [...document.querySelectorAll(found)].map(
        (row) => row.getAttribute('data-gave-up') ?? '',
      );
    },
    { wide: width, found: rows },
  );
}

test('a row that gave something up has it back as the room beside it grows, though it’s sized to what it draws', async () => {
  const page = await open();
  // The header's branches, then the merge status's detail, each row alone beside a spacer.
  expect(await at(page, 1440)).toEqual(['', '']);
  expect(await at(page, 160)).toEqual(['branches', 'detail']);
  expect(await at(page, 1440)).toEqual(['', '']);
  // A step at a time: the detail comes back once there's room for it, then the branches.
  expect(await at(page, 240)).toEqual(['branches', '']);
  expect(await at(page, 160)).toEqual(['branches', 'detail']);
  expect(await at(page, 240)).toEqual(['branches', '']);
  expect(await at(page, 1440)).toEqual(['', '']);
});

/** The first row of the header in its own frame, which holds the merge status. */
const TOP = '#header .give-up:has(h1)';

/** Whether the merge status is drawn beside "Submit review…", not under it, and its verdict whole. */
function status(page: Page): Promise<{ apart: boolean; whole: boolean }> {
  return page.evaluate(() => {
    const [merge, submit] = [...document.querySelectorAll<HTMLElement>('#header button')];
    const verdict = merge!.querySelector('strong')!;
    return {
      apart: merge!.getBoundingClientRect().right <= submit!.getBoundingClientRect().left,
      whole: verdict.offsetWidth > 1 && verdict.scrollWidth <= verdict.clientWidth,
    };
  });
}

test('the header’s first row cuts its title, then gives up its key chips, the merge status’s detail and then its verdict, and nothing in it is drawn over another', async () => {
  const page = await open();
  expect(await at(page, 1440, TOP)).toEqual(['']);
  expect(await status(page)).toEqual({ apart: true, whole: true });
  // The title gives way first, keeping a few letters.
  expect(await at(page, 1000, TOP)).toEqual(['']);
  // Then the key chips go, and the detail; the verdict stays whole.
  const given = (await at(page, 720, TOP))[0]!.split(' ');
  expect(given).toContain('keys');
  expect(given).not.toContain('title');
  expect(await status(page)).toEqual({ apart: true, whole: true });
  // At last the verdict, which leaves its dot beside "Submit review…", the verdict its tooltip.
  expect(await at(page, 440, TOP)).toEqual(['keys detail title']);
  expect((await status(page)).apart).toBe(true);
  await page.locator('#header button').first().hover();
  await expect(page.locator('.tooltip')).toContainText('Ready to merge');
  // And back, as the room grows.
  expect(await at(page, 1440, TOP)).toEqual(['']);
});
