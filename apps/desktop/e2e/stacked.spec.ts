// A stack's overview in the app: Lo, started on the replay server as rozed-bot, opens #C, a layer of
// the stack #A, #B, #C and #D, whose overview names the stack's, `refs/lo/stack/82`. The stack's
// tree has a row for it first, which shows it in the Overview view, as `g s` and the notice on the
// layer's own overview do: its byline, its tl;dr, then Layers, the stack drawn live, each layer with
// its overview's tl;dr, else its description's first line, else "No description". Showing a layer
// shows that layer's own again, and `⌃o` comes back. Its code is the whole stack's, and goes to all
// the layers as one diff. A server in front of the replay server answers for the overviews' refs,
// commits and files, and for #D's description, which it empties.

import { createHash } from 'node:crypto';

import { STACK_PULLS } from '@lo/testing/git';
import type { Page } from '@playwright/test';

import { expect, frontOf, onStacks, STACK } from './app.ts';

/** The stack's id: its bottom layer's number, as the skill names a stack of branches. */
const STACK_ID = STACK.a;

/** A blob's ID: what git names its bytes by. */
function blobId(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** An overview's commit made here: its ID, its tree's, and its `artifact.md`. */
interface Made {
  sha: string;
  tree: string;
  text: Uint8Array;
}

function made(seed: string, text: string): Made {
  return {
    sha: createHash('sha1').update(`commit ${seed}`).digest('hex'),
    tree: createHash('sha1').update(`tree ${seed}`).digest('hex'),
    text: new TextEncoder().encode(text),
  };
}

/** #C's own overview, which names the stack's. */
const OWN = made(
  'c',
  `---\nformat: 1\npr: ${STACK.c}\nstack: ${STACK_ID}\ncommit: ${STACK_PULLS.c.head}\n---\n\n## tl;dr\n\nCounts a query's nodes before it's sent.\n\n## How it works\n\nIt walks the query.\n`,
);

/** #A's, which Layers shows the tl;dr of. */
const BOTTOM = made(
  'a',
  `---\nformat: 1\npr: ${STACK.a}\nstack: ${STACK_ID}\ncommit: ${STACK_PULLS.a.head}\n---\n\n## tl;dr\n\nLoads each plan's limit, so a team gets more points than the default.\n\n## Why\n\nTeams asked.\n`,
);

/** The stack's, written at #C's head, with code the whole stack adds. */
const STACKED = made(
  'stack',
  `---\nformat: 1\nstack: ${STACK_ID}\ncommit: ${STACK_PULLS.c.head}\n---\n\n## tl;dr\n\nRate limits GraphQL queries by what each costs, against the limit of the plan the client is on.\n\n## How the layers fit\n\nThe plans come first, then what a query costs, then counting it. A plan names its limit:\n\n:::code src/plans.ts#L9-L12\n:::\n`,
);

/** What each overview's ref holds, by its full name. */
const REFS: Readonly<Record<string, Made>> = {
  [`refs/lo/pr/${STACK.a}`]: BOTTOM,
  [`refs/lo/pr/${STACK.c}`]: OWN,
  [`refs/lo/stack/${STACK_ID}`]: STACKED,
};

const REPO = '/repos/rozed-dev/e2e';

/** What the front answers for `path` itself, or none, for the replay server to answer. */
async function answerFor(origin: string, url: string): Promise<Response | undefined> {
  // The replay server serves GitHub's REST API under /api.
  const path = url.replace(/^\/api\//, '/').replace(/\?.*$/, '');
  const prefix = /^\/repos\/rozed-dev\/e2e\/git\/matching-refs\/(lo\/.*)$/.exec(path)?.[1];
  if (prefix !== undefined) {
    const listed = Object.entries(REFS)
      .filter(([ref]) => ref.startsWith(`refs/${prefix}`))
      .map(([ref, { sha }]) => ({ ref, object: { sha, type: 'commit' } }));
    const etag = `"${createHash('sha1').update(JSON.stringify(listed)).digest('hex')}"`;
    return Response.json(listed, { headers: { etag } });
  }
  for (const each of Object.values(REFS)) {
    if (path === `${REPO}/git/trees/${each.sha}`) {
      return Response.json({
        sha: each.sha,
        tree: [
          {
            path: 'artifact.md',
            mode: '100644',
            type: 'blob',
            sha: blobId(each.text),
            size: each.text.length,
          },
        ],
        truncated: false,
      });
    }
    if (path === `${REPO}/git/blobs/${blobId(each.text)}`) {
      return new Response(Buffer.from(each.text), {
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    if (path === `${REPO}/commits/${each.sha}`) {
      const who = { name: 'rozed-bot', email: 'bot@example.com', date: '2026-11-25T09:30:00Z' };
      return Response.json({
        sha: each.sha,
        commit: { author: who, committer: who, message: 'Overview', tree: { sha: each.tree } },
        author: { login: 'rozed-bot', type: 'User' },
      });
    }
  }
  // #D has no description.
  if (path === `${REPO}/pulls/${STACK.d}`) {
    const recorded = await fetch(`${origin}${url}`);
    const pull: unknown = await recorded.json();
    return Response.json({ ...(pull as object), body: null }, { headers: { etag: '"d"' } });
  }
  return undefined;
}

const test = onStacks.extend({
  githubOrigin: async ({ github }, use) => {
    const origin = new URL(github.urls.api).origin;
    const front = await frontOf(origin, (url) => answerFor(origin, url));
    await use(front.origin);
    await front.close();
  },
});

/** Waits for the account from the token file, then opens pull request `number`'s tab. */
async function open(page: Page, number: number): Promise<string> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    number,
  );
  if (!reply.ok || typeof reply.value !== 'string') throw new Error(JSON.stringify(reply));
  return reply.value;
}

/** The stack's tree on screen. */
const treeOf = (page: Page) => page.getByRole('tree', { name: 'Layers' });

/** The stack overview's row, first in the tree. */
const overviewRow = (page: Page) => treeOf(page).locator('[role="treeitem"][data-key="overview"]');

/** The stack's tree's row for layer `number`. */
const rowOf = (page: Page, number: number) =>
  treeOf(page).locator(`[role="treeitem"][data-key="${number}"]`);

/** The Overview view, drawn. */
const overviewView = (page: Page) => page.locator('[data-lo-middle-view="overview.view"]');

/** The overview's article. */
const article = (page: Page) => overviewView(page).locator('.lo-ov__article');

/** The header's view switch. */
const views = (page: Page) => page.getByRole('tablist', { name: 'View' });

test('the stack’s row shows its overview, with Layers, and a layer shows its own again', async ({
  page,
}) => {
  await open(page, STACK.c);
  // The row arrives first once the stack's overview is read, above the base branch's.
  await expect(overviewRow(page)).toBeVisible({ timeout: 20_000 });
  const items = treeOf(page).locator('[role="treeitem"]');
  await expect(items.first()).toHaveAttribute('data-key', 'overview');
  await expect(overviewRow(page)).toHaveText('Stack overview');
  await expect(overviewRow(page)).not.toHaveAttribute('aria-current', 'true');

  await overviewRow(page).click();
  await expect(overviewRow(page)).toHaveAttribute('aria-current', 'true');
  // The header, and the layer's ball, stay #C's.
  await expect(rowOf(page, STACK.c).locator('.stack-ball-current')).toHaveCount(1);
  await expect(overviewView(page).locator('[data-lo-byline]')).toContainText('Stack overview');
  await expect(overviewView(page).locator('.lo-toc__label')).toHaveText('Stack overview');
  await expect(article(page)).toContainText('Rate limits GraphQL queries by what each costs');
  // Layers, after the tl;dr and before the writer's other sections.
  const headings = article(page).getByRole('heading', { level: 2 });
  await expect(headings).toHaveText(['tl;dr', 'Layers', 'How the layers fit']);
  const layers = article(page).getByRole('list', { name: 'Layers' });
  const layer = (number: number) => layers.locator(`[data-key="${number}"]`);
  await expect(layers.getByRole('listitem')).toHaveCount(4);
  await expect(layer(STACK.a)).toContainText("Loads each plan's limit");
  await expect(layer(STACK.b)).toContainText('A pull request of the stacks Lo');
  await expect(layer(STACK.c)).toContainText('Counts a query');
  await expect(layer(STACK.d)).toContainText('No description');
  await expect(layer(STACK.c)).toHaveAttribute('aria-current', 'true');

  // A layer's row in Layers shows that layer, with its own overview.
  await layer(STACK.b).click();
  await expect(views(page).getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(rowOf(page, STACK.b)).toHaveAttribute('aria-current', 'true');
  await expect(overviewRow(page)).not.toHaveAttribute('aria-current', 'true');
});

test('g s and the notice show the stack overview, ⌃o comes back, and its code is the whole stack’s', async ({
  page,
}) => {
  await open(page, STACK.c);
  await expect(overviewRow(page)).toBeVisible({ timeout: 20_000 });
  // #C's own overview, with the notice above what follows the byline.
  await views(page).getByRole('tab', { name: 'Overview' }).click();
  const notice = overviewView(page)
    .getByRole('note')
    .filter({ hasText: 'Part of a 4-layer stack' });
  await expect(notice).toBeVisible();
  await expect(article(page)).toContainText('Counts a query');

  await notice.getByRole('button', { name: /Stack overview/ }).click();
  await expect(overviewView(page).locator('[data-lo-byline]')).toContainText('Stack overview');
  await expect(overviewRow(page)).toHaveAttribute('aria-current', 'true');
  // Back to #C's own.
  await page.keyboard.press('Control+o');
  await expect(notice).toBeVisible();
  // g s, from anywhere in the tab.
  await article(page).click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(overviewView(page).locator('[data-lo-byline]')).toContainText('Stack overview');

  // Its code block shows the whole stack's change, and goes to all its layers as one diff.
  const code = article(page).locator('[data-lo-excerpt]');
  await expect(code).toBeVisible();
  // Focused, the block offers its chip.
  await code.click();
  await article(page).getByRole('button', { name: 'Go to code' }).click();
  const run = page.getByRole('region', { name: /^Layers \d/ });
  await expect(run).toContainText(
    new RegExp(`\\b1–3\\b.*#${STACK.a} .*#${STACK.b} .*#${STACK.c} `),
    { timeout: 20_000 },
  );
});
