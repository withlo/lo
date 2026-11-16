// Code features in the app, from the syntax index: Lo started on the replay server, as rozed-bot,
// opens rozed-dev/e2e#80, which nothing trusts, and once its index is built, `gd` on a name opens a
// peek of its definition under the line, `⏎` goes there in the diff, on the side it's on, and `⌃o`
// comes back; `K` shows its line in a card over the word; `gr` lists where it's used in the right
// panel, and `⏎` goes to one, and `Esc` puts the panel back as it was; `gO` lists the file's
// symbols; and `gh` says type hints need a language server, which Lo runs only on repos you trust.
// Once the repo is trusted, with the fake language server standing in for TypeScript's, `gd`'s
// answer is labelled TypeScript and `gh` shows its hint. GitHub answers from `app_e2e`, and, once
// the repo is trusted, from `pull_request_repositories_e2e`.

import { writeFileSync } from 'node:fs';

import { cassette, Replay } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import {
  answerDialogs,
  appFolder,
  DIFF_FIRST,
  expect,
  KEYCHAIN,
  test as base,
  testServers,
  type TestServers,
} from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{ github: ReplayServer }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay('app_e2e');
    await use(server);
    await server.close();
  },
  launch: async ({ github }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
      },
    });
  },
});

test.use({ settings: DIFF_FIRST });

/** Opens #80 once rozed-bot is signed in, waits for its diff and its syntax index, and returns its tab's id. */
async function opened(page: Page): Promise<string> {
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
        const state = await page.evaluate((view) => window.lo.invoke('code.index', { view }), id);
        return state.ok ? state.value : state;
      },
      { timeout: 60_000 },
    )
    .toEqual({ kind: 'ready', partial: null });
  await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  return id;
}

/** Where the diff's cursor is: the file's path, the side and the line. */
function cursor(page: Page) {
  return page.evaluate(() => {
    const reading = window.loDiff?.probe.cursor();
    if (reading?.at.kind !== 'line') return undefined;
    const { at } = reading.at;
    return {
      path: window.loDiff?.files.find((file) => file.id === at.file)?.path,
      side: at.side,
      line: at.line,
    };
  });
}

/** Presses keys one after another, as typed. */
async function press(page: Page, ...keys: string[]): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
}

/** The key that opens and closes the right panel, on the threads unless another view showed last. */
const PANEL = `${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+Backslash`;

const peek = (page: Page) => page.locator('.lo-diffpeek');
const status = (page: Page) => page.locator('footer[aria-label="Status"]');

test('gd, K, gr, gO and gh answer from the syntax index of a PR nothing trusts', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await opened(page);
  // To `Line` in src/format.ts's first line, `import type { Line } from './parser.ts';`, on the
  // head's side.
  await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
  await press(page, 'g', 'g', ']', 'f', ']', 'f', ']', 'f', 'j', 'f', 'Shift+L');
  await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 1 });

  await test.step('gd opens a peek of the definition, ⏎ goes there, and ⌃o comes back', async () => {
    await press(page, 'g', 'd');
    // Under the last line on screen, it comes on screen whole.
    await expect(peek(page)).toBeInViewport({ ratio: 1 });
    await expect(peek(page).locator('.lo-diffpeek__head')).toContainText('Line · 1 definition');
    await expect(peek(page).locator('.lo-diffpeek__code')).toContainText('export interface Line {');
    await expect(peek(page).locator('.lo-diffpeek__foot')).toContainText('src/parser.ts');
    await expect(peek(page)).toBeFocused();
    await press(page, 'Enter');
    await expect(peek(page)).toHaveCount(0);
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/parser.ts', side: 'new', line: 2 });
    await press(page, 'Control+o');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 1 });
  });

  await test.step('on the base’s side, the definition there, on the diff’s old side', async () => {
    await press(page, 'Tab');
    await expect.poll(async () => (await cursor(page))?.side).toBe('old');
    await press(page, '0', 'f', 'Shift+L', 'g', 'd');
    await expect(peek(page).locator('.lo-diffpeek__foot')).toContainText('src/parse.ts');
    await press(page, 'Enter');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/parser.ts', side: 'old', line: 2 });
    await press(page, 'Control+o');
    await press(page, 'Tab');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 1 });
  });

  await test.step('K shows the definition’s line in a card over the word, and a key closes it', async () => {
    await press(page, '0', 'f', 'Shift+L', 'Shift+K');
    const card = page.locator('[data-lo-hover]');
    await expect(card).toContainText('export interface Line {');
    await expect(card).toContainText('Syntax index');
    // It takes no focus.
    await expect(
      page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content'),
    ).toBeFocused();
    await press(page, 'Escape');
    await expect(card).toHaveCount(0);
  });

  await test.step('gr lists the references in the right panel, and ⏎ goes to one', async () => {
    await press(page, 'g', 'r');
    const panel = page.locator('aside[data-lo-right="code.references"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('group', { name: 'src/format.ts' })).toBeVisible();
    await expect(panel.getByRole('group', { name: 'src/parser.ts' })).toBeVisible();
    await expect(panel.locator('[data-lo-scope="references"]')).toBeFocused();
    // The asked file's first: the import, then `readonly Line[]`.
    await press(page, 'j', 'Enter');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 6 });
    await press(page, 'Control+o');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 1 });
    // Asked again from the code while they show, the references take focus again.
    await press(page, 'g', 'r');
    await expect(panel.locator('[data-lo-scope="references"]')).toBeFocused();
  });

  await test.step('Esc puts the panel back as it was, closed, on the threads it opens on next', async () => {
    await press(page, 'Escape');
    await expect(page.locator('aside[data-lo-right]')).toHaveCount(0);
    await press(page, PANEL);
    await expect(page.locator('aside[data-lo-right="comments.panel"]')).toBeVisible();
    await press(page, PANEL);
    await expect(page.locator('aside[data-lo-right]')).toHaveCount(0);
    await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
  });

  await test.step('gO lists the file’s symbols, and ⏎ goes to one', async () => {
    // Typed at once, perhaps before the symbols come, which the palette finds by it as they do.
    await press(page, 'g', 'Shift+O');
    await page.keyboard.type('form');
    const outline = page.getByRole('dialog', { name: 'Outline' });
    await expect(outline.getByRole('option', { name: /format/ })).toBeVisible();
    await press(page, 'Enter');
    await expect(outline).toHaveCount(0);
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 6 });
  });

  await test.step('gh says type hints need a language server, which Lo runs on trusted repos', async () => {
    await press(page, 'g', 'h');
    await expect(
      status(page).getByText(
        'Type hints need a language server, which Lo runs only on repos you trust.',
      ),
    ).toBeVisible();
  });
});

/**
 * What the fake server answers: `Line`, in src/format.ts's import of it, is on line 2 of
 * src/parser.ts, and the head's src/format.ts has one hint, `: Line` after the `line` of its line 6,
 * `  return lines.map((line) => …`.
 */
const SERVED = {
  'textDocument/definition': {
    '*': [
      {
        uri: '$ROOT/src/parser.ts',
        range: { start: { line: 1, character: 17 }, end: { line: 1, character: 21 } },
      },
    ],
  },
  'textDocument/inlayHint': {
    'src/format.ts': [
      { position: { line: 5, character: 24 }, label: ': Line', paddingLeft: false },
    ],
  },
};

const trusting = test.extend<{ servers: TestServers }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const interactions = ['app_e2e', 'pull_request_repositories_e2e'].flatMap((name) =>
      cassette(name).interactions.map(({ interaction }) => interaction),
    );
    const server = await serveReplay(new Replay('app_e2e with its repositories', interactions));
    await use(server);
    await server.close();
  },
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  servers: async ({}, use) => {
    const servers = testServers(test.info().outputPath('servers'), { answers: SERVED });
    await use(servers);
    // After Lo has closed, which stops them itself.
    servers.kill();
  },
  launch: async ({ github, servers }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: {
        LO_GITHUB: new URL(github.urls.api).origin,
        LO_TEST_TOKEN_FILE: tokenFile,
        LO_GIT_REMOTE: writeAppRemote(test.info().outputPath('remote')),
        ...servers.env,
      },
    });
  },
});

trusting(
  'gd is labelled with the language server’s name and gh shows its hint, once the repo is trusted',
  async ({ app, page }) => {
    test.setTimeout(120_000);
    const id = await opened(page);
    await answerDialogs(app, 'Trust');
    expect(
      await page.evaluate(
        (view) => window.lo.invoke('code.trust', { view, repo: 'rozed-dev/e2e', pull: null }),
        id,
      ),
    ).toEqual({ ok: true, value: 'trusted' });
    // Ready, its item is its name alone.
    await expect(status(page).getByRole('button', { name: 'TypeScript', exact: true })).toBeVisible(
      {
        timeout: 60_000,
      },
    );
    await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
    await press(page, 'g', 'g', ']', 'f', ']', 'f', ']', 'f', 'j', 'f', 'Shift+L');
    await expect.poll(() => cursor(page)).toEqual({ path: 'src/format.ts', side: 'new', line: 1 });

    await test.step('gd’s one answer is the server’s, and its head says so', async () => {
      await press(page, 'g', 'd');
      const head = peek(page).locator('.lo-diffpeek__head');
      await expect(head).toContainText('Line · 1 definition');
      await expect(head).toContainText('TypeScript');
      await expect(head).not.toContainText('Syntax index');
      await expect(peek(page).locator('.lo-diffpeek__code')).toContainText(
        'export interface Line {',
      );
      await press(page, 'Escape');
      await expect(peek(page)).toHaveCount(0);
    });

    await test.step('gh shows the server’s hint, on the reader’s next key', async () => {
      await press(page, 'g', 'h');
      // A hint that comes after the keys is held until the next input, so nothing moves meanwhile.
      await expect
        .poll(
          async () => {
            await press(page, 'l', 'h');
            return page.locator('.lo-diffview .lo-inlay').allTextContents();
          },
          { timeout: 20_000 },
        )
        .toEqual([': Line']);
    });
  },
);
