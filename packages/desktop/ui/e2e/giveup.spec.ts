// What a row gives up, in Chromium itself, where it's laid out: jsdom lays nothing out.

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
  harness = await buildPage('giveup.tsx', 'Give up', style);
});

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(harness);
  const page = await app.firstWindow();
  await page.waitForSelector('#frame .give-up');
  return page;
}

/**
 * Makes the header's frame `width` wide, as a window or a panel beside it would, drawing nothing of
 * it again, and says what each row that gives up has given up once it's laid out.
 */
function at(page: Page, width: number): Promise<string[]> {
  return page.evaluate(async (wide) => {
    document.querySelector<HTMLElement>('#frame')!.style.width = `${wide}px`;
    // What it gives up is measured as the frame is laid out, before it's painted.
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return [...document.querySelectorAll('#frame .give-up')].map(
      (row) => row.getAttribute('data-gave-up') ?? '',
    );
  }, width);
}

test('a row that gave something up has it back as the room beside it grows, though it’s sized to what it draws', async () => {
  const page = await open();
  // The header's branches, then the merge status's detail, each row alone beside a spacer.
  expect(await at(page, 1440)).toEqual(['', '']);
  expect(await at(page, 160)).toEqual(['branches', 'detail']);
  expect(await at(page, 1440)).toEqual(['', '']);
  // A step at a time: the detail comes back once there's room for it, then the branches.
  expect(await at(page, 240)).toEqual(['branches', '']);
  expect(await at(page, 160)).toEqual(['branches', 'detail']);
  expect(await at(page, 240)).toEqual(['branches', '']);
  expect(await at(page, 1440)).toEqual(['', '']);
});
