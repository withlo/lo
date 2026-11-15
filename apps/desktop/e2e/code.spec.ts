// The syntax index in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80, which nothing trusts, and builds its index from the local copy, which the
// status bar says while it builds and once it's ready. The code port main hands the page answers a
// definition from it, and refuses a view that isn't open. GitHub answers from `app_e2e`.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

declare global {
  interface Window {
    /** The newest code port main handed the page, beside the window's own hold on it. */
    codePort?: MessagePort;
  }
}

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

/**
 * Loads the page again with a listener that keeps the code port main hands each load, beside the
 * window's own, so the test can ask main what the window would.
 */
async function catchCodePort(app: ElectronApplication, page: Page): Promise<void> {
  await app.context().addInitScript(() => {
    window.addEventListener('message', (event: MessageEvent<{ type?: string }>) => {
      const [port] = event.ports;
      if (event.source !== window || event.data.type !== 'lo:code' || !port) return;
      port.start();
      window.codePort = port;
    });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => window.codePort !== undefined)).toBe(true);
}

/** Asks main a question over the code port, and waits for its answer. */
function ask(page: Page, request: { id: number; job: string; input: unknown }) {
  return page.evaluate(
    (question) =>
      new Promise((resolve) => {
        const port = window.codePort;
        const timer = setTimeout(() => resolve('no answer'), 20_000);
        port?.addEventListener('message', (event: MessageEvent<{ id?: number }>) => {
          if (event.data.id !== question.id) return;
          clearTimeout(timer);
          resolve(event.data);
        });
        port?.postMessage(question);
      }),
    request,
  );
}

/** Opens #80 once rozed-bot is signed in, and returns its tab's id. */
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
  return reply.value;
}

test('builds the syntax index of a PR nothing trusts, says so in the status bar, and answers a definition over the code port', async ({
  app,
  page,
}) => {
  test.setTimeout(120_000);
  await catchCodePort(app, page);
  const id = await open(page);
  const status = page.locator('footer[aria-label="Status"]');

  await test.step('the status bar says the index is building, then ready', async () => {
    const states: string[] = [];
    await expect
      .poll(
        async () => {
          const reply = await page.evaluate((view) => window.lo.invoke('code.index', { view }), id);
          const state = reply.ok ? JSON.stringify(reply.value) : JSON.stringify(reply);
          if (states.at(-1) !== state) states.push(state);
          return reply.ok ? reply.value : reply;
        },
        { timeout: 60_000, intervals: [100] },
      )
      .toEqual({ kind: 'ready', partial: null });
    expect(states.some((state) => state.includes('"building"'))).toBe(true);
    await expect(status.getByText('Syntax index', { exact: true })).toBeVisible();
  });

  await test.step('the code port answers a definition from the index', async () => {
    // `Line` in src/format.ts's import of it.
    const reply = await ask(page, {
      id: 1,
      job: 'code.definitions',
      input: { view: id, key: APP_PULL.head, path: 'src/format.ts', line: 1, column: 15 },
    });
    expect(reply).toMatchObject({
      id: 1,
      ok: true,
      value: {
        name: 'Line',
        answers: [
          {
            key: APP_PULL.head,
            side: 'new',
            path: 'src/parser.ts',
            line: 2,
            column: 17,
            kind: 'interface',
            source: 'syntax',
            label: 'Syntax index',
            changed: true,
            lines: { from: 1 },
          },
        ],
      },
    });
  });

  await test.step('it refuses a view that isn’t open, and a line past the end', async () => {
    expect(
      await ask(page, {
        id: 2,
        job: 'code.definitions',
        input: { view: 'nothing', key: APP_PULL.head, path: 'src/format.ts', line: 1, column: 15 },
      }),
    ).toMatchObject({ id: 2, ok: false, error: { code: 'refused' } });
    expect(
      await ask(page, {
        id: 3,
        job: 'code.definitions',
        input: { view: id, key: APP_PULL.head, path: 'src/format.ts', line: 400, column: 0 },
      }),
    ).toMatchObject({ id: 3, ok: false, error: { code: 'invalid' } });
  });
});
