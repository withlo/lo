// The file tree in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#80
// and shows the repository's files at its head in the left panel, its changes marked, and the tree
// answers its keys, its clicks and its files' right-click menu.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Locator, Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';

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

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens #80's tab, and returns its id. */
async function openE2e(page: Page): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    APP_PULL.number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

const tree = (page: Page) => page.locator('[role="tree"][data-lo-scope="tree"]');
const row = (page: Page, key: string) => tree(page).locator(`[data-key="${key}"]`);

/** The key of the row the keyboard is on. */
async function focused(page: Page): Promise<string | null> {
  return tree(page).evaluate((element) => {
    const id = element.getAttribute('aria-activedescendant');
    return id === null ? null : (document.getElementById(id)?.getAttribute('data-key') ?? null);
  });
}

/**
 * Opens #80 and waits for its tree from the local copy, and its diff, which the tree follows: the
 * first changed file is on screen.
 */
async function shown(page: Page): Promise<string> {
  const id = await openE2e(page);
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate(
          (tab) => window.lo.invoke('tree.current', { id: tab }),
          id,
        );
        return reply.ok ? reply.value : reply;
      },
      { timeout: 20_000 },
    )
    .toMatchObject({ at: APP_PULL.head, from: 'local', changesFrom: 'local' });
  await expect(row(page, 'src/parser.ts')).toBeVisible();
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  await expect(row(page, 'assets/mark.png')).toHaveClass(/tree-current/);
  return id;
}

const marks = (locator: Locator) => locator.evaluate((element) => element.textContent);

/** The path of the file whose header the diff's cursor is on, if it's on one. */
function cursorPath(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const at = window.loDiff?.probe.cursor()?.at;
    const id = at?.kind === 'header' ? at.file : undefined;
    return window.loDiff?.files.find((file) => file.id === id)?.path;
  });
}

/** How far below the top of the diff's screen `path`'s header is, if it's drawn. */
function headerBelow(page: Page, path: string): Promise<number | undefined> {
  return page.evaluate((wanted) => {
    const file = window.loDiff?.files.find((each) => each.path === wanted)?.id;
    const box = document.querySelector('.lo-diffview')?.getBoundingClientRect();
    const top =
      file === undefined
        ? undefined
        : window.loDiff?.probe.spotTop({ kind: 'header', file, side: 'new' });
    return box && top !== undefined ? Math.round(top - box.top) : undefined;
  }, path);
}

test('shows the repository’s files at the head on screen, with the pull request’s changes marked', async ({
  page,
}) => {
  await shown(page);
  const panel = page.getByRole('region', { name: 'Files' });
  await expect(panel).toContainText('0 / 7 viewed');
  // Folders with changes open; their files carry how they changed.
  await expect(row(page, 'src')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(page, 'src/text')).toHaveAttribute('aria-expanded', 'true');
  expect(await marks(row(page, 'src/parser.ts'))).toContain('← parse.ts');
  expect(await marks(row(page, 'src/parser.ts'))).toContain('R');
  // A deleted file is where it was, struck through.
  expect(await marks(row(page, 'src/legacy.ts'))).toContain('D');
  await expect(row(page, 'src/legacy.ts').locator('.line-through')).toHaveText('legacy.ts');
  expect(await marks(row(page, 'pnpm-lock.yaml'))).toContain('gen');
  await expect(row(page, 'data/numbers.txt').locator('[title="Not viewed"]')).toBeVisible();
  // An unchanged neighbour is dimmed, with no mark.
  await expect(row(page, 'README.md')).toHaveClass(/text-fg-dim/);
  expect(await marks(row(page, 'README.md'))).toBe('README.md');
});

test('answers its keys: moving, opening and closing folders, review order and changed only', async ({
  page,
}) => {
  await shown(page);
  // `-` goes to the tree from the window.
  await page.locator('[data-lo-middle]').focus();
  await page.keyboard.press('-');
  await expect(tree(page)).toBeFocused();
  // At the file the diff has on screen.
  expect(await focused(page)).toBe('assets/mark.png');
  await page.keyboard.press('k');
  expect(await focused(page)).toBe('assets');
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('assets/mark.png');
  await page.keyboard.press('k');
  await page.keyboard.press('h');
  await expect(row(page, 'assets')).toHaveAttribute('aria-expanded', 'false');
  // A closed folder counts its changed files.
  await expect(row(page, 'assets')).toContainText('1');
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'assets')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('l');
  expect(await focused(page)).toBe('assets/mark.png');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toBe('assets');

  // Every folder closed, then open.
  await page.keyboard.press('z');
  await page.keyboard.press('Shift+M');
  await expect(row(page, 'src')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(page, 'src')).toContainText('4');
  await expect(row(page, 'src/parser.ts')).toHaveCount(0);
  await page.keyboard.press('z');
  await page.keyboard.press('Shift+R');
  await expect(row(page, 'src/text')).toHaveAttribute('aria-expanded', 'true');

  // Only the changed files, then all of them again.
  await page.keyboard.press('f');
  await expect(row(page, 'README.md')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Changed only' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('f');
  await expect(row(page, 'README.md')).toBeVisible();

  // Review order: the changed files flat, in groups, each with its folder.
  await page.keyboard.press('t');
  await expect(tree(page)).toHaveAttribute('aria-label', 'Changed files in review order');
  await expect(tree(page)).toContainText('Source and tests');
  await expect(tree(page)).toContainText('Generated');
  await expect(row(page, 'src/parser.ts')).toContainText('src');
  await page.keyboard.press('t');
  await expect(tree(page)).toHaveAttribute('aria-label', 'Files');

  // Tab doesn't take the keyboard out of the tree.
  await page.keyboard.press('Tab');
  await expect(tree(page)).toBeFocused();
});

test('shows a changed file in the diff on ⏎, the keyboard staying in the tree', async ({
  page,
}) => {
  await shown(page);
  await row(page, 'src/format.ts').click();
  await expect(tree(page)).toBeFocused();
  expect(await focused(page)).toBe('src/format.ts');
  await page.keyboard.press('Enter');
  await expect.poll(() => cursorPath(page)).toBe('src/format.ts');
  await expect(tree(page)).toBeFocused();
  // On a folder, ⏎ opens and closes it.
  await row(page, 'data').click();
  await expect(row(page, 'data')).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(row(page, 'data')).toHaveAttribute('aria-expanded', 'true');
});

test('a click puts the file’s start at the top of the diff, wherever it was, and makes it the tree’s', async ({
  page,
}) => {
  await shown(page);
  // A file kept out as large, its header on screen already; the last file, closed as generated;
  // and one with its lines.
  expect(await headerBelow(page, 'data/numbers.txt')).toBeGreaterThan(0);
  for (const path of ['data/numbers.txt', 'pnpm-lock.yaml', 'src/format.ts']) {
    await row(page, path).click();
    await expect.poll(() => headerBelow(page, path)).toBe(0);
    await expect(tree(page)).toBeFocused();
    expect(await focused(page)).toBe(path);
    await expect(row(page, path)).toHaveClass(/tree-current/);
    expect(await cursorPath(page)).toBe(path);
  }
  // Vim's block cursor on the header draws none of the path under it.
  const after = page.locator('.lo-diffview .cm-editor', {
    has: page.locator('.cm-content[aria-label="After"]'),
  });
  await expect(after.locator('.cm-fat-cursor')).toHaveCSS('color', 'rgba(0, 0, 0, 0)');

  // A folder opens or closes, and is the tree's, and the diff stays where it is.
  await row(page, 'src/text').click();
  await expect(row(page, 'src/text')).toHaveAttribute('aria-expanded', 'false');
  expect(await focused(page)).toBe('src/text');
  expect(await headerBelow(page, 'src/format.ts')).toBe(0);
  await page.keyboard.press('j');
  expect(await focused(page)).toBe('src/format.ts');

  // `⌃o` comes back from each click.
  await page.keyboard.press('Control+o');
  await expect.poll(() => cursorPath(page)).toBe('pnpm-lock.yaml');
  await page.keyboard.press('Control+o');
  await expect.poll(() => cursorPath(page)).toBe('data/numbers.txt');

  // Inline too.
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect.poll(() => page.evaluate(() => window.loDiff?.probe.layout)).toBe('inline');
  await row(page, 'src/parser.ts').click();
  await expect.poll(() => headerBelow(page, 'src/parser.ts')).toBe(0);
  await expect(row(page, 'src/parser.ts')).toHaveClass(/tree-current/);
});

/** Gives the diff's After side the keyboard, moving neither its cursor nor its scroll. */
async function focusAfter(page: Page): Promise<void> {
  await page
    .locator('.lo-diffview .cm-content[aria-label="After"]')
    .evaluate((content: HTMLElement) => content.focus({ preventScroll: true }));
}

test('a file a click brought to the top keeps its header there as it closes and opens again', async ({
  page,
}) => {
  await shown(page);
  // Near the end, where closing it leaves less to scroll than the screen; and further up.
  for (const path of ['src/parser.ts', 'src/format.ts']) {
    await row(page, path).click();
    await expect.poll(() => headerBelow(page, path)).toBe(0);
    await focusAfter(page);
    for (const open of [false, true]) {
      await page.keyboard.press('z');
      await page.keyboard.press('a');
      await expect
        .poll(() => page.evaluate(() => window.loDiff?.probe.cursor()?.at.kind))
        .toBe('header');
      await page.waitForTimeout(300);
      expect(await headerBelow(page, path), open ? 'opened' : 'closed').toBe(0);
      await expect(row(page, path)).toHaveClass(/tree-current/);
    }
  }
});

test('a banner coming over the diff after a click leaves the file’s header on screen, at its top', async ({
  page,
}) => {
  await shown(page);
  await row(page, 'src/parser.ts').click();
  await expect.poll(() => headerBelow(page, 'src/parser.ts')).toBe(0);
  // A banner comes, which moves the diff's box down and shrinks it, then goes.
  const view = page.locator('.lo-diffview');
  await view.evaluate((each) => each.parentElement?.style.setProperty('padding-top', '30px'));
  await page.waitForTimeout(300);
  expect(await headerBelow(page, 'src/parser.ts'), 'as it comes').toBe(0);
  await view.evaluate((each) => each.parentElement?.style.removeProperty('padding-top'));
  await page.waitForTimeout(300);
  expect(await headerBelow(page, 'src/parser.ts'), 'as it goes').toBe(0);
});

test('gives a file a right-click menu: marking it viewed, the whole file, its path and the file on GitHub', async ({
  app,
  page,
}) => {
  await shown(page);
  await row(page, 'src/format.ts').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'File actions' });
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem');
  await expect(items).toHaveText([/^Mark viewed/, /^Whole file/, /^Copy path/, /^Open on GitHub/]);
  await expect(items.first()).toContainText('e');
  await expect(items.nth(1)).not.toHaveAttribute('data-disabled');
  await expect(items.nth(1)).toContainText('gf');
  await expect(items.nth(2)).toContainText('yp');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // "Whole file" opens it in the middle, in place of the diff.
  await row(page, 'src/format.ts').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Whole file/ }).click();
  await expect(page.locator('[data-lo-whole] .lo-fileview')).toBeVisible();
  await expect(page.locator('[data-lo-whole] .lo-fileview')).toContainText(
    'export function format(lines',
  );
  await expect(page.locator('.lo-diffview')).toBeHidden();
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(process.platform === 'darwin', "The Mac's clipboard is its user's.");
  await row(page, 'src/parser.ts').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Copy path/ }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('src/parser.ts');
});
