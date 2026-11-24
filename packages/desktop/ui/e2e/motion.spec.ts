// The moves in Chromium itself, with motion on: what jsdom can't show. A popup gives focus back the
// moment it's asked to close and only then fades; something in the flow opens, closes and turns
// back; and one switch, or the system's setting, turns every move off. Playwright answers "no
// preference" to `prefers-reduced-motion` unless a test asks otherwise, so the moves are on here
// whatever the machine's own setting.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('motion.tsx', 'Motion', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'moves' in window);
  return page;
}

/** What the popups have said as they were asked to close, oldest first. */
const closed = (page: Page) => page.evaluate(() => window.moves.closed);

/** The id of what has focus. */
const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

test('a dialog gives focus back as it’s asked to close, keeps its top edge between steps, and then leaves', async () => {
  const page = await open();
  await page.locator('#open-dialog').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Input is live from the first frame: the main button has focus as the dialog mounts.
  await expect(dialog.getByRole('button', { name: 'Sign in' })).toBeFocused();
  const top = async () => Math.round((await dialog.boundingBox())?.y ?? -1);
  // Where its top edge rests once it has come.
  await expect(dialog).not.toHaveAttribute('data-starting-style');
  await expect.poll(() => dialog.evaluate((panel) => panel.getAnimations().length)).toBe(0);
  const rests = await top();

  // A taller step grows downward.
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('GitHub didn’t answer.');
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect.poll(top).toBe(rests);

  await page.keyboard.press('Escape');
  // Still drawn, fading, and focus is already back where it was.
  expect(await closed(page)).toEqual([{ what: 'dialog', there: true, focus: 'open-dialog' }]);
  await expect(dialog).toHaveCount(0);
  // Its caller tried to focus a button in it as it left, which it refused, so focus stayed back.
  expect(await focused(page)).toBe('open-dialog');
});

test('a popover takes focus as it opens, and gives it back to its trigger as it closes', async () => {
  const page = await open();
  await page.locator('#open-popover').click();
  const popover = page.getByRole('dialog');
  await expect(popover).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
    .toBe(true);
  await page.keyboard.press('Escape');
  expect(await closed(page)).toEqual([{ what: 'popover', there: true, focus: 'open-popover' }]);
  await expect(popover).toHaveCount(0);
});

test('a name cut short shows whole as its tooltip, and one drawn whole shows none', async () => {
  const page = await open();
  const tooltip = page.locator('.tooltip');
  await page.locator('#cut').hover();
  await expect(tooltip).toHaveText('src/graphql/cost/estimate.ts');
  await expect(tooltip.locator('kbd')).toHaveCount(0);
  // Its neighbour's would come at once, with one just shown: drawn whole, it has none.
  await page.locator('#whole').hover();
  await expect(tooltip).toHaveCount(0);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  await expect(tooltip).toHaveCount(0);
});

test('a tooltip for a control in a dialog shows over the dialog and its scrim', async () => {
  const page = await open();
  await page.locator('#open-dialog').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const control = page.locator('#copy-code');
  await expect(control).toHaveAttribute('aria-keyshortcuts', 'y');
  await control.hover();
  const tooltip = page.locator('.tooltip');
  await expect(tooltip).toContainText('Copy the code');
  // What's drawn on top at its middle is the tooltip. It never takes the pointer, so it's asked
  // to here, where the page is asked what's on top.
  const onTop = await tooltip.evaluate((element) => {
    if (element instanceof HTMLElement) element.style.pointerEvents = 'auto';
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(top);
  });
  expect(onTop).toBe(true);
});

test('something in the flow opens, closes, and turns back when asked again before it has gone', async () => {
  const page = await open();
  const reply = page.locator('#reply');
  const box = page.locator('.move-open');
  const below = async () => Math.round((await page.locator('#below').boundingBox())?.y ?? -1);
  const rest = await below();

  await reply.click();
  await expect(page.locator('#replying')).toBeVisible();
  // Once it rests it's no longer clipped, and what's below it has moved down.
  await expect(box).not.toHaveAttribute('data-moving');
  expect(await below()).toBeGreaterThan(rest);

  await reply.click();
  await expect(box).toHaveCount(0);
  expect(await below()).toBe(rest);

  // Open, close, open, as a key pressed three times: the last one wins, and nothing queues.
  await page.evaluate(() => {
    const button = document.getElementById('reply');
    for (let press = 0; press < 3; press += 1) button?.click();
  });
  await expect(page.locator('#replying')).toBeVisible();
  await expect(box).not.toHaveAttribute('data-moving');
  await expect(box).not.toHaveAttribute('data-closed');
});

test('a thumb slides to the segment chosen, and a switch’s to its other end', async () => {
  const page = await open();
  const middle = (selector: string) =>
    page.evaluate((found) => {
      const box = document.querySelector(found)?.getBoundingClientRect();
      return box ? Math.round(box.left + box.width / 2) : -1;
    }, selector);
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const chosen = await middle('[role="tab"][aria-selected="true"]');
  // Within a pixel: each middle is rounded on its own.
  await expect
    .poll(async () => Math.abs((await middle('[role="tablist"] .move-slide')) - chosen))
    .toBeLessThanOrEqual(1);

  const track = page.getByRole('switch', { name: 'Merge when ready' });
  const before = await middle('[role="switch"] > span');
  await track.click();
  await expect(track).toBeChecked();
  await expect.poll(() => middle('[role="switch"] > span')).toBeGreaterThan(before);
});

test('a toast floats fixed to the window, and a long word wraps inside it', async () => {
  // How many show at once and how long each stays are the stack's own tests: here a toast would
  // be racing the clicks.
  const page = await open();
  await page.locator('#long-toast').click();
  const fit = await page.locator('.toast .line-clamp-3').evaluate((title) => ({
    over: title.scrollWidth - title.clientWidth,
    lines: Math.round(title.clientHeight / Number.parseFloat(getComputedStyle(title).lineHeight)),
    position: getComputedStyle(title.closest('.toast-floating')!).position,
  }));
  expect(fit).toEqual({ over: 0, lines: 3, position: 'fixed' });
});

/** How long the dialog's panel takes to come, as the page computes it. */
async function sheetDuration(page: Page): Promise<string> {
  await page.locator('#open-dialog').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog.evaluate((panel) => getComputedStyle(panel).transitionDuration);
}

test('one switch turns every move off, and without a call it follows the system’s setting', async () => {
  const page = await open();
  expect(await sheetDuration(page)).toBe('0.16s');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.evaluate(() => window.moves.setMotion('reduce'));
  expect(await page.evaluate(() => window.moves.reduced())).toBe(true);
  expect(await sheetDuration(page)).toBe('0s');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // What moves from a script shows where it would have ended.
  await page.locator('#play-unmeld').click();
  await expect(page.locator('#logo svg circle')).toHaveCount(1);
  await expect(page.locator('#logo svg ellipse')).toHaveCount(0);

  // Following the system again, which asks for no less motion, the moves are back, until the
  // system asks for less.
  await page.evaluate(() => window.moves.setMotion('system'));
  expect(await page.evaluate(() => window.moves.reduced())).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.moves.setMotion('system'));
  expect(await page.evaluate(() => window.moves.reduced())).toBe(true);
  expect(await sheetDuration(page)).toBe('0s');
});
