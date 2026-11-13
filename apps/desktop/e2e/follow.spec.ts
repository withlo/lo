// Moving through an overview in the app by its keys, and following it to the code: Lo, started on
// the replay server as rozed-bot, opens rozed-dev/e2e#80 on its overview. `]b` and `[b` go between
// its blocks, `Tab` and `⇧Tab` round a block's links and parts, and from the overview itself
// through its outline to the first block, `←` and `→` step a walkthrough or tabs, `⏎` follows a
// block, a link or a part to its code in the diff, or to the file whole where the diff doesn't have
// it, where its lines are in r2, though the overview was written for r1, and `⌃o` comes back to the
// block. `o` puts the block's code beside the overview, following
// the blocks, and `o` or `Esc` takes it away. A block's right-click menu does the same, and gives
// focus back to what had it. What the reader is at stays where it is through each, or comes on
// screen where that's off it now.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, sizeWindow, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{ github: ReplayServer; remote: string; tokenFile: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    await use(server);
    await server.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeAppRemote(test.info().outputPath('remote')));
  },
  // oxlint-disable-next-line no-empty-pattern
  tokenFile: async ({}, use) => {
    const file = test.info().outputPath('token');
    writeFileSync(file, `${TOKEN}\n`);
    await use(file);
  },
  launch: async ({ github, remote, tokenFile }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
      },
    });
  },
});

/**
 * #80's overview's blocks the block keys stop at, by their numbers: the tl;dr, with a term; the
 * paragraph linking to the parser; its code blocks; the paragraph with a term between them; the
 * figure; the walkthrough; the tabs; the code blocks on README.md and on the missing src/cache.ts;
 * and the fold.
 */
const BLOCK = {
  tldr: 1,
  parserLink: 3,
  parser: 4,
  formatHead: 6,
  formatTerm: 7,
  format: 8,
  figure: 9,
  walk: 10,
  tabs: 14,
  readme: 16,
  cache: 18,
  fold: 19,
} as const;

/** Opens #80 on its overview, waits for its code from the local copy, and returns the tab's id. */
async function open(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    APP_PULL.number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  const id = reply.value;
  // A machine too busy to know within the bound that the overview shows opens the tab on its diff,
  // which isn't what's tested: the overview is a switch away, and then takes focus as it would.
  const diff = page.locator('[data-lo-middle-view="diff.view"]');
  await expect
    .poll(async () => (await shown(page).isVisible()) || (await diff.isVisible()), {
      timeout: 20_000,
    })
    .toBe(true);
  if (!(await shown(page).isVisible())) {
    await page
      .getByRole('tablist', { name: 'View' })
      .getByRole('tab')
      .filter({ hasText: 'Overview' })
      .click();
    await expect(shown(page)).toBeVisible({ timeout: 20_000 });
    await shown(page).locator('.lo-ov').focus();
  }
  // Seen, once its first blocks have drawn.
  await expect(shown(page).locator('.lo-ov')).not.toHaveClass(/is-drawing/, {
    timeout: 10_000,
  });
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(
          (tab) => window.lo.invoke('overview.current', { id: tab }),
          id,
        );
        return state.ok ? state.value : state;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ code: 'ready' });
  return id;
}

/** The overview on screen. */
const shown = (page: Page) =>
  page.locator('[data-lo-middle-view="overview.view"] [data-lo-overview="shown"]');

/** The overview's block numbered `number`. */
const block = (page: Page, number: number) =>
  shown(page).locator(`.lo-ov__article > [data-lo-block="${number}"]`);

/** The code beside the overview. */
const beside = (page: Page) => page.locator('[data-lo-beside]');

/** What has focus: the block it's in, whether it's the block's own focus, and what it says. */
function focused(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const found = active?.closest('.lo-ov__article > [data-lo-block]');
    const own =
      active === found || (active?.localName === 'summary' && active.parentElement === found);
    return {
      block: found ? Number(found.getAttribute('data-lo-block')) : undefined,
      own,
      text: (active?.getAttribute('aria-label') ?? active?.textContent ?? '').trim().slice(0, 40),
    };
  });
}

/** Presses keys one after another, as typed. */
async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Goes to block `number` with `]b` and `[b`, one block at a time. */
async function toBlock(page: Page, number: number): Promise<void> {
  for (let step = 0; step < 20; step++) {
    const at = (await focused(page)).block;
    if (at === number) return;
    await press(page, ...(at === undefined || at < number ? [']', 'b'] : ['[', 'b']));
  }
  throw new Error(`The block keys never reached block ${number}.`);
}

/** Where block `number` is on the page. */
const topOf = (page: Page, number: number) =>
  block(page, number).evaluate((element) => element.getBoundingClientRect().top);

/** Where the diff's cursor is: on a line or a header, by the file's path. */
function diffCursor(page: Page) {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (!reading) return undefined;
    const id = reading.at.kind === 'line' ? reading.at.at.file : reading.at.file;
    return {
      path: window.loDiff?.files.find((file) => file.id === id)?.path,
      header: reading.at.kind === 'header',
      line: reading.at.kind === 'line' ? reading.at.at.line : 0,
      side: reading.at.kind === 'line' ? reading.at.at.side : reading.at.side,
    };
  });
}

/** The file the whole-file view has open, and the line its cursor is on. */
function wholeAt(page: Page) {
  return page.evaluate(() => {
    const file = window.loWhole?.file();
    const at = window.loWhole?.cursor();
    const line = at?.kind === 'line' && 'line' in at.at ? at.at.line : undefined;
    return file && { path: file.path, version: file.version, line };
  });
}

/** `⌃o`, back in the tab's history, to the overview: the block it left, with focus, where it was. */
async function back(page: Page, number: number, top: number): Promise<void> {
  await press(page, 'Control+o');
  await expect(shown(page)).toBeVisible();
  await expect.poll(async () => (await focused(page)).block).toBe(number);
  expect((await focused(page)).own).toBe(true);
  expect(Math.abs((await topOf(page, number)) - top)).toBeLessThanOrEqual(1);
}

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

/**
 * A right-click at a block's corner, its own: one on a code block's code is the line's, with the
 * line's menu.
 */
const CORNER = { button: 'right', position: { x: 4, y: 4 } } as const;

/** The block's right-click menu. */
const menuOf = (page: Page) => page.getByRole('menu', { name: 'Block actions' });

test(']b and [b go between the blocks, Tab between a block’s links, and ← and → step', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  await sizeWindow(app, 1200, 900);
  await open(page);

  // From the top, the first block that holds something to act on, ringed with its keys.
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, own: true });
  await expect(block(page, BLOCK.tldr)).toHaveClass(/is-focused/);
  await expect(block(page, BLOCK.tldr).locator('.lo-block__hints')).toContainText('Next link');
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parserLink, own: true });
  await expect(block(page, BLOCK.tldr)).not.toHaveClass(/is-focused/);
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parser, own: true });
  await expect(block(page, BLOCK.parser).locator('.lo-block__hints')).toContainText('Go to code');
  await press(page, '[', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parserLink, own: true });

  // Tab goes round the block's links, and back to the block.
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parserLink, text: 'The parser' });
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parserLink, own: true });
  await press(page, 'Shift+Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.parserLink, text: 'The parser' });

  // A term's card opens with its term's focus, and Esc closes it first, leaving focus there.
  await press(page, '[', 'b', 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, text: 'lines' });
  const card = page.locator('.lo-hovercard[data-open]');
  await expect(card).toHaveCount(1);
  await press(page, 'Escape');
  await expect(card).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, text: 'lines' });
  // Esc again gives focus back to the overview itself.
  await press(page, 'Escape');
  expect((await focused(page)).block).toBeUndefined();
  await expect(shown(page).locator('.lo-ov')).toBeFocused();

  // A figure's parts, in the order the figure draws them.
  await toBlock(page, BLOCK.figure);
  const parts = [];
  for (let part = 0; part < 4; part++) {
    await press(page, 'Tab');
    parts.push((await focused(page)).text);
  }
  expect(parts).toEqual([
    'src/parser.ts, L8–10',
    'The term line',
    'src/format.ts, L6–8',
    'src/text/wrap.ts, L2–15',
  ]);
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.figure, own: true });

  // A walkthrough steps with → and ←, stopping at its first and last steps.
  await toBlock(page, BLOCK.walk);
  const step = () =>
    block(page, BLOCK.walk)
      .locator('.lo-walk__step')
      .evaluateAll((steps) =>
        steps.findIndex((each) => each.getAttribute('aria-current') === 'step'),
      );
  expect(await step()).toBe(0);
  await press(page, 'ArrowLeft');
  expect(await step()).toBe(0);
  await press(page, 'ArrowRight', 'ArrowRight');
  await expect.poll(step).toBe(2);
  await press(page, 'ArrowRight');
  expect(await step()).toBe(2);
  await press(page, 'ArrowLeft');
  await expect.poll(step).toBe(1);
  expect(await focused(page)).toMatchObject({ block: BLOCK.walk, own: true });

  // Tabs switch with → and ←, round the ends.
  await toBlock(page, BLOCK.tabs);
  const chosen = block(page, BLOCK.tabs).getByRole('tab', { selected: true });
  await expect(chosen).toHaveText('Before');
  await press(page, 'ArrowRight');
  await expect(chosen).toHaveText('After');
  await press(page, 'ArrowRight');
  await expect(chosen).toHaveText('Before');
  await press(page, 'ArrowLeft');
  await expect(chosen).toHaveText('After');
  // ⏎ on tabs has nowhere to go.
  await press(page, 'Enter');
  await expect(said(page, 'This block has nothing to follow.')).toBeVisible();

  // ⏎ opens and closes a fold.
  await toBlock(page, BLOCK.fold);
  const fold = block(page, BLOCK.fold);
  await expect(fold).not.toHaveAttribute('open');
  await press(page, 'Enter');
  await expect(fold).toHaveAttribute('open', '');
  await press(page, 'Enter');
  await expect(fold).not.toHaveAttribute('open');

  // At the last block, ]b says so.
  await press(page, ']', 'b');
  await expect(said(page, 'This is the last block.')).toBeVisible();
  expect((await focused(page)).block).toBe(BLOCK.fold);
});

test('from the overview itself, Tab goes through the outline to the first block, and ⇧Tab back', async ({
  app,
  page,
}) => {
  await sizeWindow(app, 1400, 900);
  await open(page);
  const sections = (await shown(page).locator('.lo-ov__toc .lo-toc__item').allTextContents()).map(
    (text) => text.trim().slice(0, 40),
  );
  expect(sections.length).toBeGreaterThan(1);
  // The banner's actions, by their labels, which their keys' caps follow.
  const banner = [/^Compare r1 → r2/, /^Copy prompt for an agent/];
  const itself = shown(page).locator('.lo-ov');

  // As Esc leaves it, from a block.
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, own: true });
  await press(page, 'Escape');
  await expect(itself).toBeFocused();
  for (const section of sections) {
    await press(page, 'Tab');
    expect(await focused(page)).toMatchObject({ block: undefined, text: section });
  }
  // #80's byline offers nothing, so the banner saying it was written for r1, then the first block,
  // which then keeps Tab to itself.
  for (const action of banner) {
    await press(page, 'Tab');
    expect(await focused(page)).toMatchObject({
      block: undefined,
      text: expect.stringMatching(action),
    });
  }
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, own: true });
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, text: 'lines' });
  await press(page, 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.tldr, own: true });

  // ⇧Tab goes back from the overview itself through the banner and the outline to its first
  // section.
  await press(page, 'Escape');
  await expect(itself).toBeFocused();
  for (const action of banner.toReversed()) {
    await press(page, 'Shift+Tab');
    expect(await focused(page)).toMatchObject({
      block: undefined,
      text: expect.stringMatching(action),
    });
  }
  for (const section of sections.toReversed()) {
    await press(page, 'Shift+Tab');
    expect(await focused(page)).toMatchObject({ block: undefined, text: section });
  }
  await press(page, 'Shift+Tab');
  await expect(said(page, 'There’s nothing before this in the overview.')).toBeVisible();
  expect(await focused(page)).toMatchObject({ text: sections[0] });
});

test('a block’s menu gives focus back to what had it: the block, not what’s in it, or a part', async ({
  app,
  page,
}) => {
  await sizeWindow(app, 1400, 900);
  await open(page);
  const menu = menuOf(page);

  // ⇧F10 on a figure, whose parts can take focus, and Esc.
  await toBlock(page, BLOCK.figure);
  await press(page, 'Shift+F10');
  await expect(menu).toBeVisible();
  await press(page, 'Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ block: BLOCK.figure, own: true });

  // A right-click on a code block, whose code can take focus, and an action that leaves focus be.
  await block(page, BLOCK.parser).scrollIntoViewIfNeeded();
  await block(page, BLOCK.parser).click(CORNER);
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^Open or close code beside/ }).click();
  await expect(beside(page)).toBeVisible();
  expect(await focused(page)).toMatchObject({ block: BLOCK.parser, own: true });
  await block(page, BLOCK.parser).click(CORNER);
  await expect(menu).toBeVisible();
  await press(page, 'Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ block: BLOCK.parser, own: true });

  // The block keys go on from it.
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.formatHead, own: true });

  // A figure's part, a drawing's element, gets focus back, by ⇧F10 and by a right-click.
  await toBlock(page, BLOCK.figure);
  await press(page, 'Tab');
  const part = { block: BLOCK.figure, text: 'src/parser.ts, L8–10' };
  expect(await focused(page)).toMatchObject(part);
  await press(page, 'Shift+F10');
  await expect(menu).toBeVisible();
  await press(page, 'Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused(page)).toMatchObject(part);
  await block(page, BLOCK.figure).locator('.lo-fig-link').first().click({ button: 'right' });
  await expect(menu).toBeVisible();
  await press(page, 'Escape');
  await expect(menu).toHaveCount(0);
  expect(await focused(page)).toMatchObject(part);
  await press(page, ']', 'b');
  expect(await focused(page)).toMatchObject({ block: BLOCK.walk, own: true });
});

test('j and G scroll the overview, and ⏎ on a section in the outline goes to it', async ({
  app,
  page,
}) => {
  await sizeWindow(app, 1200, 900);
  await open(page);
  const scroller = shown(page).locator('.lo-ov');
  // To the pixel: the end can be half a one past a whole number.
  const scrolled = () => scroller.evaluate((element) => Math.round(element.scrollTop));
  expect(
    await scroller.evaluate((element) => element.scrollHeight - 2 * element.clientHeight),
  ).toBeGreaterThan(0);

  /**
   * Presses `keys`, and says where the overview was scrolled from and where the keys put it: as
   * the first scroll after them has it, before a block that left the screen takes its code's
   * height and the scroll makes up for it, which keeps what's on screen where it is.
   */
  const scrollBy = async (...keys: string[]) => {
    const from = await scroller.evaluate((element) => {
      const reading = { top: element.scrollTop };
      const watched: { top?: number; end?: number } = {};
      Reflect.set(window, 'loFirstScroll', watched);
      element.addEventListener(
        'scroll',
        () => {
          watched.top = Math.round(element.scrollTop);
          watched.end = Math.round(element.scrollHeight - element.clientHeight - element.scrollTop);
        },
        { once: true },
      );
      return reading;
    });
    await press(page, ...keys);
    const first = () =>
      page.evaluate(() => {
        const watched: unknown = Reflect.get(window, 'loFirstScroll');
        return typeof watched === 'object' && watched !== null
          ? { top: Reflect.get(watched, 'top'), end: Reflect.get(watched, 'end') }
          : {};
      });
    await expect.poll(async () => (await first()).top).toBeDefined();
    const { top, end } = await first();
    return { from: Math.round(from.top), top, end };
  };

  // The other keys, and how far each goes, are `scroll()`'s and the keymap's, in unit tests: here,
  // a line down and the end, through the real keys and the real overview.
  await press(page, ']', 'b');
  const down = await scrollBy('j');
  expect(down.top).toBe(down.from + 40);
  expect((await scrollBy('Shift+G')).end).toBe(0);

  // ⏎ on a section in the outline goes to it, as a click does.
  const section = shown(page).locator('.lo-toc__item', { hasText: 'Where to look' });
  await section.focus();
  await press(page, 'Enter');
  await expect.poll(scrolled).toBeGreaterThan(0);
  await expect(shown(page).getByRole('heading', { name: 'Where to look' })).toBeInViewport();
});

test('⏎ follows a block, a part or a link to its code, and ⌃o comes back to the block', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await sizeWindow(app, 1200, 900);
  await open(page);

  // A code block: the diff, at the line its first line is at the head.
  await toBlock(page, BLOCK.parser);
  let top = await topOf(page, BLOCK.parser);
  await press(page, 'Enter');
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  await expect(shown(page)).toBeHidden();
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toEqual({ path: 'src/parser.ts', header: false, line: 7, side: 'new' });
  await back(page, BLOCK.parser, top);

  // A figure's part: its own lines.
  await toBlock(page, BLOCK.figure);
  top = await topOf(page, BLOCK.figure);
  await press(page, 'Tab', 'Tab', 'Tab');
  expect(await focused(page)).toMatchObject({ text: 'src/format.ts, L6–8' });
  await press(page, 'Enter');
  await expect
    .poll(() => diffCursor(page))
    .toEqual({ path: 'src/format.ts', header: false, line: 6, side: 'new' });
  await back(page, BLOCK.figure, top);

  // A walkthrough: the step it shows.
  await toBlock(page, BLOCK.walk);
  top = await topOf(page, BLOCK.walk);
  await press(page, 'Enter');
  await expect
    .poll(() => diffCursor(page))
    .toEqual({ path: 'src/parser.ts', header: false, line: 8, side: 'new' });
  await back(page, BLOCK.walk, top);

  // A link in prose to a whole file: the file's header. A click follows it as ⏎ does.
  await toBlock(page, BLOCK.parserLink);
  top = await topOf(page, BLOCK.parserLink);
  await block(page, BLOCK.parserLink).getByRole('link', { name: 'The parser' }).click();
  await expect.poll(() => diffCursor(page)).toMatchObject({ path: 'src/parser.ts', header: true });
  await back(page, BLOCK.parserLink, top);
});

test('⏎ goes where the block’s lines are in r2, on an overview written for r1', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await sizeWindow(app, 1200, 900);
  await open(page);
  await expect(shown(page).locator('.lo-ov-stale__title')).toHaveText(
    'Written for r1. The PR is at r2.',
  );
  // Once Lo knows what changed since r1, which it fetches into the local copy first: the overview
  // shows from its text alone, and a ⏎ before then waits only up to the bound to place its lines.
  // The parser block's flag says it knows, which the banner's "touching" doesn't: that comes first,
  // and r1's lines may not be mapped to r2's by then.
  await expect(block(page, BLOCK.parser).locator('.lo-codeblock__flag')).toBeVisible({
    timeout: 20_000,
  });

  // The walkthrough's second step, r1's lines 13 to 15, a line further down in r2: the diff, at
  // line 14.
  await toBlock(page, BLOCK.walk);
  let top = await topOf(page, BLOCK.walk);
  await press(page, 'ArrowRight', 'Enter');
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toEqual({ path: 'src/parser.ts', header: false, line: 14, side: 'new' });
  await back(page, BLOCK.walk, top);

  // README.md, which the diff doesn't have, its line 4 replaced by two in r2: whole, r1's lines 1
  // to 4 marked where they are in r2.
  await toBlock(page, BLOCK.readme);
  top = await topOf(page, BLOCK.readme);
  await press(page, 'Enter');
  const whole = page.locator('[data-lo-whole]');
  await expect(whole.locator('.lo-fileview')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => wholeAt(page)).toEqual({ path: 'README.md', version: 'new', line: 1 });
  await expect(whole.locator('.cm-line.lo-line-marked')).toHaveText([
    '# App fixture',
    '',
    "What Lo's end-to-end tests open: a pull request with a rename, a move, a lockfile, a large file, a",
    'binary and a deletion, pushed twice across a rebase. `testing/fixtures/app.sh` in withlo/lo makes',
    'every commit of it.',
  ]);
  await back(page, BLOCK.readme, top);
});

test('⌃o puts the block back where it was, cut by the top of the screen', async ({ app, page }) => {
  test.setTimeout(120_000);
  await sizeWindow(app, 1200, 900);
  await open(page);
  const scroller = shown(page).locator('.lo-ov');
  await toBlock(page, BLOCK.format);
  // Just below the screen's top edge, nearer it than `]b` would leave a block it brings on screen.
  await scroller.evaluate((element, number) => {
    const at = element.querySelector(`.lo-ov__article > [data-lo-block="${number}"]`);
    if (!at) throw new Error(`No block ${number}.`);
    element.scrollTop += at.getBoundingClientRect().top - element.getBoundingClientRect().top - 5;
  }, BLOCK.format);
  const top = await topOf(page, BLOCK.format);
  await press(page, 'Enter');
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toMatchObject({ path: 'src/format.ts' });
  await back(page, BLOCK.format, top);
});

test('⌃o puts the block back where it was, the window narrower while away', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await sizeWindow(app, 1200, 900);
  await open(page);
  await toBlock(page, BLOCK.format);
  const top = await topOf(page, BLOCK.format);
  await press(page, 'Enter');
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toMatchObject({ path: 'src/format.ts' });
  await sizeWindow(app, 900, 900);
  await back(page, BLOCK.format, top);
});

test('⌃o brings the block on screen when the window got shorter while away', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await sizeWindow(app, 1200, 900);
  await open(page);
  const scroller = shown(page).locator('.lo-ov');
  await toBlock(page, BLOCK.format);
  // Low on the screen, below where the shorter window ends.
  await scroller.evaluate((element, number) => {
    const at = element.querySelector(`.lo-ov__article > [data-lo-block="${number}"]`);
    if (!at) throw new Error(`No block ${number}.`);
    element.scrollTop +=
      at.getBoundingClientRect().top - element.getBoundingClientRect().bottom + 150;
  }, BLOCK.format);
  const top = await topOf(page, BLOCK.format);
  await press(page, 'Enter');
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toMatchObject({ path: 'src/format.ts' });
  await sizeWindow(app, 1200, 500);
  await press(page, 'Control+o');
  await expect(shown(page)).toBeVisible();
  await expect.poll(async () => (await focused(page)).block).toBe(BLOCK.format);
  // Where it was is past the screen's foot now.
  const foot = await scroller.evaluate((element) => element.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThan(foot);
  await expect(block(page, BLOCK.format)).toBeInViewport();
});

test('o puts a block’s code beside the overview, which follows the blocks, and o or Esc takes it away, moving nothing', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  await sizeWindow(app, 1400, 900);
  await open(page);
  const toc = shown(page).locator('.lo-ov__toc');
  await expect(toc).toBeVisible();

  await toBlock(page, BLOCK.parser);
  let top = await topOf(page, BLOCK.parser);
  await press(page, 'o');
  await expect(beside(page)).toBeVisible();
  await expect(beside(page).locator('.lo-split__bar .lo-path')).toHaveText('src/parser.ts');
  // The outline gives the code its room; the block stays where it was, with focus.
  await expect(toc).toHaveCount(0);
  expect(Math.abs((await topOf(page, BLOCK.parser)) - top)).toBeLessThanOrEqual(1);
  expect(await focused(page)).toMatchObject({ block: BLOCK.parser, own: true });
  await expect(block(page, BLOCK.parser).locator('.lo-block__hints')).toContainText('Close beside');
  // The block's first line, on screen in the code, inline.
  const code = beside(page).locator('[data-lo-beside-code]');
  const lines = code.getByRole('textbox', { name: 'Changes' });
  const onScreen = async (text: string) => {
    const line = lines.locator('.cm-line', { hasText: text });
    await expect(line).toBeVisible({ timeout: 20_000 });
    const box = await code.boundingBox();
    const at = await line.boundingBox();
    return (
      (at?.y ?? -1) >= (box?.y ?? 0) &&
      (at?.y ?? 0) + (at?.height ?? 0) <= (box?.y ?? 0) + (box?.height ?? 0)
    );
  };
  expect(await onScreen('Empty input has no lines')).toBe(true);
  await expect(beside(page).locator('.lo-split__bar')).toContainText('Inline');

  // ]b takes the code along to each block with code, and leaves it at a block without.
  await press(page, ']', 'b');
  expect((await focused(page)).block).toBe(BLOCK.formatHead);
  await expect(beside(page).locator('.lo-split__bar .lo-path')).toHaveText('src/format.ts');
  await press(page, ']', 'b');
  expect((await focused(page)).block).toBe(BLOCK.formatTerm);
  await expect(beside(page).locator('.lo-split__bar .lo-path')).toHaveText('src/format.ts');
  await press(page, ']', 'b');
  expect((await focused(page)).block).toBe(BLOCK.format);
  expect(await onScreen('/** `lines` as text, each after its number. */')).toBe(true);

  // In the code, its block keeps its ring, and Esc takes the code away, focus back on the block.
  top = await topOf(page, BLOCK.format);
  await lines.focus();
  expect((await focused(page)).block).toBeUndefined();
  await expect(block(page, BLOCK.format)).toHaveClass(/is-focused/);
  // The diff's keys act on it there.
  await press(page, 'g', 'i');
  await expect(said(page, 'Code beside the overview is always inline.')).toBeVisible();
  await press(page, 'Escape');
  await expect(beside(page)).toHaveCount(0);
  await expect(toc).toBeVisible();
  expect(await focused(page)).toMatchObject({ block: BLOCK.format, own: true });
  expect(Math.abs((await topOf(page, BLOCK.format)) - top)).toBeLessThanOrEqual(1);

  // o opens it again, and o closes it, the block staying put each time.
  await press(page, 'o');
  await expect(beside(page)).toBeVisible();
  expect(Math.abs((await topOf(page, BLOCK.format)) - top)).toBeLessThanOrEqual(1);
  await press(page, 'o');
  await expect(beside(page)).toHaveCount(0);
  expect(Math.abs((await topOf(page, BLOCK.format)) - top)).toBeLessThanOrEqual(1);

  // The button over the code takes it away too.
  await press(page, 'o');
  await beside(page)
    .getByRole('button', { name: /^Close code beside/ })
    .click();
  await expect(beside(page)).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ block: BLOCK.format, own: true });

  // Tab through a figure's parts keeps the figure's code beside: it follows the block, not the part.
  await toBlock(page, BLOCK.figure);
  await press(page, 'o');
  const path = beside(page).locator('.lo-split__bar .lo-path');
  await expect(path).toHaveText('src/parser.ts');
  await press(page, 'Tab', 'Tab', 'Tab');
  expect(await focused(page)).toMatchObject({ block: BLOCK.figure, text: 'src/format.ts, L6–8' });
  await expect(path).toHaveText('src/parser.ts');
  await press(page, 'o');
  await expect(beside(page)).toHaveCount(0);

  // A block with no code has none to show.
  await toBlock(page, BLOCK.tabs);
  await press(page, 'o');
  await expect(said(page, 'This block shows no code.')).toBeVisible();
  await expect(beside(page)).toHaveCount(0);

  // A file the pull request doesn't change says so.
  await toBlock(page, BLOCK.readme);
  await press(page, 'o');
  await expect(beside(page)).toContainText('This pull request doesn’t change README.md.');
});

test('the palette offers Close code beside only while code is beside', async ({ app, page }) => {
  await sizeWindow(app, 1400, 900);
  await open(page);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const input = palette.getByRole('combobox', { name: 'Command palette' });
  const offered = palette.getByRole('option', { name: /^Close code beside/ });
  const openPalette = async () => {
    await press(page, process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
    await expect(input).toBeFocused();
    await input.fill('Close code beside');
  };

  await toBlock(page, BLOCK.parser);
  await openPalette();
  await expect(palette.getByRole('option').first()).toBeVisible();
  await expect(offered).toHaveCount(0);
  await press(page, 'Escape');
  await expect(palette).toBeHidden();

  await press(page, 'o');
  await expect(beside(page)).toBeVisible();
  await openPalette();
  await expect(offered).toHaveCount(1);
  await press(page, 'Enter');
  await expect(beside(page)).toHaveCount(0);
  expect(await focused(page)).toMatchObject({ block: BLOCK.parser, own: true });
});

test('a block’s menu goes to its code, puts it beside, and copies the prompt', async ({
  app,
  page,
}) => {
  await sizeWindow(app, 1400, 900);
  await open(page);
  const menu = menuOf(page);

  await block(page, BLOCK.parser).scrollIntoViewIfNeeded();
  await block(page, BLOCK.parser).click(CORNER);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Go to code/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Copy prompt for an agent/ })).toBeVisible();
  // Nothing newer was pushed, and nothing failed.
  await expect(menu.getByRole('menuitem', { name: /Load the newer overview/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Retry/ })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: /^Open or close code beside/ }).click();
  await expect(beside(page).locator('.lo-split__bar .lo-path')).toHaveText('src/parser.ts');
  await block(page, BLOCK.parser).click(CORNER);
  await menu.getByRole('menuitem', { name: /^Open or close code beside/ }).click();
  await expect(beside(page)).toHaveCount(0);

  // A block with no code lists neither.
  await block(page, BLOCK.tabs).scrollIntoViewIfNeeded();
  await block(page, BLOCK.tabs).click(CORNER);
  await expect(menu.getByRole('menuitem', { name: /^Copy prompt for an agent/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Go to code/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Open or close code beside/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await block(page, BLOCK.parser).scrollIntoViewIfNeeded();
  await block(page, BLOCK.parser).click(CORNER);
  await menu.getByRole('menuitem', { name: /^Go to code/ }).click();
  await expect
    .poll(() => diffCursor(page), { timeout: 20_000 })
    .toEqual({ path: 'src/parser.ts', header: false, line: 7, side: 'new' });
});
