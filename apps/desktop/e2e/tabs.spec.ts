import type { History } from '@lo/ui/commands';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

import { appEnvironment, appFolder, dataFolder, expect, test } from './app.ts';

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
  await expect(tabs(page)).toHaveCount(10);
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

test('macOS’s File and Window menus list closing a tab and stepping through them', async ({
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
      'Window: Next tab Command+Shift+]',
      'Window: Previous tab Command+Shift+[',
    ]);
});

/** Starts Lo on the test's data folder, and waits for its window. */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [appFolder],
    env: appEnvironment(dataFolder()),
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
