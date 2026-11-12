// The whole-file view in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#78, and shows a file whole in the middle of the tab, in place of the diff: from the
// diff with `gf`, at the cursor's line and in the version on its side; a file the pull request
// leaves alone, from the tree; and any file from the file finder's `⌘⏎`. `⌃o` goes back to where it
// was opened from, and `` ` `` steps between the diff and it. Nothing it draws breaks the window's
// content security policy.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Target } from '@lo/ui/code';
import type { Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, test as base } from './app.ts';

declare global {
  interface Window {
    /** The whole-file view on screen, which a build run from source gives the smoke test. */
    loWhole?:
      | {
          file(): { id: string; path: string; version: 'old' | 'new' } | undefined;
          content():
            'reading' | 'text' | 'failed' | 'large' | 'binary' | 'refused' | 'waiting' | undefined;
          cursor(): Target | undefined;
        }
      | undefined;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const held = process.platform === 'darwin' ? 'Meta' : 'Control';

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

/** Opens #78, waits for its diff from the local copy and its tree, and returns the tab's id. */
async function drawn(page: Page): Promise<string> {
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
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(
          (tab) => window.lo.invoke('diff.versions', { id: tab }),
          id,
        );
        return state.ok ? state.value : state;
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ at: APP_PULL.head, from: 'local' });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(row(page, 'README.md')).toBeVisible({ timeout: 20_000 });
  return id;
}

const tree = (page: Page) => page.locator('[role="tree"][data-lo-scope="tree"]');
const row = (page: Page, key: string) => tree(page).locator(`[data-key="${key}"]`);
const whole = (page: Page) => page.locator('[data-lo-whole]');
const code = (page: Page) => whole(page).locator('.lo-fileview');

/** Where the diff's cursor is: on a line or a header, by the file's path. */
function diffCursor(page: Page) {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (!reading) return undefined;
    const id = reading.at.kind === 'line' ? reading.at.at.file : reading.at.file;
    return {
      path: window.loDiff?.files.find((file) => file.id === id)?.path,
      line: reading.at.kind === 'line' ? reading.at.at.line : 0,
      pane: reading.pane,
      /** How far down the window its line is drawn. */
      top: reading.top,
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

/** Presses keys one after another, as typed. */
async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** Collects what the window's content security policy refuses, from the page's console. */
function refusals(page: Page): string[] {
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  return refused;
}

test('gf opens the file at the cursor whole, at its line and in its side’s version, and ⌃o goes back to the same place', async ({
  page,
}) => {
  const refused = refusals(page);
  const id = await drawn(page);
  // To src/parser.ts's change, on the head's side.
  await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
  await press(page, 'g', 'g', ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'f', ']', 'c');
  await expect.poll(() => diffCursor(page)).toMatchObject({ path: 'src/parser.ts', pane: 'new' });
  const before = await diffCursor(page);
  expect(before?.line).toBeGreaterThan(1);

  // The whole file, at the same line, highlighted, in place of the diff.
  await press(page, 'g', 'f');
  await expect(code(page)).toBeVisible();
  await expect(code(page)).toContainText(
    '/** A line of input: its number, from 1, and its text. */',
  );
  await expect(page.locator('.lo-diffview')).toBeHidden();
  await expect
    .poll(() => wholeAt(page))
    .toEqual({ path: 'src/parser.ts', version: 'new', line: before?.line });
  await expect(whole(page)).toContainText('Changed in this pull request');
  await expect(code(page).locator('[class*="lo-syn-"]').first()).toBeVisible();
  await expect(code(page).locator('.cm-content')).toBeFocused();
  // The tree marks it.
  await expect(row(page, 'src/parser.ts')).toHaveClass(/tree-current/);

  // ⌃o: the diff, with its cursor on the same line, where it was on the page, and focus.
  await press(page, 'Control+o');
  await expect(page.locator('.lo-diffview')).toBeVisible();
  await expect(code(page)).toBeHidden();
  await expect
    .poll(() => diffCursor(page))
    .toMatchObject({ path: before?.path, line: before?.line, pane: before?.pane });
  expect(Math.abs((await diffCursor(page))!.top - before!.top)).toBeLessThanOrEqual(1);
  await expect(page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content')).toBeFocused();

  // ⌃i: the whole file again, where it was.
  await press(page, 'Control+i');
  await expect(code(page)).toBeVisible();
  await expect
    .poll(() => wholeAt(page))
    .toEqual({ path: 'src/parser.ts', version: 'new', line: before?.line });

  // Drawn afresh, as after showing another tab, the diff still comes back where it was.
  await page.evaluate(() => window.lo.invoke('tab.open', { kind: 'settings' }));
  await expect(page.locator('.lo-diffview')).toHaveCount(0);
  await page.evaluate((tab) => window.lo.invoke('tab.select', { id: tab }), id);
  await expect(code(page)).toBeVisible();
  await expect(page.locator('.lo-diffview')).toHaveCount(0);
  await press(page, 'Control+o');
  await expect(page.locator('.lo-diffview')).toBeVisible();
  await expect
    .poll(() => diffCursor(page))
    .toMatchObject({ path: before?.path, line: before?.line, pane: before?.pane });
  expect(Math.abs((await diffCursor(page))!.top - before!.top)).toBeLessThanOrEqual(1);

  // From the base's side, the base's version, by its old path.
  await press(page, 'Tab');
  await expect.poll(async () => (await diffCursor(page))?.pane).toBe('old');
  await press(page, 'g', 'f');
  await expect.poll(async () => (await wholeAt(page))?.path).toBe('src/parse.ts');
  await expect.poll(async () => (await wholeAt(page))?.version).toBe('old');
  await expect(whole(page)).toContainText('Before this pull request');
  await expect(code(page)).toContainText("input.split('\\n')");
  expect(refused).toEqual([]);
});

test('a file the pull request leaves alone opens whole from the tree, and Back returns to the diff', async ({
  page,
}) => {
  const refused = refusals(page);
  await drawn(page);
  await row(page, 'README.md').click();
  await expect(code(page)).toBeVisible();
  await expect(code(page)).toContainText('# App fixture');
  await expect(whole(page)).toContainText('Unchanged in this pull request');
  await expect.poll(() => wholeAt(page)).toMatchObject({ path: 'README.md', version: 'new' });
  // The keyboard stays in the tree, which marks the file.
  await expect(tree(page)).toBeFocused();
  await expect(row(page, 'README.md')).toHaveClass(/tree-current/);

  // ⏎ on a changed file goes back to the diff, at its header.
  await row(page, 'src/legacy.ts').click();
  await expect(page.locator('.lo-diffview')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const at = window.loDiff?.probe.cursor()?.at;
        const id = at?.kind === 'header' ? at.file : undefined;
        return window.loDiff?.files.find((file) => file.id === id)?.path;
      }),
    )
    .toBe('src/legacy.ts');

  // ⌃o from the tree goes back to the file left, and the bar's Back to the diff again.
  await press(page, 'Control+o');
  await expect(code(page)).toBeVisible();
  await expect(code(page)).toContainText('# App fixture');
  await whole(page).getByRole('button', { name: /^Back/ }).click();
  await expect(page.locator('.lo-diffview')).toBeVisible();
  // The tree follows the diff again.
  await expect(row(page, 'README.md')).not.toHaveClass(/tree-current/);
  expect(refused).toEqual([]);
});

test('the finder’s ⌘⏎ opens any file whole, and ` steps between the diff and it', async ({
  page,
}) => {
  const refused = refusals(page);
  await drawn(page);
  await page.locator('[data-lo-middle]').focus();
  await page.keyboard.press(`${held}+p`);
  const finder = page.getByRole('dialog', { name: 'Go to a file' });
  await expect(finder.getByRole('option').first()).toBeVisible();
  await page.keyboard.type('wrap');
  await expect(finder.getByRole('option').first()).toContainText('wrap.ts');
  await page.keyboard.press(`${held}+Enter`);
  await expect(finder).toBeHidden();
  await expect(code(page)).toContainText('export function wrap(text: string, width: number)');
  await expect(code(page).locator('.cm-content')).toBeFocused();

  // ` and ~ step through the middle views: the diff, then the file again, where it was.
  await press(page, 'j', 'j');
  await expect.poll(async () => (await wholeAt(page))?.line).toBe(3);
  await press(page, '`');
  await expect(page.locator('.lo-diffview')).toBeVisible();
  await expect(code(page)).toBeHidden();
  await press(page, '`');
  await expect(code(page)).toBeVisible();
  await expect(code(page)).toContainText('export function wrap(text: string, width: number)');
  await expect
    .poll(() => wholeAt(page))
    .toEqual({ path: 'src/text/wrap.ts', version: 'new', line: 3 });
  await press(page, '~');
  await expect(page.locator('.lo-diffview')).toBeVisible();
  expect(refused).toEqual([]);
});
