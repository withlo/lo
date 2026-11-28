// A pane's end, kept as what's at it shrinks, in Chromium itself: jsdom lays nothing out, and has no
// scroll to pull back.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('ends.ts', 'Ends');

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('#box');
  return page;
}

test('the box at the end shrinks, and nothing on screen moves; the room goes as it’s scrolled off screen', async () => {
  const page = await open();
  // Twenty rows of 40 and the box of 200, in a pane of 400: 600 to scroll.
  const end = await page.evaluate(() => window.ends.scroll(600));
  expect(end).toEqual({ scroll: 600, end: 600, row: -240, box: 200 });
  // 140 px shorter: the browser would pull the scroll back by 140, and every row down with it.
  expect(await page.evaluate(() => window.ends.shrink(60))).toEqual(end);
  // Scrolled up 50, the rows move 50, and the room under the screen goes.
  expect(await page.evaluate(() => window.ends.scroll(550))).toEqual({
    scroll: 550,
    end: 550,
    row: -190,
    box: 250,
  });
  // Past the room, what's left to scroll is the rows and the box.
  expect(await page.evaluate(() => window.ends.scroll(300))).toEqual({
    scroll: 300,
    end: 460,
    row: 60,
    box: 500,
  });
});

test('away from the end, the box shrinks as it would, and the end comes no nearer than the screen’s foot', async () => {
  const page = await open();
  await page.evaluate(() => window.ends.scroll(500));
  // 100 of the 140 was under the screen.
  expect(await page.evaluate(() => window.ends.shrink(60))).toEqual({
    scroll: 500,
    end: 500,
    row: -140,
    box: 300,
  });
});
