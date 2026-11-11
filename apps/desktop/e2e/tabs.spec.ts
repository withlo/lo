import type { History } from '@lo/ui/commands';
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import { appEnvironment, appFolder, closedPort, dataFolder, expect, test as base } from './app.ts';

/**
 * Lo with a GitHub that can't be reached, so the pull requests these tests open in tabs never
 * reach the real one: each says it's offline.
 */
async function unreachable(): Promise<Record<string, string>> {
  return { LO_GITHUB: `http://127.0.0.1:${await closedPort()}` };
}

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern
  launch: async ({}, use) => {
    await use({ env: await unreachable() });
  },
});

declare global {
  interface Window {
    /** The registry's history, which a build run from source gives the smoke test. */
    loHistory?: History;
  }
}

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const strip = (page: Page) => page.getByRole('tablist', { name: 'Pull requests' });
const tabs = (page: Page) => strip(page).getByRole('tab');
/** The tab on screen. */
const shown = (page: Page) => strip(page).getByRole('tab', { selected: true });

/** The button that holds the tabs that don't fit, when some don't. */
const more = (page: Page) => strip(page).getByRole('button', { name: /^\d+ more tabs$/ });

/** How many tabs are open: those the strip shows and those folded into its menu. */
async function openCount(page: Page): Promise<number> {
  const folded = (await more(page).count()) > 0 ? await more(page).getAttribute('aria-label') : '0';
  return (await tabs(page).count()) + Number.parseInt(folded ?? '', 10);
}

/** Expects `locator` wholly inside the window and the strip, clear of the window's controls. */
async function expectInside(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const room = await strip(page).evaluate((element) => {
    const { left, right } = element.getBoundingClientRect();
    return { left: Math.max(0, left), right: Math.min(window.innerWidth, right) };
  });
  expect(box?.x).toBeGreaterThanOrEqual(room.left);
  expect((box?.x ?? Infinity) + (box?.width ?? 0)).toBeLessThanOrEqual(room.right);
}

/** Expects the strip to fit the window: no tab past its end, and the tab on screen and `+` in it. */
async function expectFits(page: Page): Promise<void> {
  expect(await strip(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  await expectInside(page, shown(page));
  await expectInside(page, strip(page).getByRole('button', { name: 'Open a pull request' }));
  if ((await more(page).count()) > 0) await expectInside(page, more(page));
}

/** Makes the window `width` pixels wide, or as wide as the screen, and returns the width. */
async function resize(app: ElectronApplication, page: Page, width: number | 'screen') {
  const wanted = await app.evaluate(({ BrowserWindow, screen }, asked) => {
    const across = asked === 'screen' ? screen.getPrimaryDisplay().workAreaSize.width : asked;
    BrowserWindow.getAllWindows()[0]?.setContentSize(across, 700);
    return across;
  }, width);
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(wanted);
  return wanted;
}

/** `count` pull requests, `r1 #1` to `rN #N`. */
const many = (count: number) =>
  Array.from({ length: count }, (_, index) => pull('withlo', `r${index + 1}`, index + 1));

/** The note Lo says at the bottom of the window. */
const said = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

type Opening = { kind: 'pull'; owner: string; repo: string; number: number } | { kind: 'settings' };

const pull = (owner: string, repo: string, number: number): Opening => ({
  kind: 'pull',
  owner,
  repo,
  number,
});

/** Opens a tab through main, as the open box and links from other apps do, and returns its id. */
async function open(page: Page, ...openings: Opening[]): Promise<string[]> {
  return page.evaluate(async (inputs) => {
    const ids: string[] = [];
    for (const input of inputs) {
      const result = await window.lo.invoke('tab.open', input);
      if (!result.ok) throw new Error(result.error.message);
      ids.push(String(result.value));
    }
    return ids;
  }, openings);
}

test('with nothing open, Recent pull requests is the only tab, and it can’t be closed', async ({
  page,
}) => {
  await expect(tabs(page)).toHaveText(['Recent pull requests']);
  await expect(shown(page)).toHaveText('Recent pull requests');
  await expect(shown(page).getByRole('button', { name: 'Close tab' })).toHaveCount(0);
  await expect(page).toHaveTitle('Lo');

  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(said(page, "Recent pull requests can't be closed")).toBeVisible();
  // Its right-click menu says so too.
  await shown(page).click({ button: 'right' });
  const close = page
    .getByRole('menu', { name: 'Tab actions' })
    .getByRole('menuitem', { name: 'Close tab' });
  await expect(close).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(tabs(page)).toHaveText(['Recent pull requests']);
});

test('a pull request opens in Recent’s place, titles the window, and opens once', async ({
  page,
}) => {
  const [fd] = await open(page, pull('sharkdp', 'fd', 2212));
  await expect(tabs(page)).toHaveText(['fd #2212']);
  await expect(page).toHaveTitle('sharkdp/fd#2212');
  // The same pull request, by any case of its name, shows the tab it's in.
  const [, again] = await open(page, pull('sharkdp', 'bat', 7), pull('SharkDP', 'FD', 2212));
  await expect(tabs(page)).toHaveText(['fd #2212', 'bat #7']);
  await expect(shown(page)).toHaveText('fd #2212');
  expect(again).toBe(fd);
  // So does Settings.
  await open(page, { kind: 'settings' }, pull('sharkdp', 'bat', 7), { kind: 'settings' });
  await expect(tabs(page)).toHaveText(['fd #2212', 'bat #7', 'Settings']);
  await expect(shown(page)).toHaveText('Settings');
  await expect(page).toHaveTitle('Lo');
});

test('⌘1 to ⌘8 show a tab by its place, and ⌘9 the last however many are open', async ({
  page,
}) => {
  const repos = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  await open(page, ...repos.map((repo, index) => pull('withlo', repo, index + 1)));
  await expect.poll(() => openCount(page)).toBe(10);
  for (const [index, repo] of repos.slice(0, 8).entries()) {
    await page.keyboard.press(`${cmd}+Digit${index + 1}`);
    await expect(shown(page)).toHaveText(`${repo} #${index + 1}`);
    await expect(page).toHaveTitle(`withlo/${repo}#${index + 1}`);
  }
  await page.keyboard.press(`${cmd}+Digit9`);
  await expect(shown(page)).toHaveText('j #10');
});

test('a place past the last tab shows nothing new', async ({ page }) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2));
  await page.keyboard.press(`${cmd}+Digit1`);
  await page.keyboard.press(`${cmd}+Digit5`);
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('a #1');
  await expect(tabs(page)).toHaveText(['a #1', 'b #2']);
});

test('⌘⇧] and ⌘⇧[, and ⌃⇥ and ⌃⇧⇥, step through the tabs, round the ends', async ({ page }) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await expect(shown(page)).toHaveText('c #3');
  await page.keyboard.press(`${cmd}+Shift+BracketRight`);
  await expect(shown(page)).toHaveText('a #1');
  await page.keyboard.press('Control+Tab');
  await expect(shown(page)).toHaveText('b #2');
  await page.keyboard.press(`${cmd}+Shift+BracketLeft`);
  await expect(shown(page)).toHaveText('a #1');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(shown(page)).toHaveText('c #3');
});

test('⌘W closes the tab on screen and shows the one after it, until Recent comes back', async ({
  page,
}) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await page.keyboard.press(`${cmd}+Digit2`);
  await expect(shown(page)).toHaveText('b #2');
  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(tabs(page)).toHaveText(['a #1', 'c #3']);
  await expect(shown(page)).toHaveText('c #3');
  // At the end of the strip, the one before it.
  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(tabs(page)).toHaveText(['a #1']);
  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(tabs(page)).toHaveText(['Recent pull requests']);
  await expect(page).toHaveTitle('Lo');
});

test('two quick ⌘Ws close two tabs', async ({ page }) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('a #1');
  await page.keyboard.press(`${cmd}+KeyW`);
  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(tabs(page)).toHaveText(['c #3']);
});

test('a click shows a tab, its button closes it, and its right-click menu closes it', async ({
  page,
}) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await tabs(page).nth(0).click();
  await expect(shown(page)).toHaveText('a #1');

  // A tab not on screen shows its close button under the pointer, and keeps the one on screen.
  const second = tabs(page).nth(1);
  await second.hover();
  await second.getByRole('button', { name: 'Close tab' }).click();
  await expect(tabs(page)).toHaveText(['a #1', 'c #3']);
  await expect(shown(page)).toHaveText('a #1');

  await tabs(page).nth(1).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Tab actions' });
  const close = menu.getByRole('menuitem', { name: 'Close tab', exact: true });
  await expect(close).toHaveAttribute('aria-keyshortcuts', mac ? 'Meta+W' : 'Control+W');
  await close.click();
  await expect(menu).toBeHidden();
  await expect(tabs(page)).toHaveText(['a #1']);
});

test('⌃o and ⌃i walk the history of the tab on screen, and each tab keeps its own', async ({
  page,
}) => {
  const [first, second] = await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2));
  if (first === undefined || second === undefined) throw new Error('The tabs didn’t open.');
  await page.waitForFunction(() => window.loHistory !== undefined);
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('a #1');
  // Each tab's diff, as views will, reveals its places; the first tab has made two jumps.
  await page.evaluate(
    ({ ids }) => {
      const history = window.loHistory;
      if (!history) throw new Error('No history to walk.');
      const revealed: string[] = [];
      Reflect.set(window, 'loRevealed', revealed);
      for (const [name, id] of Object.entries(ids)) {
        history.register(id, 'diff', (target) => {
          revealed.push(`${name} ${target.kind === 'file' ? target.file : ''}`);
          return true;
        });
      }
      history.record({ view: 'diff', at: { kind: 'file', file: 'one.ts' } });
      history.record({ view: 'diff', at: { kind: 'file', file: 'two.ts' } });
    },
    { ids: { first, second } },
  );
  const revealed = () =>
    page.evaluate((): unknown => {
      const list: unknown = Reflect.get(window, 'loRevealed');
      return Array.isArray(list) ? [...list] : list;
    });

  await page.keyboard.press('Control+O');
  await page.keyboard.press('Control+O');
  await expect.poll(revealed).toEqual(['first two.ts', 'first one.ts']);

  // The second tab has been nowhere.
  await page.keyboard.press(`${cmd}+Digit2`);
  await expect(shown(page)).toHaveText('b #2');
  await page.keyboard.press('Control+O');
  await expect(said(page, "There's nowhere to go back to.")).toBeVisible();
  await page.keyboard.press('Control+I');
  await expect(said(page, "There's nowhere to go forward to.")).toBeVisible();

  // Back in the first, forward goes where it went back from.
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('a #1');
  await page.keyboard.press('Control+I');
  await expect.poll(revealed).toEqual(['first two.ts', 'first one.ts', 'first two.ts']);

  // A closed tab's history goes with it.
  await page.keyboard.press(`${cmd}+KeyW`);
  await expect(tabs(page)).toHaveText(['b #2']);
  expect(
    await page.evaluate((id) => {
      const history = window.loHistory;
      history?.tab(id);
      return history?.entries().length;
    }, first),
  ).toBe(0);
});

test('macOS’s File, View and Window menus list closing a tab, the left panel and stepping through tabs', async ({
  app,
  page,
}) => {
  test.skip(!mac, 'Linux has no app menu.');
  await expect(tabs(page)).toHaveText(['Recent pull requests']);
  const items = () =>
    app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items ?? []).flatMap((menu) =>
        (menu.submenu?.items ?? [])
          // A role's item has no id, whatever Electron's types say.
          .filter((item) => {
            const id: unknown = Reflect.get(item, 'id');
            return typeof id === 'string' && id.startsWith('tab.');
          })
          .map((item) => `${menu.label}: ${item.label} ${item.accelerator ?? ''}`),
      ),
    );
  await expect
    .poll(items)
    .toEqual([
      'File: Close tab Command+W',
      'View: Left panel Command+\\',
      'Window: Next tab Command+Shift+]',
      'Window: Previous tab Command+Shift+[',
    ]);
});

for (const width of [1440, 'screen'] as const) {
  for (const count of [1, 8, 16, 40]) {
    const across = width === 'screen' ? 'the screen’s width' : `${width} px`;
    test(`${count} tabs at ${across}: the tab on screen and + stay in the window, and the keys reach every tab`, async ({
      app,
      page,
    }) => {
      await resize(app, page, width);
      await open(page, ...many(count));
      await expect(shown(page)).toHaveText(`r${count} #${count}`);
      await expect.poll(() => openCount(page)).toBe(count);
      await expectFits(page);
      if (width === 1440) await expect(more(page)).toHaveCount(count > 8 ? 1 : 0);

      // ⌘1, ⌘9 and stepping round both ends, to tabs folded away or not.
      const steps: [string, number][] = [
        [`${cmd}+Digit1`, 1],
        [`${cmd}+Digit9`, count],
        [`${cmd}+Shift+BracketRight`, 1],
        [`${cmd}+Shift+BracketLeft`, count],
        [`${cmd}+Shift+BracketLeft`, Math.max(1, count - 1)],
        ['Control+Tab', count],
      ];
      for (const [key, number] of steps) {
        await page.keyboard.press(key);
        await expect(shown(page)).toHaveText(`r${number} #${number}`);
        await expectFits(page);
      }
      await expect.poll(() => openCount(page)).toBe(count);
    });
  }
}

test('the tabs that don’t fit are in the "N more" menu, and choosing one shows it', async ({
  app,
  page,
}) => {
  await resize(app, page, 1440);
  await open(page, ...many(16));
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('r1 #1');
  const folded = Number.parseInt((await more(page).getAttribute('aria-label')) ?? '', 10);
  expect(folded).toBeGreaterThan(0);
  await expect(more(page)).toHaveText(`${folded} more`);

  await more(page).click();
  const menu = page.getByRole('menu', { name: 'More tabs' });
  const items = menu.getByRole('menuitem');
  // In the strip's order, after the last it shows.
  await expect(items).toHaveCount(folded);
  await expect(items.first()).toHaveText(`r${17 - folded} #${17 - folded}`);
  await expect(items.last()).toHaveText('r16 #16');
  await items.last().click();
  await expect(menu).toBeHidden();
  await expect(shown(page)).toHaveText('r16 #16');
  await expectFits(page);
  // The tab it took the place of is in the menu now.
  await more(page).click();
  await expect(items.first()).toHaveText(`r${16 - folded} #${16 - folded}`);
  await page.keyboard.press('Escape');
});

test('⌘⇧A opens the tabs that don’t fit, to choose one by key', async ({ app, page }) => {
  await resize(app, page, 1440);
  await open(page, pull('withlo', 'a', 1));
  // While every tab fits, the key says so.
  await page.keyboard.press(`${cmd}+Shift+KeyA`);
  await expect(said(page, 'Every tab fits in the strip.')).toBeVisible();

  await open(page, ...many(16));
  await page.keyboard.press(`${cmd}+Digit1`);
  await expect(shown(page)).toHaveText('a #1');
  const menu = page.getByRole('menu', { name: 'More tabs' });
  await page.keyboard.press(`${cmd}+Shift+KeyA`);
  // Focus goes into the menu, which Esc closes.
  await expect(menu).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await page.keyboard.press(`${cmd}+Shift+KeyA`);
  await expect(menu).toBeFocused();
  const last = await menu.getByRole('menuitem').last().textContent();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(shown(page)).toHaveText(last ?? '');
});

test('the narrowest tabs keep their repository, cut short, and their number whole', async ({
  app,
  page,
}) => {
  await resize(app, page, 1440);
  const long = 'a-repository-with-a-long-name';
  await open(
    page,
    ...Array.from({ length: 40 }, (_, index) => pull('withlo', long, 123_456 + index)),
  );
  await expect.poll(() => openCount(page)).toBe(40);
  const fits = (locator: Locator) =>
    locator.evaluate((element) => ({
      width: element.clientWidth,
      cut: element.scrollWidth > element.clientWidth,
    }));
  for (const tab of await tabs(page).all()) {
    const repository = tab.locator('span', { hasText: long });
    const number = tab.locator('span', { hasText: /^#\d+$/ });
    // Its first letter and an ellipsis, at least.
    expect(await fits(repository)).toEqual({ width: expect.any(Number), cut: true });
    expect((await fits(repository)).width).toBeGreaterThanOrEqual(12);
    expect(await fits(number)).toMatchObject({ cut: false });
  }
  await expectFits(page);
});

test('a repository with a long name takes half its tab at most, leaving room for the title', async ({
  page,
}) => {
  const long = 'r'.repeat(100);
  await open(page, pull('withlo', long, 1));
  const repository = shown(page).locator('span', { hasText: long });
  const box = await repository.boundingBox();
  const tab = await shown(page).boundingBox();
  expect((box?.width ?? Infinity) * 2).toBeLessThanOrEqual((tab?.width ?? 0) + 1);
});

/** Starts Lo on the test's data folder, and waits for its window. */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appFolder],
    env: { ...appEnvironment(dataFolder()), ...(await unreachable()) },
    chromiumSandbox: true,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('load');
  return { app, page };
}

test('the tabs come back after Lo restarts, in their order, with the same one on screen', async () => {
  const first = await launch();
  try {
    const [, , c] = await open(
      first.page,
      pull('withlo', 'a', 1),
      { kind: 'settings' },
      pull('withlo', 'c', 3),
    );
    await first.page.evaluate(async (id) => {
      await window.lo.invoke('tab.move', { id, to: 0 });
    }, c);
    await first.page.keyboard.press(`${cmd}+Digit2`);
    await expect(tabs(first.page)).toHaveText(['c #3', 'a #1', 'Settings']);
    await expect(shown(first.page)).toHaveText('a #1');
  } finally {
    await first.app.close();
  }

  const second = await launch();
  try {
    await expect(tabs(second.page)).toHaveText(['c #3', 'a #1', 'Settings']);
    await expect(shown(second.page)).toHaveText('a #1');
    await expect(second.page).toHaveTitle('withlo/a#1');
  } finally {
    await second.app.close();
  }
});
