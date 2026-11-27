// An avatar's picture as Chromium loads it. Chromium keeps each picture a page has drawn by its
// address, though main serves it for nothing to keep (`no-store`): new avatars at the same address
// show the picture it had, without asking for it. Drawn again at a new address (`redrawPictures`),
// they fetch the picture anew. That's how a bot's picture that moved shows where it is now.

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('avatar.tsx', 'Avatar', utilities);

/** A picture `side` pixels a side. */
const picture = (side: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><rect width="${side}" height="${side}" fill="#6a5acd"/></svg>`;

test('avatars drawn again at a new address fetch their picture anew, and show what it is now', async () => {
  const app = await launch(await harness());
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('#avatars', { state: 'attached' });
    // The first fetch is the picture as it was; every one after, as it is now.
    let served = 0;
    await page.route('http://pictures.test/**', (route) => {
      served += 1;
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' },
        body: picture(served === 1 ? 2 : 3),
      });
    });
    const sides = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('#avatars img:not(.opacity-0)')].map(
          (img) => img.naturalWidth,
        ),
      );
    await page.evaluate(() => window.dispatchEvent(new Event('show')));
    await expect.poll(sides).toEqual([2, 2]);
    expect(served).toBe(1);
    // New avatars at the same address, though the picture there has changed: Chromium draws the
    // one it kept, without asking.
    await page.evaluate(() => {
      for (const img of document.querySelectorAll<HTMLImageElement>('#avatars img')) {
        img.dataset['before'] = '';
      }
      window.dispatchEvent(new Event('again'));
    });
    await page.waitForSelector('#avatars img[data-before]', { state: 'detached' });
    await expect.poll(sides).toEqual([2, 2]);
    expect(served).toBe(1);
    // At a new address, it's fetched anew.
    await page.evaluate(() => window.dispatchEvent(new Event('redraw')));
    await expect.poll(sides).toEqual([3, 3]);
    expect(served).toBe(2);
  } finally {
    await app.close();
  }
});
