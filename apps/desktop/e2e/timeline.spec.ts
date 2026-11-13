// A pull request's timeline: shown from its diff with `, read from GitHub as it's first shown, its
// description, its push and its reviews drawn as rows, and moved through with j and k. Without git,
// so the tab has only what GitHub says.

import { writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { cassetteDir, parseJson, readCassette, type Json } from '@lo/testing';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';

/** The cassette, recorded from the app on rozed-dev/e2e#23: one push, and ten reviews. */
const CASSETTE = 'app_timeline';
const NUMBER = 23;

/** A stand-in token, never a real one: the cassette answers for it as rozed-bot. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** An object of JSON, or nothing for any other value. */
function objectOf(value: Json | undefined): { [key: string]: Json } | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

/** GitHub's recorded answer to a read of posts' HTML. */
function recordedBodies(): { [key: string]: Json } {
  const recorded = readCassette(cassetteDir(CASSETTE)).interactions.find(
    ({ interaction }) => interaction.request.operation === 'RenderedBodies',
  );
  const data = objectOf(objectOf(recorded?.interaction.response.body)?.['data']);
  if (!data) throw new Error(`${CASSETTE} has no read of posts' HTML`);
  return data;
}

/**
 * GitHub's answer to a read of the HTML of posts `ids`, from the one recorded. Which posts the
 * window asks for at once depends on which are near the screen, and so on the window's size, so
 * each is answered alone, and one that wasn't recorded as GitHub answers an ID it has no post for.
 */
function bodiesFor(recorded: { [key: string]: Json }, ids: readonly string[]): Json {
  const nodes = Array.isArray(recorded['nodes']) ? recorded['nodes'] : [];
  const byId = new Map(nodes.map((node) => [objectOf(node)?.['id'], node]));
  return { data: { ...recorded, nodes: ids.map((id) => byId.get(id) ?? null) } };
}

function json(outgoing: ServerResponse, body: Json): void {
  outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  outgoing.end(JSON.stringify(body));
}

const test = base.extend<{ github: ReplayServer; githubOrigin: string }>({
  // oxlint-disable-next-line no-empty-pattern
  github: async ({}, use) => {
    const server = await serveReplay(CASSETTE);
    await use(server);
    await server.close();
  },
  githubOrigin: async ({ github }, use) => {
    const origin = new URL(github.urls.api).origin;
    const recorded = recordedBodies();
    // Passes each request on to the replay server, but a read of posts' HTML, answered here.
    const front = createServer((incoming, outgoing) => {
      void (async () => {
        const body = await buffer(incoming);
        if (incoming.url?.endsWith('/graphql')) {
          const asked = objectOf(parseJson(body.toString('utf8')));
          if (asked?.['operationName'] === 'RenderedBodies') {
            const ids = objectOf(asked['variables'])?.['ids'];
            const strings = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
            return json(outgoing, bodiesFor(recorded, strings));
          }
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === 'string' && name !== 'host') headers.set(name, value);
        }
        const method = incoming.method ?? 'GET';
        const response = await fetch(`${origin}${incoming.url ?? '/'}`, {
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
          redirect: 'manual',
        });
        const out: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
            out[name] = value;
          }
        });
        outgoing.writeHead(response.status, out);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return undefined;
      })().catch(() => {
        // The test has ended, and the replay server with it: the request goes unanswered.
        outgoing.destroy();
      });
    });
    await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
    const address = front.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    await use(`http://127.0.0.1:${address.port}`);
    front.closeAllConnections();
    await new Promise((resolve) => front.close(resolve));
  },
  launch: async ({ githubOrigin }, use) => {
    const tokenFile = base.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: githubOrigin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT: 'none' },
    });
  },
});

// The diff, not the overview, is what the tab opens on.
test.use({ settings: DIFF_FIRST });

/** Waits for the account from the token file, then opens #23's tab. */
async function open(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (number) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number }),
    NUMBER,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
}

/**
 * Waits for the middle view `id` to take focus, as each does once it's shown. A focus move drops
 * keys typed before it, so the next keys wait for it.
 */
async function focusedOn(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement
              ?.closest('[data-lo-middle-view]')
              ?.getAttribute('data-lo-middle-view') ?? null,
        ),
      { timeout: 20_000 },
    )
    .toBe(id);
}

test('` steps from the diff to the timeline, read as it’s first shown; j, k and Tab move through it, and a row’s menu acts on the row', async ({
  page,
}) => {
  await open(page);
  await focusedOn(page, 'diff.view');
  // The whole file comes between the diff and the timeline.
  await page.keyboard.press('`');
  await focusedOn(page, 'diff.whole');
  await page.keyboard.press('`');

  const timeline = page.getByRole('listbox', { name: 'Timeline' });
  await expect(timeline).toBeFocused({ timeout: 20_000 });
  const rows = timeline.getByRole('option');
  // The description, the push and each submitted review.
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText('opened this');
  await expect(rows.nth(0)).toContainText('Fixture E11 (review writes)');
  await expect(rows.nth(1)).toContainText('pushed 1 commit');
  await expect(rows.nth(1)).toContainText('5a48d22');
  await expect(rows.nth(1)).toContainText('test(e11): change lines in three places');
  await expect(rows.nth(2)).toContainText('left a review on r1');
  await expect(rows.nth(2)).toContainText(
    "Fixture E11: the pending review's summary, submitted as a comment.",
  );

  // The keyboard starts on the description, the first row.
  const on = async () => {
    const id = await timeline.getAttribute('aria-activedescendant');
    return id === null ? undefined : page.locator(`[id="${id}"]`).textContent();
  };
  await expect.poll(on).toContain('opened this');
  await page.keyboard.press('j');
  await expect.poll(on).toContain('pushed 1 commit');
  await page.keyboard.press('j');
  await expect.poll(on).toContain('left a review on r1');
  await page.keyboard.press('k');
  await expect.poll(on).toContain('pushed 1 commit');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  // k on the first row stays there, as in the app's other lists.
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect.poll(on).toContain('opened this');

  await test.step('Tab goes through the links and buttons of the row the keyboard is on, and Esc back to the list', async () => {
    // The fifth review left a comment in the diff.
    const review = rows.nth(6);
    await review.click();
    await expect(timeline).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(review.getByRole('button', { name: 'Show in the diff' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(timeline).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(review.getByRole('button', { name: 'Show in the diff' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(timeline).toBeFocused();
    await expect.poll(on).toContain('1 comment');
  });

  await test.step('` goes round from the timeline, the last middle view, to the overview, the first', async () => {
    await page.keyboard.press('`');
    await focusedOn(page, 'overview.view');
    await page.keyboard.press('~');
    await expect(timeline).toBeFocused();
  });

  await test.step('a row’s menu offers what its buttons do, and the keyboard’s row is the palette’s', async () => {
    const menu = page.getByRole('menu', { name: 'Row actions' });
    // A right-click on the push: the keyboard moves to it, and its menu has no review's actions.
    await rows.nth(1).click({ button: 'right' });
    await expect(menu.getByRole('menuitem', { name: /Open on GitHub/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /comments in the diff/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect.poll(on).toContain('pushed 1 commit');
    // ⇧F10 on the review that left a comment: its menu shows it in the diff.
    for (let step = 0; step < 5; step += 1) await page.keyboard.press('j');
    await expect.poll(on).toContain('1 comment');
    await page.keyboard.press('Shift+F10');
    await menu.getByRole('menuitem', { name: /Show the review’s comments in the diff/ }).click();
    await focusedOn(page, 'diff.view');
  });
});
