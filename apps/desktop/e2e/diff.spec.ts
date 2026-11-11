// The diff in the app: Lo started on the replay server, as rozed-bot, opens rozed-dev/e2e#78 and
// draws every changed file in one scroll, in the left panel's order, each starting out as it should,
// and answers the diff's keys. Without git, it draws GitHub's diff, hunks only.

import { readFileSync, writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Probe } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import {
  appFolder,
  browsed,
  dataFolder,
  expect,
  KEYCHAIN,
  settingsPath,
  test as base,
} from './app.ts';

declare global {
  interface Window {
    /** The diff on screen, which a build run from source gives the smoke test. */
    loDiff?: { probe: Probe; files: { id: string; path: string }[] } | undefined;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** Whether Lo starts without git, so it has only GitHub's diff. */
  noGit: boolean;
}>({
  noGit: [false, { option: true }],
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
  launch: async ({ github, remote, tokenFile, noGit }, use) => {
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: remote,
        ...(noGit ? { LO_GIT: 'none' } : {}),
      },
    });
  },
});

/** Waits for the account from the token file, then opens #78's tab, and returns its id. */
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

/** Opens #78 and waits for its diff, drawn from `from`. */
async function drawn(page: Page, from: 'local' | 'github' = 'local'): Promise<string> {
  const id = await openE2e(page);
  await expect
    .poll(
      async () => {
        const reply = await page.evaluate(
          (tab) => window.lo.invoke('diff.versions', { id: tab }),
          id,
        );
        return reply.ok ? reply.value : reply;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ at: APP_PULL.head, from });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  if (from === 'local') {
    await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
  }
  // The local copy's diff takes GitHub's place a file at a time, which the status bar counts.
  await expect(page.getByText(/^Diffing \d+ of \d+$/)).toHaveCount(0, { timeout: 20_000 });
  // Every file's diff is in once the moves are: they're found last.
  await expect(page.locator('.lo-movedlabel').first()).toBeVisible({ timeout: 20_000 });
  return id;
}

/** The paths of the files the diff shows, in its order. */
function paths(page: Page): Promise<string[]> {
  return page.evaluate(() => window.loDiff?.files.map((file) => file.path) ?? []);
}

/** Where the cursor is: on a line or a header, by the file's path. */
async function cursor(page: Page) {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (!reading) return undefined;
    const id = reading.at.kind === 'line' ? reading.at.at.file : reading.at.file;
    const path = window.loDiff?.files.find((file) => file.id === id)?.path;
    return {
      path,
      header: reading.at.kind === 'header',
      line: reading.at.kind === 'line' ? reading.at.at.line : 0,
      side: reading.at.kind === 'line' ? reading.at.at.side : reading.at.side,
      pane: reading.pane,
    };
  });
}

/** Presses keys one after another, as typed. */
async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Puts the cursor in the diff, at the first header, on the new side. */
async function focusDiff(page: Page): Promise<void> {
  const added = page.locator('.lo-diffview .cm-editor').nth(1);
  await added.locator('.cm-content').focus();
  await press(page, 'g', 'g');
  await expect.poll(async () => (await cursor(page))?.header).toBe(true);
}

test('draws every changed file in the left panel’s order, each as it starts out, with no styles refused', async ({
  page,
}) => {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  await drawn(page);

  // The tree's order: folders before files, at each level.
  expect(await paths(page)).toEqual([
    'assets/mark.png',
    'data/numbers.txt',
    'src/text/wrap.ts',
    'src/format.ts',
    'src/legacy.ts',
    'src/parser.ts',
    'pnpm-lock.yaml',
  ]);
  const view = page.locator('.lo-diffview');
  // A binary file shows its two sizes; a large one waits for `za`; a lockfile starts closed.
  await expect(view.locator('.lo-diffhead', { hasText: 'assets/mark.png' }).first()).toContainText(
    /binary, \d+ B → \d+ B/,
  );
  await expect(view.getByText(/changed lines: za loads them/).first()).toBeVisible();
  // The code src/format.ts moves to src/text/wrap.ts, highlighted, under the window's content
  // security policy.
  await expect(view.locator('.lo-movedlabel').first()).toContainText(/moved/i);
  await expect(view.locator('[class*="lo-syn-"]').first()).toBeVisible();
  // A rename, with the words it changed.
  await focusDiff(page);
  await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('src/parser.ts');
  await expect(view.getByText('src/parse.ts', { exact: true }).first()).toBeVisible();
  await expect(view.locator('.lo-word-add').first()).toBeVisible();
  // The lockfile, last, starts closed.
  await press(page, 'Shift+G');
  await expect(view.locator('.lo-diffhead', { hasText: 'pnpm-lock.yaml' }).first()).toContainText(
    'lockfile',
  );
  await expect(view.getByText(/closed: za opens it/).first()).toBeVisible();
  expect(refused).toEqual([]);
});

test('answers its keys: files, changes, sides, layout, whitespace and folds', async ({ page }) => {
  await drawn(page);
  await focusDiff(page);

  await press(page, ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('data/numbers.txt');
  await press(page, ']', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('src/text/wrap.ts');
  await press(page, '[', 'f');
  await expect.poll(async () => (await cursor(page))?.path).toBe('data/numbers.txt');

  // `za` loads the large file kept out.
  await press(page, 'z', 'a');
  await expect(page.locator('.lo-diffview').getByText(/za loads them/)).toHaveCount(0, {
    timeout: 20_000,
  });

  // To src/parser.ts's change, then across to the old side and back.
  await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'c');
  await expect
    .poll(() => cursor(page))
    .toMatchObject({
      path: 'src/parser.ts',
      header: false,
      pane: 'new',
    });
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('new');

  // `zR` opens the file's unchanged lines: src/parser.ts is the sixth file.
  const collapsed = page.locator('.lo-diffview [data-row^="c:5:"]');
  await expect(collapsed.first()).toBeVisible();
  await press(page, 'z', 'Shift+R');
  await expect(collapsed).toHaveCount(0);

  // `gi` lays it out inline, for every tab, and back.
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.loDiff?.probe.layout)).toBe('inline');
  await expect.poll(() => readSettings()).toMatchObject({ 'diff.layout': 'inline' });
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.loDiff?.probe.layout)).toBe('split');

  // `gw` hides changes to whitespace alone.
  await press(page, 'g', 'w');
  await expect(page.getByText('Whitespace hidden', { exact: true })).toBeVisible();
  await expect.poll(() => readSettings()).toMatchObject({ 'diff.whitespace': 'hide' });
  await press(page, 'g', 'w');
  await expect(page.getByText('Whitespace hidden', { exact: true })).toHaveCount(0);

  // `gx` opens the line in the pull request's changes on GitHub.
  await press(page, 'g', 'x');
  await expect
    .poll(() => browsed())
    .toEqual([
      expect.stringMatching(
        /^https:\/\/github\.com\/rozed-dev\/e2e\/pull\/78\/files#diff-[0-9a-f]{64}R\d+$/,
      ),
    ]);
});

test('copies the lines, the line’s link and the file’s path', async ({ app, page }) => {
  // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
  test.skip(process.platform === 'darwin', "The Mac's clipboard is its user's.");
  await drawn(page);
  await focusDiff(page);
  await press(page, ']', 'f', ']', 'f', ']', 'c');
  const clipboard = () => app.evaluate(({ clipboard: board }) => board.readText());

  await press(page, 'y', 'p');
  await expect.poll(clipboard).toBe('src/text/wrap.ts');
  await press(page, 'y', 'l');
  await expect
    .poll(clipboard)
    .toMatch(/^https:\/\/github\.com\/rozed-dev\/e2e\/pull\/78\/files#diff-[0-9a-f]{64}R1$/);
  await press(page, 'y', 'y');
  await expect
    .poll(clipboard)
    .toBe('/** `text` broken into lines of at most `width` characters, at spaces. */');
});

test('the tree follows the file on screen, and shows the file it’s asked for', async ({ page }) => {
  await drawn(page);
  const tree = page.locator('[role="tree"][data-lo-scope="tree"]');
  // A file in the tree, clicked, has its header brought on screen in the diff.
  await tree.locator('[data-key="pnpm-lock.yaml"]').click();
  await expect
    .poll(() => cursor(page))
    .toMatchObject({
      path: 'pnpm-lock.yaml',
      header: true,
    });
  // The file at the top of the diff is the one the tree marks.
  await page
    .locator('.lo-diffview .cm-editor')
    .nth(1)
    .locator('.lo-diffhead', { hasText: 'src/legacy.ts' })
    .evaluate((header) => header.scrollIntoView({ block: 'start' }));
  await expect(tree.locator('[data-key="src/legacy.ts"]')).toHaveClass(/tree-current/);
  await focusDiff(page);
  await expect(tree.locator('[data-key="assets/mark.png"]')).toHaveClass(/tree-current/);
});

/** What the settings file holds now. */
function readSettings(): unknown {
  try {
    return JSON.parse(readFileSync(settingsPath(dataFolder()), 'utf8'));
  } catch {
    return undefined;
  }
}

test.describe('without git', () => {
  test.use({ noGit: true });

  test('draws GitHub’s diff, hunks only, with the lines between them not loaded', async ({
    page,
  }) => {
    await drawn(page, 'github');
    await expect(page.getByText('GitHub’s diff', { exact: true })).toBeVisible();
    // The unchanged lines before src/parser.ts's hunk aren't GitHub's to show.
    await focusDiff(page);
    await press(page, ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'f');
    await expect.poll(async () => (await cursor(page))?.path).toBe('src/parser.ts');
    await expect(
      page.locator('.lo-diffview .lo-collapsed', { hasText: 'not loaded yet' }).first(),
    ).toBeVisible();
    expect(await paths(page)).toContain('src/parser.ts');
  });
});
