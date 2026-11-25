// The code index in the app: Lo started on the replay server, as rozed-bot, opens
// rozed-dev/e2e#80, which nothing trusts, and builds its index from the local copy, which the
// status bar says while it builds and once it's ready. The code port main hands the page answers a
// definition from it, and refuses a view that isn't open. Once the repo is trusted, a language
// server, here the fake one, runs on the PR's head, its answer to a definition comes first, `gd` in
// the diff says it's TypeScript's and `gh` shows its type hint, and "Restart" in its status item
// starts it again; killed, it shows as failed until restarted, and "Stop trusting" stops it. GitHub
// answers from `app_e2e`, and, once the repo is trusted, from `pull_request_repositories_e2e`.

import { writeFileSync } from 'node:fs';

import { cassette, Replay } from '@lo/testing';
import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import {
  answerDialogs,
  appFolder,
  DIFF_FIRST,
  DIFF_FIRST_VIM,
  expect,
  KEYCHAIN,
  test as base,
  testServers,
  type TestServers,
} from './app.ts';

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
  const status = page.locator('footer[aria-label="Status bar"]');

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
      .toMatchObject({ kind: 'ready', partial: null });
    expect(states.some((state) => state.includes('"building"'))).toBe(true);
    await expect(status.getByText('Code index', { exact: true })).toBeVisible();
    // A click says what it is, and what it covers.
    await status.getByRole('button', { name: 'Code index' }).click();
    const details = page.getByRole('dialog', { name: 'Code index' });
    await expect(details).toContainText('Ready');
    await expect(details).toContainText('TypeScript');
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
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
            label: 'Code index',
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

/**
 * Where the fake server says `Line` is, line 2 of src/parser.ts in the checkout of the head, and
 * the type hint it gives on src/format.ts's line 6.
 */
const LINE = {
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
    const servers = testServers(test.info().outputPath('servers'), { answers: LINE });
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

trusting.describe('once the repo is trusted', () => {
  // With Vim keys on: the diff's cursor goes to a word with Vim's motions (`j`, `f L`).
  trusting.use({ settings: DIFF_FIRST_VIM });

  trusting(
    'runs a language server on a trusted PR’s head, answers from it first, restarts it from its status item, and stops it once trust goes',
    async ({ app, page, servers }) => {
      test.setTimeout(120_000);
      await catchCodePort(app, page);
      const id = await open(page);
      const status = page.locator('footer[aria-label="Status bar"]');
      const started = () => servers.seen().filter((seen) => seen.event === 'started');

      await test.step('nothing runs until the repo is trusted', async () => {
        await expect
          .poll(async () => {
            const reply = await page.evaluate(
              (view) => window.lo.invoke('code.state', { view }),
              id,
            );
            return reply.ok ? reply.value : reply;
          })
          .toMatchObject({ trust: { kind: 'untrusted' } });
        expect(started()).toEqual([]);
        await answerDialogs(app, 'Trust repo');
        expect(
          await page.evaluate(
            (view) => window.lo.invoke('code.trust', { view, repo: 'rozed-dev/e2e', pull: null }),
            id,
          ),
        ).toEqual({ ok: true, value: 'trusted' });
      });

      let asked = 10;
      /** Asks main where `Line`, in src/format.ts's import of it, is defined, until the server says. */
      const answered = () =>
        expect
          .poll(
            async () => {
              asked += 1;
              return ask(page, {
                id: asked,
                job: 'code.definitions',
                input: { view: id, key: APP_PULL.head, path: 'src/format.ts', line: 1, column: 15 },
              });
            },
            { timeout: 60_000 },
          )
          .toMatchObject({
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
                  source: 'server',
                  label: 'TypeScript',
                },
              ],
            },
          });

      await test.step('the server’s definition comes first, labelled with its name', async () => {
        await answered();
        // It runs on the checkout of the head.
        const [initialize] = servers.seen().filter((seen) => seen.event === 'initialize');
        expect(initialize?.params.rootUri).toMatch(
          new RegExp(`/pull-${APP_PULL.number}/${APP_PULL.head}$`),
        );
      });

      await test.step('in the diff, gd’s one answer is the server’s, its head says so, and gh shows the server’s hint on the reader’s next key', async () => {
        await expect(page.locator('.lo-diffview')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('GitHub’s diff', { exact: true })).toHaveCount(0, {
          timeout: 20_000,
        });
        // Ready, its item is its name alone.
        await expect(status.getByRole('button', { name: 'TypeScript', exact: true })).toBeVisible();
        await page.locator('.lo-diffview .cm-editor').nth(1).locator('.cm-content').focus();
        await press(page, 'g', 'g', ']', 'f', ']', 'f', ']', 'f', 'j', 'f', 'Shift+L');
        await expect
          .poll(() => cursor(page))
          .toEqual({ path: 'src/format.ts', side: 'new', line: 1 });

        await press(page, 'g', 'd');
        const peek = page.locator('.lo-diffpeek');
        const head = peek.locator('.lo-diffpeek__head');
        await expect(head).toContainText('Line · 1 definition');
        await expect(head).toContainText('TypeScript');
        await expect(head).not.toContainText('Code index');
        await expect(peek.locator('.lo-diffpeek__code')).toContainText('export interface Line {');
        await press(page, 'Escape');
        await expect(peek).toHaveCount(0);

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

      await test.step('“Restart” in its status item starts it again', async () => {
        await status.getByRole('button', { name: 'TypeScript', exact: true }).click();
        await page.getByRole('button', { name: 'Restart', exact: true }).click();
        await expect.poll(() => started().length, { timeout: 20_000 }).toBe(2);
        // The first was shut down, and the second answers.
        await answered();
        const events = servers.seen().map((seen) => seen.event);
        expect(events.indexOf('shutdown')).toBeLessThan(events.lastIndexOf('started'));
        expect(events.lastIndexOf('request')).toBeGreaterThan(events.lastIndexOf('started'));
        await expect(status.getByRole('button', { name: 'TypeScript', exact: true })).toBeVisible();
      });

      await test.step('killed, it shows as failed, and “Restart” beside it starts it again', async () => {
        process.kill(-(started().at(-1)?.pid ?? 0), 'SIGKILL');
        await expect(
          status.getByRole('button', { name: 'TypeScript isn’t running', exact: true }),
        ).toBeVisible({ timeout: 20_000 });
        await status.getByRole('button', { name: 'Restart TypeScript', exact: true }).click();
        await expect.poll(() => started().length, { timeout: 20_000 }).toBe(3);
        await answered();
      });

      await test.step('“Stop trusting” stops it', async () => {
        const pid = started().at(-1)?.pid ?? 0;
        await status.getByRole('button', { name: 'TypeScript', exact: true }).click();
        await page.getByRole('button', { name: 'Stop trusting', exact: true }).click();
        await expect.poll(() => running(pid), { timeout: 20_000 }).toBe(false);
        await expect(
          status.getByRole('button', { name: 'Language servers off', exact: true }),
        ).toBeVisible();
        expect(started()).toHaveLength(3);
      });
    },
  );
});

/** Whether process `pid` is still there. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
