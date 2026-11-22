// The moves in Chromium itself, with motion on: what jsdom can't show. A popup gives focus back the
// moment it's asked to close and only then fades; something in the flow opens, closes and turns
// back; a jump scrolls its pane and nothing else; and one switch, or the system's setting, turns
// every move off. Playwright answers "no preference" to `prefers-reduced-motion` unless a test asks
// otherwise, so the moves are on here whatever the machine's own setting.

import { fileURLToPath } from 'node:url';

import { Scanner } from '@tailwindcss/oxide';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { buildCss } from '../scripts/stylesheet.ts';
import { buildPage, launch } from './electron.ts';

/** Where the page is built. */
let harness = '';

test.beforeAll(async () => {
  const base = fileURLToPath(new URL('..', import.meta.url));
  const scanner = new Scanner({
    sources: ['src/**/*', 'e2e/harness/**/*'].map((pattern) => ({ base, pattern, negated: false })),
  });
  const style = `${await buildCss(scanner.scan())}\nbody { margin: 0; }`;
  harness = await buildPage('motion.tsx', 'Motion', style);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(harness);
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
  await expect.poll(top).toBe(96);

  // A taller step grows downward.
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('GitHub didn’t answer.');
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect.poll(top).toBe(96);

  await page.keyboard.press('Escape');
  // Still drawn, fading, and focus is already back where it was.
  expect(await closed(page)).toEqual([{ what: 'dialog', there: true, focus: 'open-dialog' }]);
  await expect(dialog).toHaveCount(0);
  expect(await focused(page)).toBe('open-dialog');
});

test('a menu gives focus back and runs what was chosen as it starts to leave', async () => {
  const page = await open();
  const row = page.locator('#row');
  await row.focus();
  // Opened from the keyboard, its first action is ready for ⏎.
  await page.keyboard.press('m');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await closed(page)).toEqual([{ what: 'menu', there: true, focus: 'row', chosen: 'show' }]);
  await expect(menu).toHaveCount(0);

  // Opened with the pointer and closed by a press outside it, focus goes back all the same.
  await row.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.mouse.click(600, 500);
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
  expect((await closed(page)).at(-1)).toMatchObject({ what: 'menu', focus: 'row' });
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

test('a tooltip names a control under the pointer, with its key', async () => {
  const page = await open();
  await page.locator('#hinted').hover();
  const tooltip = page.locator('.tooltip');
  await expect(tooltip).toContainText('Next unread file');
  await expect(tooltip.locator('kbd')).toHaveCount(2);
  await page.mouse.move(700, 500);
  await expect(tooltip).toHaveCount(0);
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

test('toasts float fixed to the window, three at most, and a long word wraps inside one', async () => {
  const page = await open();
  for (let count = 0; count < 4; count += 1) await page.locator('#toast').click();
  const toasts = page.locator('.toast');
  await expect(toasts).toHaveCount(3);
  await expect(toasts.last()).toContainText('Merged #4');
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('.toast-floating')!).position,
    ),
  ).toBe('fixed');

  await page.locator('#long-toast').click();
  await expect(toasts).toHaveCount(1);
  const fit = await toasts.locator('.line-clamp-3').evaluate((title) => ({
    over: title.scrollWidth - title.clientWidth,
    lines: Math.round(title.clientHeight / Number.parseFloat(getComputedStyle(title).lineHeight)),
  }));
  expect(fit).toEqual({ over: 0, lines: 3 });
});

test('the mark plays once and rests, in the color of each theme', async () => {
  const page = await open();
  await page.locator('#play-kiss').click();
  const logo = page.locator('#logo svg');
  // While it plays, the ball is an ellipse, drawn blurred and crisp.
  await expect(logo.locator('ellipse')).toHaveCount(2);
  await expect.poll(() => closed(page)).toMatchObject([{ what: 'logo kiss' }]);
  await expect(logo.locator('circle')).toHaveCount(1);

  const fill = () =>
    logo
      .locator('g')
      .first()
      .evaluate((group) => getComputedStyle(group).fill);
  await page.evaluate(() => window.moves.theme('dark'));
  const chalk = await fill();
  await page.evaluate(() => window.moves.theme('light'));
  expect(await fill()).not.toBe(chalk);
});

test('a jump scrolls its own pane, and nothing around it', async () => {
  const page = await open();
  await page.evaluate(() => window.moves.reveal('line-four'));
  const at = await page.evaluate(() => ({
    pane: document.getElementById('pane')!.scrollTop > 0,
    line: Math.round(
      document.getElementById('line-four')!.getBoundingClientRect().top -
        document.getElementById('pane')!.getBoundingClientRect().top,
    ),
    window: document.documentElement.scrollTop + document.body.scrollTop,
    shell: document.getElementById('root')!.scrollTop,
    landed: document.getElementById('line-four')!.classList.contains('move-land'),
  }));
  expect(at).toEqual({ pane: true, line: 0, window: 0, shell: 0, landed: true });
  // The mark fades and is taken off.
  await expect(page.locator('#line-four')).not.toHaveClass(/move-land/);
});

/** How long the dialog's panel takes to come, as the page computes it. */
async function sheetDuration(page: Page): Promise<string> {
  await page.locator('#open-dialog').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog.evaluate((panel) => getComputedStyle(panel).transitionDuration);
}

test('one switch turns every move off', async () => {
  const page = await open();
  expect(await sheetDuration(page)).toBe('0.16s');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.evaluate(() => window.moves.setMotion('reduce'));
  expect(await page.evaluate(() => window.moves.reduced())).toBe(true);
  expect(await sheetDuration(page)).toBe('0.001s');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // What moves from a script shows where it would have ended.
  await page.locator('#play-unmeld').click();
  await expect(page.locator('#logo svg circle')).toHaveCount(1);
  await expect(page.locator('#logo svg ellipse')).toHaveCount(0);
});

test('without a call it follows the system’s setting', async () => {
  const page = await open();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.moves.setMotion('system'));
  expect(await page.evaluate(() => window.moves.reduced())).toBe(true);
  expect(await sheetDuration(page)).toBe('0.001s');
});
