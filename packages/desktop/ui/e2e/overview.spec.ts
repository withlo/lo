// The overview's terms in Chromium itself, where focus moves as it does for a reader: `Tab` from a
// term with its card open goes on to what follows it, as it does with the card closed, and a card
// closed with `Esc` stays closed when the window loses focus and gets it back, until focus has
// been somewhere else.

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { buildPage, launch } from './electron.ts';

/** Where the page is built. */
let harness = '';

test.beforeAll(async () => {
  harness = await buildPage('overview.tsx', 'Overview');
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open() {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForSelector('.lo-ov');
  return page;
}

test('Tab goes from each term to the next link and back, its card opening and closing', async () => {
  const page = await open();
  await page.focus('#start');
  /** What has focus, and the open card's term, if a card is open. */
  const where = () =>
    page.evaluate(() => ({
      focus: document.activeElement?.textContent ?? '',
      // A card closing stays a frame, marked closed.
      card: document.querySelector('.lo-hovercard[data-open] .lo-hovercard__term')?.textContent,
    }));

  const forward = [
    { focus: 'bucket', card: 'Bucket' },
    { focus: 'tokens', card: 'Token' },
    { focus: 'the limiter', card: undefined },
    { focus: 'the docs', card: undefined },
    { focus: 'End', card: undefined },
  ];
  for (const stop of forward) {
    await page.keyboard.press('Tab');
    await expect.poll(where).toEqual(stop);
  }

  const back = [];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('Shift+Tab');
    back.push((await where()).focus);
  }
  expect(back).toEqual(['the docs', 'the limiter', 'tokens', 'bucket', 'Start']);
});

test('Esc closes a term’s card and leaves focus on the term, and Tab still goes on', async () => {
  const page = await open();
  await page.focus('#start');
  await page.keyboard.press('Tab');
  const card = page.locator('.lo-hovercard[data-open]');
  await expect(card).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Base UI takes a closed card out of the page on the next frame. This window is never shown,
  // and while other windows draw on the same display, as the app's smoke test does in CI, its
  // frames can come seconds apart, so what's asked is that the card closed, not that it's gone.
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('bucket');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('tokens');
});

/**
 * The page losing focus and getting it back, as it does when the reader switches windows, without
 * showing the window: DevTools stops holding the page focused, the window's view gives up focus,
 * and DevTools holding it focused again gives it back. Each element that loses focus as the window
 * does is counted, by what it says.
 */
async function windowFocus(page: Page) {
  const devtools = await page.context().newCDPSession(page);
  const focused = () => page.evaluate(() => document.hasFocus());
  await page.evaluate(() => {
    const blurred: string[] = [];
    Reflect.set(window, 'blurred', blurred);
    document.addEventListener(
      'blur',
      (event) => {
        if (event.target instanceof Element) blurred.push(event.target.textContent ?? '');
      },
      true,
    );
  });
  const blurred = () =>
    page.evaluate(() => {
      const seen: unknown = Reflect.get(window, 'blurred');
      return Array.isArray(seen) ? seen.map(String) : [];
    });
  const leave = async () => {
    await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blurWebView());
    await expect.poll(focused).toBe(false);
  };
  const back = async () => {
    await devtools.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await expect.poll(focused).toBe(true);
  };
  /** Away and back, `term` blurred as the window went, and left the focused element. */
  const away = async (term: string) => {
    const before = (await blurred()).length;
    await leave();
    await expect.poll(async () => (await blurred()).slice(before)).toEqual([term]);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(term);
    await back();
  };
  return { leave, back, away };
}

test('a card closed with Esc stays closed when the window loses focus and gets it back', async () => {
  const page = await open();
  const card = page.locator('.lo-hovercard[data-open]');
  const { away } = await windowFocus(page);

  await page.focus('#start');
  await page.keyboard.press('Tab');
  await expect(card).toHaveCount(1);
  // Without `Esc`, the card comes back with the window, as focus does.
  await away('bucket');
  await expect(card).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await away('bucket');
  // Focus comes back to the term as the page gets focus, before `away` sees it has: a card that
  // opened again would be open now.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('bucket');
  expect(await card.count()).toBe(0);
});

test('a card closed with Esc opens again once focus has been elsewhere, moved there while the window was away', async () => {
  const page = await open();
  const card = page.locator('.lo-hovercard[data-open]');
  const { leave, back } = await windowFocus(page);

  await page.focus('#start');
  await page.keyboard.press('Tab');
  await expect(card).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  await leave();
  await page.evaluate(() => document.getElementById('start')?.focus());
  await back();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('start');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('bucket');
  await expect(card).toHaveCount(1);
});
