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

/** What the header's first row had given up at one width, and how its title was drawn. */
interface Fitted {
  readonly width: number;
  readonly steps: readonly string[];
  readonly cut: boolean;
  readonly title: number;
}

/**
 * Narrows the header's frame from `from` px to `to` px, `step` px at a time, and says at each width
 * what its first row has given up and how its title is drawn. Each width takes one frame: the row
 * fits itself in its own resize observer, made before the one that waits for the frame, so it has
 * run by the time that one does.
 */
function sweep(page: Page, from: number, to: number, step = 20): Promise<Fitted[]> {
  return page.evaluate(
    async ({ start, end, by }) => {
      const frame = document.getElementById('header')!;
      const row = frame.querySelector('.give-up:has(h1)')!;
      const heading = frame.querySelector('h1')!;
      const seen: Fitted[] = [];
      for (let width = start; width >= end; width -= by) {
        frame.style.width = `${width}px`;
        await new Promise<void>((resolve) => {
          const sized = new ResizeObserver(() => {
            sized.disconnect();
            resolve();
          });
          sized.observe(frame);
        });
        seen.push({
          width,
          steps: (row.getAttribute('data-gave-up') ?? '').split(' ').filter(Boolean),
          cut: heading.scrollWidth > heading.clientWidth,
          title: heading.clientWidth,
        });
      }
      return seen;
    },
    { start: from, end: to, by: step },
  );
}

/** The first row's steps, in the order it takes them. */
const ORDER = ['keys', 'detail', 'cut', 'title'];

test('narrowed from 1440 to 600 px, the header’s first row gives up its key chips, then the merge status’s detail, then cuts its title, and its title is cut only after the first two', async () => {
  const page = await open();
  const seen: string[] = [];
  let before = 0;
  for (const { width, steps, cut, title } of await sweep(page, 1440, 600)) {
    // A step at a time, in its order, and none back as the row narrows.
    expect(steps, `${width} px`).toEqual(ORDER.slice(0, steps.length));
    expect(steps.length, `${width} px`).toBeGreaterThanOrEqual(before);
    before = steps.length;
    // Whole until the chips and the detail have gone; cut once they have and it still doesn't fit,
    // and at its least width once the status's words have gone too.
    expect(cut, `${width} px`).toBe(steps.includes('cut'));
    if (steps.includes('title')) expect(title, `${width} px`).toBeLessThanOrEqual(49);
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
  // Where it takes each step, narrowing.
  const fitted = await sweep(page, 1440, 300);
  const first = (count: number) => fitted.find(({ steps }) => steps.length >= count)!;
  // The key chips go, and the detail, still heard and in the tooltip; the title and the verdict
  // stay whole.
  expect(first(2).cut).toBe(false);
  expect(await at(page, first(2).width, TOP)).toEqual(['keys detail']);
  expect(await status(page)).toEqual({ apart: true, whole: true, heard: true });
  expect(await statusTip(page)).toContain('Ready to merge · Merge commit into comments/base');
  // At last the verdict, which leaves its dot beside "Submit review…", what it says its tooltip.
  expect(await at(page, first(4).width, TOP)).toEqual(['keys detail cut title']);
  const narrow = await status(page);
  expect([narrow.apart, narrow.heard]).toEqual([true, true]);
  expect(await statusTip(page)).toContain('Ready to merge · Merge commit into comments/base');
  // And back, as the room grows.
  expect(await at(page, 1440, TOP)).toEqual(['']);
});
