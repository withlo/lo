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

/** How the foot's controls sit in a box `width` wide. */
function foot(page: Page, width: number, vim: boolean) {
  return page.evaluate(
    ([wide, on]) => {
      window.box.vim(on);
      window.box.width(wide);
      const frame = document.querySelector('#box [role="group"], #box > *')!;
      const edge = frame.getBoundingClientRect().right;
      const controls = [...frame.querySelectorAll<HTMLElement>('button, .mode-chip')].filter(
        (each) => each.getClientRects().length > 0,
      );
      const row = frame.querySelector('button[aria-label="Discard draft"]')!.parentElement!;
      return {
        width: wide,
        vim: on,
        past: Math.round(
          Math.max(0, ...controls.map((each) => each.getBoundingClientRect().right - edge)),
        ),
        over: row.scrollWidth - row.clientWidth,
        rows: new Set(
          controls
            .filter((each) => row.contains(each))
            .map((each) =>
              Math.round(
                each.getBoundingClientRect().top + each.getBoundingClientRect().height / 2,
              ),
            ),
        ).size,
        label: [...row.querySelectorAll('span')].some(
          (each) => each.textContent === 'Discard draft' && each.getClientRects().length > 0,
        ),
      };
    },
    [width, vim] as const,
  );
}

for (const vim of [false, true]) {
  test(`the foot never runs past its box, with Vim keys ${vim ? 'on' : 'off'}`, async () => {
    const page = await open();
    // A box beside the code is any of these widths; the narrowest is under its buttons' own.
    for (const width of [500, 410, 360, 330, 250, 200]) {
      const sits = await foot(page, width, vim);
      expect(sits, `${width}px`).toMatchObject({ past: 0, over: 0 });
      // The labels go before the row wraps, and the row wraps only once they have.
      if (sits.rows > 1) expect(sits.label, `${width}px`).toBe(false);
    }
    expect((await foot(page, 500, vim)).rows).toBe(1);
  });
}
