// Attaching files to a comment: Lo, started on the replay server as rozed-bot, on the comments
// fixture (`testing/fixtures/comments.sh`), rozed-dev/e2e#94, with a box open under a line. A PNG
// dropped on it goes in as a placeholder, is uploaded to rozed-dev/e2e as GitHub answered rozed-bot's
// upload of it (`attachments_e2e`), and its Markdown takes the placeholder's place; a `.txt`
// dropped is refused, and nothing of it is sent. Where GitHub answers the upload Not Found
// (`attachments_e2e_not_found`, derived from it), though rozed-bot can write there, Lo asks gh for
// a token, and with no gh, the box says uploads need its sign-in, turns "Attach" off, and takes an
// image's web address pasted in as an image.

import { writeFileSync } from 'node:fs';

import { cassette as recorded, type Interaction, Replay } from '@lo/testing';
import { COMMENTS_PULL, writeCommentsRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { Page } from '@playwright/test';

import { appFolder, DIFF_FIRST, expect, KEYCHAIN, test as base } from './app.ts';
import { type BodiesServer, serveBodies } from './bodies.ts';

/** A stand-in token, never a real one: the cassettes were recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

/** What the comments fixture's reads come from. */
const CASSETTE = 'app_comments';

/** The 2×2 red PNG rozed-bot uploaded as `lo-attachment.png`, the bytes GitHub's answer is to. */
const PNG = [
  ...Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000002000000020802000000fdd49a730000001949444154780101' +
      '0e00f1ff00c81e1ec81e1e00c81e1ec81e1e1f260411ecbcd8e10000000049454e44ae426082',
    'hex',
  ),
];

/** Where GitHub put it. */
const ASSET = 'https://github.com/user-attachments/assets/2c8f1e6f-0846-4210-a57f-c0c6b27e9717';

/** GitHub's answers to the PNG's upload to rozed-dev/e2e, as cassette `name` has them. */
function uploadsIn(name: string): Interaction[] {
  return recorded(name)
    .interactions.map(({ interaction }) => interaction)
    .filter(({ request }) => {
      const url = new URL(request.url);
      return (
        url.pathname === '/user-attachments/assets' &&
        url.searchParams.get('name') === 'lo-attachment.png' &&
        url.searchParams.get('repository_id') === '1448580221'
      );
    });
}

const test = base.extend<{
  uploads: string;
  github: ReplayServer;
  front: BodiesServer;
  remote: string;
}>({
  uploads: ['attachments_e2e', { option: true }],
  github: async ({ uploads }, use) => {
    const answers = recorded(CASSETTE).interactions.map(({ interaction }) => interaction);
    const server = await serveReplay(new Replay(CASSETTE, [...answers, ...uploadsIn(uploads)]));
    await use(server);
    await server.close();
  },
  front: async ({ github }, use) => {
    const front = await serveBodies(CASSETTE, new URL(github.urls.api).origin);
    await use(front);
    await front.close();
  },
  // oxlint-disable-next-line no-empty-pattern
  remote: async ({}, use) => {
    await use(writeCommentsRemote(test.info().outputPath('remote')));
  },
  launch: async ({ front, remote }, use) => {
    const tokenFile = test.info().outputPath('token');
    writeFileSync(tokenFile, `${TOKEN}\n`);
    await use({
      args: [appFolder, ...KEYCHAIN],
      env: { LO_GITHUB: front.origin, LO_TEST_TOKEN_FILE: tokenFile, LO_GIT_REMOTE: remote },
    });
  },
});

// The diff, not the overview, is what these tests open on.
test.use({ settings: DIFF_FIRST });

/** Opens #94's tab once the account from the token file is in, and a box under a line of it. */
async function openBox(page: Page): Promise<void> {
  await expect
    .poll(async () => JSON.stringify(await page.evaluate(() => window.lo.invoke('accounts.list'))))
    .toContain('rozed-bot');
  const reply = await page.evaluate(
    (pr) =>
      window.lo.invoke('tab.open', { kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: pr }),
    COMMENTS_PULL.number,
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply));
  // Line 2 of src/backoff.ts, a file the pull request adds, takes a comment; its thread drawn
  // first, nothing moves under the cursor.
  await expect.poll(() => threadsUnder(page, 'src/backoff.ts', 2), { timeout: 20_000 }).toBe(1);
  await expect
    .poll(
      () => page.evaluate(() => document.activeElement?.closest('[data-lo-middle-view]') !== null),
      { timeout: 20_000 },
    )
    .toBe(true);
  await expect(async () => {
    if ((await cursor(page))?.includes(' old ')) await page.keyboard.press('Tab');
    for (const key of ['g', 'g', ']', 'f']) await page.keyboard.press(key);
    expect(await cursor(page)).toBe('src/backoff.ts header');
  }).toPass({ timeout: 30_000 });
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(() => cursor(page)).toBe('src/backoff.ts new 2');
  await page.keyboard.press('c');
  await expect(boxes(page)).toHaveCount(1);
  await expect(boxes(page)).toContainText('On line 2, new side');
  await page.keyboard.type('Repro: ');
}

/** How many threads the diff on screen draws under `line` of `path`'s newer side. */
function threadsUnder(page: Page, path: string, line: number): Promise<number> {
  return page.evaluate(
    ([file, at]) => {
      const diff = window.loDiff;
      const id = diff?.files.find((each) => each.path === file)?.id;
      return (diff?.threads() ?? []).filter(
        (thread) => 'line' in thread.at && thread.at.file === id && thread.at.line === at,
      ).length;
    },
    [path, line] as const,
  );
}

/** Where the diff's cursor is: a file's path, and its side and line, or `header`. */
function cursor(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const diff = window.loDiff;
    const spot = diff?.probe.cursor()?.at;
    if (!spot) return undefined;
    const file = spot.kind === 'line' ? spot.at.file : spot.file;
    const path = diff?.files.find((each) => each.id === file)?.path;
    return spot.kind === 'line' ? `${path} ${spot.at.side} ${spot.at.line}` : `${path} header`;
  });
}

/** The comment boxes in the diff. */
const boxes = (page: Page) => page.locator('[data-lo-diff] .lo-diffcomposer');

/** Drops files on the box's editor, as from the system's file manager. */
async function drop(page: Page, files: { name: string; bytes: number[] }[]): Promise<void> {
  await boxes(page)
    .locator('.cm-content')
    .evaluate((target, given) => {
      const carried = new DataTransfer();
      for (const { name, bytes } of given) {
        carried.items.add(new File([new Uint8Array(bytes)], name));
      }
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { dataTransfer: carried, bubbles: true, cancelable: true }),
        );
      }
    }, files);
}

test('a PNG dropped on a box is uploaded and its Markdown goes in; a .txt is refused', async ({
  page,
  github,
}) => {
  await openBox(page);
  const box = boxes(page);
  await drop(page, [{ name: 'notes.txt', bytes: [...Buffer.from('not a picture\n')] }]);
  await expect(box).toContainText(
    'Lo didn’t attach notes.txt: GitHub takes PNG, JPEG, GIF, WebP and SVG images and MP4, MOV and WebM videos.',
  );
  await drop(page, [{ name: 'lo-attachment.png', bytes: PNG }]);
  await expect(box.locator('.cm-content')).toHaveText(`Repro: ![lo-attachment](${ASSET})`, {
    timeout: 20_000,
  });
  await expect(box.getByRole('list', { name: 'Uploads' })).toContainText('Uploaded');
  await expect(box).toContainText(
    'Uploads go to GitHub and stay reachable by link, even if you delete the comment.',
  );
  // Once uploaded, the comment can be sent.
  await expect(box.getByRole('button', { name: /Add to review/ })).not.toHaveAttribute(
    'aria-disabled',
  );
  const sent = github.replay.seen.filter(({ url }) =>
    url.startsWith('https://uploads.github.com/'),
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toContain('name=lo-attachment.png');
});

test.describe('where GitHub answers the upload Not Found', () => {
  test.use({ uploads: 'attachments_e2e_not_found' });

  test('without gh, the box says uploads need its sign-in, and takes an image’s address instead', async ({
    page,
    github,
  }) => {
    await openBox(page);
    const box = boxes(page);
    await drop(page, [{ name: 'lo-attachment.png', bytes: PNG }]);
    await expect(box).toContainText(
      'Uploads here need gh’s sign-in, since GitHub takes none with Lo’s. Paste an image’s web address instead.',
      { timeout: 20_000 },
    );
    await expect(box.locator('.cm-content')).toHaveText('Repro: ');
    await expect(box.getByRole('button', { name: /Attach/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Sent once, and never again.
    expect(
      github.replay.seen.filter(({ url }) => url.startsWith('https://uploads.github.com/')),
    ).toHaveLength(1);
    await box.locator('.cm-content').evaluate((target) => {
      const carried = new DataTransfer();
      carried.setData('text/plain', 'https://example.com/shots/retry-storm.gif');
      target.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: carried, bubbles: true, cancelable: true }),
      );
    });
    await expect(box.locator('.cm-content')).toHaveText(
      'Repro: ![retry-storm](https://example.com/shots/retry-storm.gif)',
    );
  });
});
