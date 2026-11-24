// The code components in Chromium itself, in both themes at the widths they sit at: the peek in the
// middle view's width and in a place narrower than it, the references in the threads panel's, the hover at its own, the status bar
// at the window's least width and its default, and Settings' trust rows at a section's. What a real
// browser shows and jsdom can't: that the parts fit the room they're given, and run past it
// nowhere, in light as in dark.

import type { ElectronApplication, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';
import type { Scene, Theme } from './harness/codeui.tsx';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('codeui.tsx', 'Code components', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** Where each scene sits, and how wide its place is: the widths the design names. */
const PLACES: readonly { scene: Scene; widths: readonly number[] }[] = [
  // The middle view, as wide as a window at its least leaves it, and as the default window does.
  { scene: 'peek', widths: [340, 480, 720, 980] },
  { scene: 'peek-single', widths: [340, 720, 980] },
  { scene: 'peek-syntax', widths: [340, 720] },
  // The threads panel's width.
  { scene: 'references', widths: [340] },
  { scene: 'references-empty', widths: [340] },
  // The card is 480 px wide, and the box has room for it.
  { scene: 'hover', widths: [520] },
  { scene: 'hover-bare', widths: [520] },
  { scene: 'hover-long', widths: [520] },
  { scene: 'hover-waiting', widths: [520] },
  // A window at its least, and at its default.
  { scene: 'status', widths: [720, 1280] },
  { scene: 'details', widths: [720] },
  // A section of Settings, at its widest.
  { scene: 'trust', widths: [760] },
];

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'parts' in window);
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
  /** Each part that scrolls sideways for want of room, as it would show a scrollbar. */
  sideways: string[];
}

async function fit(page: Page, scene: Scene, theme: Theme, width: number): Promise<Fit> {
  // The window is as wide as the box, so a part wider than its box scrolls the page.
  await page.setViewportSize({ width, height: 600 });
  await page.evaluate((drawn) => window.parts.show(drawn.scene, drawn.theme, drawn.width), {
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
    // A part that can scroll sideways, and has more than it shows, is too narrow for what's in it.
    const sideways = [...document.querySelectorAll<HTMLElement>('#root *')]
      .filter((element) => {
        const { overflowX } = getComputedStyle(element);
        return (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .map((element) => `${element.localName}.${element.className}`);
    return {
      sideways,
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
        expect(result.sideways, `${scene} in ${theme} has a part that scrolls sideways`).toEqual(
          [],
        );
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

/** Where the parts of the peek that the layout moves are, once drawn. */
async function layout(page: Page, scene: Scene, width: number) {
  await fit(page, scene, 'dark', width);
  return page.evaluate(() => {
    const [list, code, go, close] = [
      '[role="listbox"]',
      '[role="dialog"] > .peek > :nth-child(3)',
      '.peek-go',
      '.peek-close',
    ].map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw new Error(`The page has no ${selector}.`);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const head = document.querySelector<HTMLElement>('[role="dialog"] > .peek > :first-child')!;
    const counted = head.querySelector<HTMLElement>('.truncate')!;
    return {
      list: list!,
      code: code!,
      go: go!,
      close: close!,
      // Whether the name and the count are shown whole, not cut short by a truncating part.
      whole: counted.scrollWidth <= counted.clientWidth,
      text: counted.textContent,
    };
  });
}

test('a wide peek has its answers beside its code', async () => {
  const page = await open();
  const wide = await layout(page, 'peek', 720);
  expect(wide.list.right).toBeLessThanOrEqual(wide.code.left + 1);
  expect(wide.list.right - wide.list.left).toBeCloseTo(250, 0);
  expect(wide.whole).toBe(true);
});

test('a narrow peek stacks its answers above its code, and keeps the count in its head', async () => {
  const page = await open();
  for (const width of [340, 480]) {
    const narrow = await layout(page, 'peek', width);
    expect(narrow.list.bottom, `at ${width} px the answers sit above the code`).toBeLessThanOrEqual(
      narrow.code.top + 1,
    );
    // The code has the whole width, not what a column leaves it.
    expect(narrow.code.right - narrow.code.left).toBeGreaterThan(width - 40);
    expect(narrow.text, `at ${width} px`).toContain('2 definitions');
    expect(narrow.whole, `at ${width} px the head shows the name and the count whole`).toBe(true);
    // Where the head has no room for both buttons beside the name, the way to close stays on its
    // first row and the way to go wraps below it, so the name and the count aren't cut for it.
    if (width === 340) {
      expect(
        narrow.close.bottom,
        `at ${width} px the way to go is on its own row`,
      ).toBeLessThanOrEqual(narrow.go.top + 1);
    }
  }
});

test('Tab goes past a hover whose docs hold links, code and a long signature', async () => {
  const page = await open();
  const result = await fit(page, 'hover-long', 'dark', 520);
  expect(result.over).toBe(0);
  await page.locator('#before').focus();
  await page.keyboard.press('Tab');
  // Nothing in the card takes focus: not a link, the signature or the code block that overflow.
  await expect(page.locator('#after')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#before')).toBeFocused();
  // Both of its parts are taller than the card shows, so each is a scroller, which Chromium would
  // make a stop for `Tab` had it not been told otherwise.
  const scrollers = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('[role="tooltip"] .typehover-part')].filter(
        (part) => part.scrollHeight > part.clientHeight,
      ).length,
  );
  expect(scrollers).toBe(2);
  // Its parts wrap at the card's width rather than scrolling sideways.
  const sideways = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="tooltip"] *')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => `${element.localName}.${element.className}`),
  );
  expect(sideways).toEqual([]);
});

test('a click or a selection in the hover leaves focus where it was', async () => {
  const page = await open();
  await fit(page, 'hover-long', 'dark', 520);
  const focused = () => page.evaluate(() => document.activeElement?.id);
  await page.locator('#before').focus();
  // A click on the signature, on the docs' text and on its code each lands on text, not a stop.
  await page.locator('[role="tooltip"] .typehover-part').first().click();
  expect(await focused()).toBe('before');
  await page.locator('.typehover-docs p').first().click();
  expect(await focused()).toBe('before');
  await page.locator('.typehover-docs pre').click();
  expect(await focused()).toBe('before');
  // Selecting text works all the same: a paragraph by a triple click, to copy.
  await page.locator('.typehover-docs p').nth(1).click({ clickCount: 3 });
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toContain(
    'A path of',
  );
  expect(await focused()).toBe('before');
});

test('the wheel scrolls a hover’s docs, which no key or click reaches', async () => {
  const page = await open();
  await fit(page, 'hover-long', 'dark', 520);
  const docs = page.locator('.typehover-docs');
  const box = (await docs.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await docs.evaluate((part) => part.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 80);
  await expect.poll(() => docs.evaluate((part) => part.scrollTop)).toBeGreaterThan(0);
});
