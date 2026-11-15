// The code components in Chromium itself, in both themes at the widths they sit at: the peek in the
// middle view's width, the references in the threads panel's, the hover at its own, the status bar
// at the window's least width and its default, and Settings' trust rows at a section's. What a real
// browser shows and jsdom can't: that the parts fit the room they're given, and run past it
// nowhere, in light as in dark.

import { fileURLToPath } from 'node:url';

import { Scanner } from '@tailwindcss/oxide';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { buildCss } from '../scripts/stylesheet.ts';
import { buildPage, launch } from './electron.ts';
import type { Scene, Theme } from './harness/codeui.tsx';

/** Where the page is built. */
let harness = '';

test.beforeAll(async () => {
  // The page has the utilities the components use, found as Tailwind finds them in the window.
  const base = fileURLToPath(new URL('..', import.meta.url));
  const scanner = new Scanner({
    sources: ['src/**/*', 'e2e/harness/**/*'].map((pattern) => ({ base, pattern, negated: false })),
  });
  const style = `${await buildCss(scanner.scan())}\nbody { margin: 0; }`;
  harness = await buildPage('codeui.tsx', 'Code components', style);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Where each scene sits, and how wide its place is: the widths the design names. */
const PLACES: readonly { scene: Scene; widths: readonly number[] }[] = [
  // The middle view, as wide as a window at its least leaves it, and as the default window does.
  { scene: 'peek', widths: [720, 980] },
  { scene: 'peek-single', widths: [720, 980] },
  // The threads panel's width.
  { scene: 'references', widths: [340] },
  { scene: 'references-empty', widths: [340] },
  // The card is 480 px wide, and the box has room for it.
  { scene: 'hover', widths: [520] },
  { scene: 'hover-bare', widths: [520] },
  { scene: 'hover-waiting', widths: [520] },
  // A window at its least, and at its default.
  { scene: 'status', widths: [720, 1280] },
  { scene: 'details', widths: [720] },
  // A section of Settings, at its widest.
  { scene: 'trust', widths: [760] },
];

async function open(): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'harness' in window);
  return page;
}

/** What the box and the card in it measure, once drawn. */
interface Fit {
  /** How much wider than the box its content is: 0 when it fits. */
  over: number;
  /** The widest thing the scene drew, which can't be wider than the box. */
  widest: number;
  box: number;
  /** The text color, to tell the themes apart. */
  color: string;
  /** The page's own horizontal scroll. */
  scrolls: boolean;
}

async function fit(page: Page, scene: Scene, theme: Theme, width: number): Promise<Fit> {
  // The window is as wide as the box, so a part wider than its box scrolls the page.
  await page.setViewportSize({ width, height: 600 });
  await page.evaluate((drawn) => window.harness.show(drawn.scene, drawn.theme, drawn.width), {
    scene,
    theme,
    width,
  });
  // Drawn, and laid out: two frames.
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  return page.evaluate(() => {
    const box = document.getElementById('root')!;
    const rect = box.getBoundingClientRect();
    let widest = 0;
    for (const element of document.querySelectorAll<HTMLElement>(
      '#root *, body > *:not(#root) *',
    )) {
      const own = element.getBoundingClientRect();
      // A part clipped by the part it's in, as a truncated name is, isn't drawn past it.
      const clipped = element.closest(
        '.truncate, .overflow-hidden, .overflow-auto, .typehover-part',
      );
      if (clipped && clipped !== element) continue;
      if (own.width > 0) widest = Math.max(widest, own.right - rect.left);
    }
    return {
      over: Math.max(0, box.scrollWidth - box.clientWidth),
      widest,
      box: rect.width,
      color: getComputedStyle(box).color,
      scrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
}

for (const { scene, widths } of PLACES) {
  for (const width of widths) {
    test(`${scene} fits ${width} px in both themes`, async () => {
      const page = await open();
      const colors: string[] = [];
      for (const theme of ['dark', 'light'] as const) {
        const result = await fit(page, scene, theme, width);
        expect(result.over, `${scene} in ${theme} runs past its box`).toBe(0);
        // Its popover, if it has one, is put where it fits too.
        expect(result.widest, `${scene} in ${theme} is wider than its box`).toBeLessThanOrEqual(
          result.box + 1,
        );
        expect(result.scrolls, `${scene} in ${theme} makes the page scroll`).toBe(false);
        colors.push(result.color);
      }
      // The light theme is drawn in light's colors, not the dark's.
      expect(colors[0]).not.toBe(colors[1]);
    });
  }
}

test('the hover card keeps inside a window narrower than it is', async () => {
  const page = await open();
  const result = await fit(page, 'hover', 'dark', 400);
  expect(result.widest).toBeLessThanOrEqual(401);
  const card = await page.evaluate(
    () => document.querySelector('[role="tooltip"]')!.getBoundingClientRect().width,
  );
  expect(card).toBeLessThanOrEqual(400 - 32);
});

test('a status item opens its details from the keyboard, which take focus, close on Esc and give it back', async () => {
  const page = await open();
  await page.evaluate(() => window.harness.show('status', 'dark', 1280));
  const item = page.getByRole('button', { name: 'Java failed' });
  await item.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog');
  await expect(details).toBeVisible();
  // The one thing to do has focus, and `Tab` reaches the log's button.
  await expect(details.getByRole('button', { name: 'Restart' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(details.getByRole('button', { name: 'Show the log' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(item).toBeFocused();
});
