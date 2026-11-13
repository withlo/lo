// An overview written for an older push, in the app: Lo, started on the replay server as
// rozed-bot, opens rozed-dev/e2e#80, whose overview was written for its first push, r1, while the
// pull request is at its second, r2. The overview says so from its first frame, with how much
// changed since once the local copy is there; flags the code block on lines r2 changed, its code
// still r1's; compares r1 with r2 in the diff when asked; marks r1 in the revision picker as the
// revision it describes; and marks the lines it explains in the diff, mapped to r2, each with a
// note. Nothing on screen moves without the reader as all that comes in.

import { writeFileSync } from 'node:fs';

import { APP_PULL, writeAppRemote } from '@lo/testing/git';
import { serveReplay, type ReplayServer } from '@lo/testing/server';
import type { ElectronApplication, Page } from '@playwright/test';

import { appFolder, expect, KEYCHAIN, sizeWindow, test as base } from './app.ts';

declare global {
  interface Window {
    /** What moved on the overview while a test watched it, on a frame the reader gave no input. */
    loStaleMoved?: string[];
    /** Stops watching. */
    loStaleStill?: boolean;
  }
}

/** A stand-in token, never a real one: the cassette was recorded with the same. */
const TOKEN = 'gho_FAKE_E2E_ACCOUNT';

const test = base.extend<{
  github: ReplayServer;
  remote: string;
  tokenFile: string;
  /** The cassette GitHub answers from. */
  cassette: string;
  /** Whether the remote is written only once the test says, so the local copy comes late. */
  lateRemote: boolean;
}>({
  cassette: ['app_e2e', { option: true }],
  lateRemote: [false, { option: true }],
  github: async ({ cassette }, use) => {
    const server = await serveReplay(cassette);
    await use(server);
    await server.close();
  },
  remote: async ({ lateRemote }, use) => {
    const folder = test.info().outputPath('remote');
    await use(lateRemote ? `file://${folder}` : writeAppRemote(folder));
  },
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
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

/** Waits for the account from the token file, then opens #80's tab, and returns its id. */
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

/** What main has of a tab's overview, as the window asks it. */
async function current(page: Page, id: string): Promise<unknown> {
  const reply = await page.evaluate((tab) => window.lo.invoke('overview.current', { id: tab }), id);
  return reply.ok ? reply.value : reply;
}

/**
 * Watches, every frame from now until the test stops it, where each of the overview's article's
 * children on screen is, the banner among them, and says each time one has moved on a frame the
 * reader gave no input: from the first frame the overview is drawn. A frame within half a second of
 * the reader's wheel, keys, pointer or a change in the window's size takes where each is as its
 * place, once it's held two frames running. One counts as moved once it's been away from its
 * place two frames running, so a change made up for before it's painted doesn't count.
 */
async function watchStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    const moved: string[] = [];
    window.loStaleMoved = moved;
    window.loStaleStill = false;
    let input = Number.NEGATIVE_INFINITY;
    for (const type of ['wheel', 'keydown', 'pointerdown', 'resize']) {
      window.addEventListener(type, () => (input = performance.now()), { capture: true });
    }
    let article: Element | null = null;
    let watched: { block: Element; y: number; away: number }[] = [];
    let before: { block: Element; y: number }[] = [];
    const onScreen = () => {
      const scroller = article?.closest('.lo-ov');
      if (!article || !scroller) return [];
      const box = scroller.getBoundingClientRect();
      return [...article.children].flatMap((block) => {
        const { top, bottom } = block.getBoundingClientRect();
        return bottom > box.top && top < box.bottom ? [{ block, y: top, away: 0 }] : [];
      });
    };
    const tick = () => {
      // An article laid out but not yet seen, as its code blocks draw, isn't drawn yet.
      const found = document.querySelector('[data-lo-overview="shown"] .lo-ov__article');
      const now = found?.checkVisibility({ visibilityProperty: true }) ? found : null;
      if (now !== article || performance.now() - input < 500) {
        const fresh = now !== article;
        article = now;
        const seen = onScreen();
        const held =
          seen.length === before.length &&
          seen.every(
            (each, at) =>
              each.block === before[at]?.block && Math.abs(each.y - before[at].y) <= 0.5,
          );
        if (fresh || held) watched = seen;
        before = seen;
      } else {
        before = [];
        for (const each of watched) {
          const y = each.block.isConnected ? each.block.getBoundingClientRect().top : undefined;
          const off = y === undefined || Math.abs(y - each.y) > 0.5;
          each.away = off ? each.away + 1 : 0;
          if (each.away === 2) {
            moved.push(`${each.block.textContent?.slice(0, 40)} from ${each.y} to ${y}`);
          }
        }
      }
      if (!window.loStaleStill) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stops watching, and says what moved. */
async function stillMoved(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    window.loStaleStill = true;
    return window.loStaleMoved ?? [];
  });
}

/** The overview's view, showing an overview. */
const shown = (page: Page) =>
  page.locator('[data-lo-middle-view="overview.view"] [data-lo-overview="shown"]');

/** The view switch's tab for the overview. */
const overviewTab = (page: Page) =>
  page.getByRole('tablist', { name: 'View' }).getByRole('tab').filter({ hasText: 'Overview' });

/** The view switch's tab for the diff. */
const diffTab = (page: Page) =>
  page.getByRole('tablist', { name: 'View' }).getByRole('tab').filter({ hasText: 'Diff' });

/**
 * The lines the diff marks as the overview explains them, each as `path from-to block`, the block
 * by its place in the overview (and a step's in its walkthrough), sorted.
 */
async function explained(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const diff = window.loDiff;
    if (!diff) return [];
    const paths = new Map(diff.files.map((file) => [file.id, file.path]));
    return diff
      .explained()
      .flatMap((mark) =>
        mark.kind === 'overview'
          ? [
              `${paths.get(mark.at.file)} ${mark.at.from}-${mark.at.to} ${mark.block.slice(mark.block.indexOf('.') + 1)}`,
            ]
          : [],
      )
      .toSorted();
  });
}

/** The banner over the overview, saying what it was written for and what changed since. */
const banner = (page: Page) => shown(page).locator('.lo-ov-stale');

/** The code block that shows `lines` of `path`. */
const codeBlock = (page: Page, path: string, lines: string) =>
  shown(page)
    .locator('.lo-codeblock')
    .filter({ has: page.locator('.lo-codeblock__path', { hasText: path }) })
    .filter({ has: page.locator('.lo-codeblock__lines', { hasText: lines }) });

/** Opens #80 on its overview, at 1100×800, and returns its tab's id. */
async function opened(app: ElectronApplication, page: Page): Promise<string> {
  await sizeWindow(app, 1100, 800);
  const id = await open(page);
  await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
  await overviewTab(page).click();
  await expect(shown(page)).toBeVisible();
  return id;
}

test('says it was written for r1 from its first frame, and flags the block on lines r2 changed', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const refused: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
  });
  const id = await opened(app, page);
  await expect(banner(page).locator('.lo-ov-stale__title')).toHaveText(
    'Written for r1. The PR is at r2.',
  );
  await expect(banner(page).getByRole('button', { name: 'Compare r1 → r2' })).toBeVisible();
  await expect(
    banner(page).getByRole('button', { name: /Copy prompt for an agent/ }),
  ).toBeVisible();
  const room = await banner(page).evaluate((element) => element.getBoundingClientRect().height);

  // Once the local copy is there: one push since, which changed the parser alone (the README came
  // with the base it was rebased onto), and one code block points at lines it changed.
  await expect.poll(() => current(page, id), { timeout: 30_000 }).toMatchObject({ code: 'ready' });
  await expect(banner(page).locator('.lo-ov-stale__sub')).toHaveText(
    '1 push since, touching 1 file. 1 code block below points at lines that changed.',
    { timeout: 20_000 },
  );
  expect(await banner(page).evaluate((element) => element.getBoundingClientRect().height)).toBe(
    room,
  );

  // The block on lines r2 changed is flagged, its code still r1's, its changed line marked.
  const parser = codeBlock(page, 'src/parser.ts', 'L7–10');
  await expect(parser.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
  const flag = parser.locator('.lo-codeblock__flag');
  await expect(flag).toContainText(
    'Line 7 changed in r2, and a line was added after line 8. This block shows r1, which the text describes.',
  );
  await expect(flag.getByRole('button', { name: 'Compare r1 → r2' })).toBeVisible();
  await expect(parser.locator('.cm-gutterElement.is-stale')).toHaveText(['7']);
  expect(await parser.locator('[data-lo-code] .cm-line.lo-line-add').allTextContents()).toEqual([
    '/** Splits `input` into lines, on `\\n` or `\\r\\n`. */',
    '  return input.split(/\\r?\\n/).map((text, index) => ({ number: index + 1, text }));',
  ]);

  // Blocks on lines r2 left alone, and on a file only the base changed, aren't.
  for (const [path, lines] of [
    ['src/format.ts', 'L1–3'],
    ['src/format.ts', 'L5–8'],
    ['README.md', 'L1–4'],
  ] as const) {
    const block = codeBlock(page, path, lines);
    await block.scrollIntoViewIfNeeded();
    await expect(block.locator('[data-lo-code="drawn"]')).toBeAttached({ timeout: 20_000 });
    await expect(block.locator('.lo-codeblock__flag')).toHaveCount(0);
  }
  expect(refused).toEqual([]);
});

test.describe('while the local copy comes late', () => {
  test.use({ cassette: 'app_e2e_late', lateRemote: true });

  // Wide, the actions beside what changed since, which takes both its lines; and narrow, one above
  // the other, under four lines kept for it. The widths between only move where the actions go.
  for (const width of [1440, 760]) {
    test(`nothing on screen moves from the first frame as what changed since fills in, at ${width} wide`, async ({
      app,
      page,
    }) => {
      test.setTimeout(90_000);
      await sizeWindow(app, width, 900);
      await watchStill(page);
      const id = await open(page);
      await expect(overviewTab(page).getByRole('img')).toBeVisible({ timeout: 20_000 });
      await overviewTab(page).click();
      await expect(shown(page)).toBeVisible();
      await expect
        .poll(() => current(page, id), { timeout: 20_000 })
        .toMatchObject({ code: 'failed' });
      // Without the local copy, it says what it was written for and how many pushes since.
      await expect(banner(page).locator('.lo-ov-stale__title')).toHaveText(
        'Written for r1. The PR is at r2.',
      );
      await expect(banner(page).locator('.lo-ov-stale__sub')).toHaveText('1 push since.');

      // The local copy comes, and with it how much changed and the flag.
      writeAppRemote(test.info().outputPath('remote'));
      await page.evaluate((tab) => window.lo.invoke('tab.retry', { id: tab }), id);
      await expect
        .poll(() => current(page, id), { timeout: 30_000 })
        .toMatchObject({ code: 'ready' });
      await expect(banner(page).locator('.lo-ov-stale__sub')).toHaveText(
        '1 push since, touching 1 file. 1 code block below points at lines that changed.',
        { timeout: 20_000 },
      );
      await expect(
        codeBlock(page, 'src/parser.ts', 'L7–10').locator('.lo-codeblock__flag'),
      ).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1500);
      expect(await stillMoved(page)).toEqual([]);
    });
  }
});

test('keeps the banner as tall whatever its labels and what changed since say, at any width', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const id = await opened(app, page);
  await expect.poll(() => current(page, id), { timeout: 30_000 }).toMatchObject({ code: 'ready' });
  await expect(banner(page).locator('.lo-ov-stale__sub')).toContainText('code block', {
    timeout: 20_000,
  });
  for (const width of [1440, 1100, 1020, 980, 900, 760, 700]) {
    await sizeWindow(app, width, 800);
    // A copy beside it, as wide, saying what it says before the revisions come, the commits by
    // their short ids, and before the local copy, nothing of what changed; and the most it says.
    const heights = await banner(page).evaluate((element) => {
      const holder = element.parentElement;
      const copy = holder?.cloneNode(true);
      if (!holder || !(copy instanceof HTMLElement)) return [];
      holder.after(copy);
      const height = () => copy.firstElementChild?.getBoundingClientRect().height;
      const compare = copy.querySelector('.lo-ov-stale__actions button');
      const sub = copy.querySelector('.lo-ov-stale__sub');
      if (!compare || !sub) return [];
      const seen = [element.getBoundingClientRect().height, height()];
      compare.textContent = 'Compare 45e4f22 → 57cc4a6';
      seen.push(height());
      sub.textContent = '';
      seen.push(height());
      sub.textContent =
        '12 pushes since, touching 128 files. 14 code blocks below point at lines that changed.';
      seen.push(height());
      copy.remove();
      return seen;
    });
    expect(heights, String(width)).toHaveLength(5);
    expect(new Set(heights).size, `${width}: ${heights.join(', ')}`).toBe(1);
  }
});

test('compares r1 with r2 in the diff, and marks r1 in the picker as the revision it describes', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  await opened(app, page);
  const compare = banner(page).getByRole('button', { name: 'Compare r1 → r2' });
  await expect(compare).not.toHaveAttribute('aria-disabled', 'true', { timeout: 20_000 });
  await compare.click();

  // The diff, comparing r1 with r2 once the local copy has both.
  await expect(page.locator('[data-lo-middle-view="diff.view"] .lo-diffview')).toBeVisible({
    timeout: 20_000,
  });
  const header = page.locator('header').getByRole('button', { name: /→/ });
  await expect(header).toContainText('r1 → r2', { timeout: 20_000 });

  // `gv` opens the picker, which marks r1 as the revision the overview describes, and no other.
  await page.locator('.lo-diffview').click();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  const picker = page.getByRole('listbox', { name: 'Revisions' });
  await expect(picker).toBeFocused();
  await expect(picker.locator(`[data-key="${APP_PULL.firstHead}"]`)).toContainText('Overview');
  await expect(picker.locator(`[data-key="${APP_PULL.firstHead}"] .lo-ovmark`)).toHaveCount(1);
  await expect(picker.locator('.lo-ovmark')).toHaveCount(1);
  await expect(picker.locator(`[data-key="${APP_PULL.head}"]`)).not.toContainText('Overview');
});

test('marks the lines it explains in the diff at r2, opens what it says of them, and goes there', async ({
  app,
  page,
}) => {
  test.setTimeout(90_000);
  const id = await opened(app, page);
  await expect.poll(() => current(page, id), { timeout: 30_000 }).toMatchObject({ code: 'ready' });
  await diffTab(page).click();
  const diff = page.locator('[data-lo-middle-view="diff.view"] .lo-diffview');
  await expect(diff).toBeVisible({ timeout: 20_000 });

  // Mapped from r1 to r2: src/parser.ts's line 7 changed and a line was added after line 8, so
  // its blocks mark the lines on either side and neither of those. Nothing marks README.md, which
  // the pull request doesn't change, or src/cache.ts, which isn't there.
  await expect
    .poll(() => explained(page), { timeout: 30_000 })
    .toEqual([
      // The code blocks (6 and 8), the figure's part (9) and the walkthrough's third step (10.2).
      'src/format.ts 1-3 6',
      'src/format.ts 5-8 8',
      'src/format.ts 6-8 10.2',
      'src/format.ts 6-8 9',
      // The code block (4), the figure's part and the walkthrough's first two steps.
      'src/parser.ts 10-11 10.0',
      'src/parser.ts 10-11 4',
      'src/parser.ts 10-11 9',
      'src/parser.ts 14-16 10.1',
      'src/parser.ts 8-8 10.0',
      'src/parser.ts 8-8 4',
      'src/parser.ts 8-8 9',
      'src/text/wrap.ts 2-15 9',
    ]);

  // src/format.ts at the top: its first line's ball opens the note of the block on lines 1–3, and
  // Esc in the diff closes it.
  await diff.click();
  const format = await page.evaluate(
    () => window.loDiff?.files.find((file) => file.path === 'src/format.ts')?.id,
  );
  if (format === undefined) throw new Error('The diff has no src/format.ts.');
  await page.evaluate(
    (file) => window.loDiff?.scrollTo({ at: { kind: 'header', file, side: 'new' }, offset: 0 }),
    format,
  );
  // The ball beside the line, among those the editor draws around it, once the line is drawn in
  // the diff.
  const ballOf = () =>
    page.evaluate((file) => {
      const line = { kind: 'line' as const, at: { file, side: 'new' as const, line: 1 } };
      const top = window.loDiff?.probe.spotTop(line);
      const bottom = window.loDiff?.probe.spotBottom(line);
      const frame = document
        .querySelector('[data-lo-middle-view="diff.view"] .lo-diffview')
        ?.getBoundingClientRect();
      if (top === undefined || bottom === undefined || !frame) return undefined;
      if (top < frame.top || bottom > frame.bottom) return undefined;
      const after = document
        .querySelector('.cm-content[aria-label="After"]')
        ?.closest('.cm-editor');
      const balls = [...(after?.querySelectorAll('.lo-ovcolumn .lo-ov-marker') ?? [])];
      const found = balls.find((each) => {
        const box = each.getBoundingClientRect();
        const middle = (box.top + box.bottom) / 2;
        return middle >= top && middle <= bottom;
      });
      const box = found?.getBoundingClientRect();
      return box && { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    }, format);
  await expect.poll(ballOf).toBeDefined();
  const ball = await ballOf();
  if (!ball) throw new Error('src/format.ts’s first line has no ball.');
  await page.mouse.click(ball.x, ball.y);
  const note = diff.locator('.lo-ovnote');
  await expect(note).toHaveCount(1);
  await expect(note.locator('.lo-ovnote__label')).toHaveText('Overview · How it works');
  await expect(note.locator('.lo-ovnote__text')).toHaveText(
    'The formatter takes its Line from the new path, and passes wrap on from where it lives now:',
  );
  await expect(note.getByRole('button', { name: 'Read it in the overview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);

  // "Read it in the overview" goes to the block, with focus, and `⌃o` comes back to the line the
  // note is under, the mark's last, with the screen where it was.
  await page.mouse.click(ball.x, ball.y);
  await note.getByRole('button', { name: 'Read it in the overview' }).click();
  await expect(shown(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.closest('[data-lo-block]')?.getAttribute('data-lo-block'),
      ),
    )
    .toBe('6');
  await page.keyboard.press('Control+o');
  await expect(diff).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const at = window.loDiff?.probe.cursor()?.at;
        return at?.kind === 'line' && 'line' in at.at ? at.at : undefined;
      }),
    )
    .toMatchObject({ file: format, side: 'new', line: 3 });
  expect(await ballOf()).toEqual(ball);
});
