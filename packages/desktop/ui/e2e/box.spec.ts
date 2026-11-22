// The comment box in Chromium itself, where its foot is laid out: jsdom lays nothing out.

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
  harness = await buildPage('box.tsx', 'Comment box', style);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForFunction(() => 'box' in window);
  return page;
}

/** How the head's and the foot's controls sit in a box `width` wide. */
function foot(page: Page, width: number, vim: boolean) {
  return page.evaluate(
    async ([wide, on]) => {
      window.box.vim(on);
      window.box.width(wide);
      // What it gives up is measured as the frame is laid out, before it's painted.
      for (let frame = 0; frame < 2; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const frame = document.querySelector('#box [role="group"], #box > *')!;
      const edge = frame.getBoundingClientRect().right;
      const controls = [...frame.querySelectorAll<HTMLElement>('button, .mode-chip')].filter(
        (each) => each.getClientRects().length > 0,
      );
      const row = frame.querySelector('button[aria-label="Discard draft"]')!.parentElement!;
      const head = frame.querySelector('[role="tablist"]')!.closest('.give-up')!;
      /** How many lines `within`'s controls sit on. */
      const lines = (within: Element) =>
        new Set(
          controls
            .filter((each) => within.contains(each))
            .map((each) =>
              Math.round(
                each.getBoundingClientRect().top + each.getBoundingClientRect().height / 2,
              ),
            ),
        ).size;
      const words = (text: string) =>
        [...frame.querySelectorAll('span')].some(
          (each) => each.textContent === text && each.getClientRects().length > 0,
        );
      return {
        width: wide,
        vim: on,
        past: Math.round(
          Math.max(0, ...controls.map((each) => each.getBoundingClientRect().right - edge)),
        ),
        over: row.scrollWidth - row.clientWidth,
        rows: lines(row),
        heads: lines(head),
        label: words('Discard draft'),
        send: words('Send now'),
        add: words('Add to review'),
      };
    },
    [width, vim] as const,
  );
}

for (const vim of [false, true]) {
  test(`the head and the foot never wrap or run past their box, with Vim keys ${vim ? 'on' : 'off'}`, async () => {
    const page = await open();
    // A box beside the code is any of these widths: 256 is the narrowest a box side by side is.
    for (const width of [500, 410, 360, 330, 256, 200]) {
      const sits = await foot(page, width, vim);
      expect(sits, `${width}px`).toMatchObject({ past: 0, over: 0, rows: 1, heads: 1 });
      // The buttons keep their words down to the narrowest a box side by side is, or with Vim's
      // mode beside them a little wider, and then give them up for their icons, the filled one's
      // last.
      if (width >= (vim ? 330 : 256)) {
        expect(sits, `${width}px`).toMatchObject({ send: true, add: true });
      }
      if (!sits.add) expect(sits.send, `${width}px`).toBe(false);
    }
    expect(await foot(page, 500, vim)).toMatchObject({ label: true, send: true, add: true });
    expect(await foot(page, 200, vim)).toMatchObject({ label: false, send: false });
  });
}
