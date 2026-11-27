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
  // A step at a time: the detail comes back once there's room for it, then the branches. The room
  // is the merge status whole and its spacer's 8 px, as fonts make it, with a few to spare.
  const room = await page.evaluate(
    () => Math.ceil(document.getElementById('status')!.getBoundingClientRect().width) + 12,
  );
  expect(await at(page, room)).toEqual(['branches', '']);
  expect(await at(page, 160)).toEqual(['branches', 'detail']);
  expect(await at(page, room)).toEqual(['branches', '']);
  expect(await at(page, 1440)).toEqual(['', '']);
});

/** The first row of the header in its own frame, which holds the merge status. */
const TOP = '#header .give-up:has(h1)';

/**
 * Whether the merge status is drawn beside "Submit review…", not under it, its verdict whole, and
 * its words, the verdict and the detail, there to be heard, drawn or not.
 */
function status(page: Page): Promise<{ apart: boolean; whole: boolean; heard: boolean }> {
  return page.evaluate(() => {
    const [merge, submit] = [...document.querySelectorAll<HTMLElement>('#header button')];
    const verdict = merge!.querySelector('strong')!;
    const detail = merge!.querySelector<HTMLElement>('[data-gives="detail"]')!;
    return {
      apart: merge!.getBoundingClientRect().right <= submit!.getBoundingClientRect().left,
      whole: verdict.offsetWidth > 1 && verdict.scrollWidth <= verdict.clientWidth,
      heard: [verdict, detail].every((each) => getComputedStyle(each).display !== 'none'),
    };
  });
}

/** What the merge status's tooltip says, pointed at. */
async function statusTip(page: Page): Promise<string> {
  await page.mouse.move(0, 0);
  await page.locator('#header button').first().hover();
  const tip = page.locator('.tooltip');
  await expect(tip).toBeVisible();
  return (await tip.textContent()) ?? '';
}

/** What the header's first row has given up, in order, at `width`, and how its title is drawn. */
async function top(page: Page, width: number) {
  const [gave = ''] = await at(page, width, TOP);
  const title = await page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>('#header h1')!;
    return { cut: heading.scrollWidth > heading.clientWidth, width: heading.clientWidth };
  });
  return { steps: gave.split(' ').filter(Boolean), title };
}

/** The first row's steps, in the order it takes them. */
const ORDER = ['keys', 'detail', 'cut', 'title'];

/**
 * Narrows the header's frame from `from` px, 10 px at a time, until its first row has given up
 * `count` steps, and says how wide it is then.
 */
async function narrowTo(page: Page, count: number, from = 1440): Promise<number> {
  for (let width = from; width >= 300; width -= 10) {
    if ((await top(page, width)).steps.length >= count) return width;
  }
  throw new Error(`The header's first row never gave up ${count} steps.`);
}

test('narrowed from 1440 to 600 px, the header’s first row gives up its key chips, then the merge status’s detail, then cuts its title, and its title is cut only after the first two', async () => {
  const page = await open();
  const seen: string[] = [];
  let before = 0;
  for (let width = 1440; width >= 600; width -= 10) {
    const { steps, title } = await top(page, width);
    // A step at a time, in its order, and none back as the row narrows.
    expect(steps, `${width} px`).toEqual(ORDER.slice(0, steps.length));
    expect(steps.length, `${width} px`).toBeGreaterThanOrEqual(before);
    before = steps.length;
    // Whole until the chips and the detail have gone; cut once they have and it still doesn't fit,
    // and at its least width once the status's words have gone too.
    expect(title.cut, `${width} px`).toBe(steps.includes('cut'));
    if (steps.includes('title')) expect(title.width, `${width} px`).toBeLessThanOrEqual(49);
    const said = steps.join(' ');
    if (seen.at(-1) !== said) seen.push(said);
  }
  // Every step but the status's words is taken by 600 px; they go only once the title is as short
  // as it gets, as the next test narrows it to.
  expect(seen.slice(0, 4)).toEqual(['', 'keys', 'keys detail', 'keys detail cut']);
  const { apart, heard } = await status(page);
  expect([apart, heard]).toEqual([true, true]);
});

test('the header’s first row says what it gave up in the merge status’s tooltip, and nothing in it is drawn over another', async () => {
  const page = await open();
  expect(await at(page, 1440, TOP)).toEqual(['']);
  expect(await status(page)).toEqual({ apart: true, whole: true, heard: true });
  expect(await statusTip(page)).toContain('Merge panel');
  // The key chips go, and the detail, still heard and in the tooltip; the title and the verdict
  // stay whole.
  const width = await narrowTo(page, 2);
  expect((await top(page, width)).title.cut).toBe(false);
  expect(await status(page)).toEqual({ apart: true, whole: true, heard: true });
  expect(await statusTip(page)).toContain('Ready to merge · Merge commit into comments/base');
  // At last the verdict, which leaves its dot beside "Submit review…", what it says its tooltip.
  await narrowTo(page, 4, width);
  const narrow = await status(page);
  expect([narrow.apart, narrow.heard]).toEqual([true, true]);
  expect(await statusTip(page)).toContain('Ready to merge · Merge commit into comments/base');
  // And back, as the room grows.
  expect(await at(page, 1440, TOP)).toEqual(['']);
});
