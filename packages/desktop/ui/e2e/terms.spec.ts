// A term's card and row, an overview's section heads, a stack overview's layers and a list kept
// per repo, as Chromium lays them out, which jsdom doesn't: the card's width and its foot, a row in
// three columns and in one, the chevron in the article's room at the heading's left, and what goes
// under what in a box under 420 px.

import type { ElectronApplication, Locator, Page } from '@playwright/test';

import { buildPage, expect, launch, test, utilities } from './electron.ts';

/** Where the page is built, once in each worker. */
const harness = () => buildPage('terms.tsx', 'Terms', utilities);

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function open(): Promise<Page> {
  app = await launch(await harness());
  const page = await app.firstWindow();
  await page.waitForSelector('[data-drawn]');
  return page;
}

/** The dark sheet's box called `name`. */
const box = (page: Page, name: string) => page.locator(`[data-sheet="dark"] [data-box="${name}"]`);

async function rect(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('It isn’t drawn.');
  return found;
}

test('a term’s card is 320 px with every part or one, and its foot goes with its last hint', async () => {
  const page = await open();
  for (const name of ['card-full', 'card-plain', 'card-git']) {
    expect((await rect(box(page, name).locator('.lo-hovercard'))).width).toBe(320);
  }
  const full = box(page, 'card-full');
  await expect(full.locator('.lo-hovercard__foot')).toBeVisible();
  await expect(full.locator('.lo-hovercard__foot kbd')).toHaveText('i');
  // The only hint of the refill's card is Edit, which can't run without push access.
  await expect(box(page, 'card-git').locator('.lo-hovercard__foot')).toBeHidden();
  await expect(box(page, 'card-git')).toContainText('· not verified ·');
});

test('a row is three columns, and one under 420 px, its end controls on the term’s line', async () => {
  const page = await open();
  const parts = async (name: string, term: string) => {
    const row = box(page, name).locator(`[data-term="${term}"]`);
    return {
      term: await rect(row.locator('.lo-term-row__term')),
      definition: await rect(row.locator('.lo-term-row__definition')),
      end: await rect(row.locator('.lo-term-row__end')),
    };
  };
  const wide = await parts('article', 'refill');
  expect(wide.definition.x).toBeGreaterThan(wide.term.x + wide.term.width);
  expect(wide.definition.y).toBe(wide.term.y);
  expect(wide.end.x).toBeGreaterThanOrEqual(wide.definition.x + wide.definition.width);
  expect(wide.end.width).toBeGreaterThanOrEqual(48);
  const narrow = await parts('rows-narrow', 'refill');
  expect(narrow.definition.x).toBe(narrow.term.x);
  expect(narrow.definition.y).toBeGreaterThan(narrow.term.y + narrow.term.height);
  expect(narrow.end.y).toBeLessThan(narrow.term.y + narrow.term.height);
  // A long term wraps in its column, and keeps to it.
  const long = await parts('article', 'long');
  expect(long.term.height).toBeGreaterThan(21);
  expect(long.term.x + long.term.width).toBeLessThanOrEqual(long.definition.x);
  // The end controls show on the row with focus, and keep their room on the rest.
  const article = box(page, 'article');
  await expect(article.locator('[data-term="refill"] .lo-term-row__end button')).toHaveCount(2);
  await expect(article.locator('[data-term="refill"] .lo-term-row__end')).toBeVisible();
  await expect(article.locator('[data-term="token"] .lo-term-row__end')).toBeHidden();
});

test('a section’s chevron sits in the article’s room at its heading’s left, its menu at the measure’s end', async () => {
  const page = await open();
  const head = box(page, 'article').locator('.lo-section-head', { hasText: 'Glossary' });
  const heading = await rect(head.locator('h2'));
  const chevron = await rect(head.locator('.lo-section-head__chevron button'));
  const article = await rect(box(page, 'article').locator('article'));
  // Its 22 px button is centred in the article's 20 px of room before the heading.
  expect(Math.round(chevron.x + chevron.width / 2)).toBe(Math.round(article.x + 10));
  expect(heading.x - article.x).toBe(20);
  expect(chevron.y).toBeGreaterThan(heading.y);
  expect(chevron.y + chevron.height).toBeLessThan(heading.y + heading.height);
  const more = await rect(head.locator('.lo-section-head__more button'));
  expect(Math.round(more.x + more.width - heading.x)).toBe(680);
  // The tl;dr's heading has neither.
  await expect(
    box(page, 'article').locator('.lo-section-head', { hasText: 'tl;dr' }).locator('button'),
  ).toHaveCount(0);
});

test('under 420 px, a layer’s state goes under its title and an entry’s buttons under its label', async () => {
  const page = await open();
  const state = async (name: string) => {
    const layer = box(page, name).locator('button[data-key="82"]');
    const title = await rect(layer.getByText('Refill buckets on a timer'));
    const words = await rect(layer.locator('.stack-layers-state'));
    return words.y > title.y + title.height / 2;
  };
  expect(await state('layers')).toBe(false);
  expect(await state('layers-narrow')).toBe(true);
  const under = async (name: string, label: string) => {
    const entry = box(page, name).locator('[role="listitem"]', { hasText: label });
    const words = await rect(entry.getByText(label, { exact: true }));
    const button = await rect(entry.getByRole('button').first());
    return button.y >= words.y + words.height;
  };
  expect(await under('scoped', 'Why')).toBe(false);
  expect(await under('scoped-narrow', 'bucket')).toBe(true);
});

test('a word longer than its column breaks to fit it, in a card, a row and a layer', async () => {
  const page = await open();
  const long = box(page, 'long');
  const fits = (selector: string) =>
    long
      .locator(selector)
      .first()
      .evaluate((element) => element.scrollWidth <= element.clientWidth);
  for (const selector of [
    '.lo-hovercard',
    '.lo-hovercard__body',
    '[data-lo-before]',
    '.lo-term-row__head',
    '.lo-term-row__definition',
    '.stack-layers button',
  ]) {
    expect(await fits(selector), selector).toBe(true);
  }
  // The definition keeps clear of the row's end controls.
  const row = long.locator('[data-term="long-word"]');
  const definition = await rect(row.locator('.lo-term-row__definition'));
  const end = await rect(row.locator('.lo-term-row__end'));
  expect(definition.x + definition.width).toBeLessThanOrEqual(end.x);
});
