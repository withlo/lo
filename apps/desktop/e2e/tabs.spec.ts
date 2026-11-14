import type { History } from '@lo/ui/commands';
import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  appEnvironment,
  appFolder,
  closedPort,
  dataFolder,
  drawnWindow,
  expect,
  test as base,
} from './app.ts';

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
  await expectInside(page, strip(page).getByRole('button', { name: 'Review a pull request' }));
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

/**
 * Holds `tab` hovered until the test ends, as DevTools' "Force element state" does. Playwright's
 * pointer isn't the system's: when a window opens or closes under the system's pointer, such as
 * another test's copy of Lo, the system tells Lo's window where its pointer is, and the hover moves
 * there, off the tab Playwright's pointer is on.
 */
async function holdHover(page: Page, tab: Locator): Promise<void> {
  const id = await tab.getAttribute('data-tab');
  if (id === null) throw new Error('The tab has no id.');
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('DOM.enable');
  await devtools.send('CSS.enable');
  const { root } = await devtools.send('DOM.getDocument');
  const { nodeId } = await devtools.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: `[data-tab="${id}"]`,
  });
  await devtools.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
}

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

/**
 * The open tabs in main's order, as the strip names them: `r1 #1`. A tab past those the strip
 * shows moves into its last place as it comes on screen, so the order isn't always the one the
 * tabs opened in.
 */
async function inOrder(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const result = await window.lo.invoke('tab.list');
    if (!result.ok) throw new Error(result.error.message);
    const list: unknown = Reflect.get(Object(result.value), 'tabs');
    if (!Array.isArray(list)) throw new Error('Main listed no tabs.');
    return list.map((tab: unknown) => {
      const [repo, number] = ['repo', 'number'].map((key) => String(Reflect.get(Object(tab), key)));
      return `${repo} #${number}`;
    });
  });
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

test('a place past the last tab shows nothing new; ⌘1 to ⌘8 show a tab by its place, and ⌘9 the last however many are open', async ({
  page,
}) => {
  await test.step('a place past the last tab shows nothing new', async () => {
    await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2));
    await page.keyboard.press(`${cmd}+Digit1`);
    await page.keyboard.press(`${cmd}+Digit5`);
    await page.keyboard.press(`${cmd}+Digit1`);
    await expect(shown(page)).toHaveText('a #1');
    await expect(tabs(page)).toHaveText(['a #1', 'b #2']);
  });

  // The two that are open stay among the ten.
  await test.step('⌘1 to ⌘8 show a tab by its place, and ⌘9 the last however many are open', async () => {
    const repos = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    await open(page, ...repos.map((repo, index) => pull('withlo', repo, index + 1)));
    await expect.poll(() => openCount(page)).toBe(10);
    for (const place of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const tab = (await inOrder(page))[place - 1] ?? '';
      await page.keyboard.press(`${cmd}+Digit${place}`);
      await expect(shown(page)).toHaveText(tab);
      await expect(page).toHaveTitle(`withlo/${tab.replace(' ', '')}`);
    }
    const last = (await inOrder(page)).at(-1) ?? '';
    await page.keyboard.press(`${cmd}+Digit9`);
    await expect(shown(page)).toHaveText(last);
  });
});

test('⌘W closes the tab on screen and shows the one after it, until Recent comes back; and two quick ⌘Ws close two tabs', async ({
  page,
}) => {
  await test.step('⌘W closes the tab on screen and shows the one after it, until Recent comes back', async () => {
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

  // Recent is all there is: three tabs again.
  await test.step('two quick ⌘Ws close two tabs', async () => {
    await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
    await page.keyboard.press(`${cmd}+Digit1`);
    await expect(shown(page)).toHaveText('a #1');
    await page.keyboard.press(`${cmd}+KeyW`);
    await page.keyboard.press(`${cmd}+KeyW`);
    await expect(tabs(page)).toHaveText(['c #3']);
  });
});

test('a click shows a tab, its button closes it, and its right-click menu closes it', async ({
  page,
}) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await tabs(page).nth(0).click();
  await expect(shown(page)).toHaveText('a #1');

  // A tab not on screen shows its close button under the pointer, and keeps the one on screen.
  const second = tabs(page).nth(1);
  await holdHover(page, second);
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

/** The middle of `locator`, which must be on screen. */
async function middleOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('It isn’t on screen.');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Keeps the system's pointer out of Lo's window, for a test that drags. In CI, every test's copy of
 * Lo shares one virtual display, whose pointer rests over the window. As another copy opens or
 * closes, the system tells Lo's window the pointer is there, with no button held, and Chromium takes
 * that for the button let go outside the window: it lets go of the pointer the dragged tab holds,
 * which puts the tab back. Playwright's pointer doesn't come through the system, so it still
 * reaches the window.
 */
async function ignoreSystemPointer(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.setIgnoreMouseEvents(true);
  });
}

/** Presses on `tab` and drags it level to `to`'s middle and `by` pixels on, without letting go. */
async function dragTab(page: Page, tab: Locator, to: Locator, by: number): Promise<void> {
  const from = await middleOf(tab);
  const target = await middleOf(to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x + by, from.y, { steps: 8 });
}

test('a tab dragged along the strip lands where it’s let go, the others sliding aside, and Esc puts it back', async ({
  app,
  page,
}) => {
  await ignoreSystemPointer(app);
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await expect(tabs(page)).toHaveText(['a #1', 'b #2', 'c #3']);

  // Past b's middle, a is over it, and b has slid back a place. The tab is never the window's to
  // drag.
  await dragTab(page, tabs(page).nth(0), tabs(page).nth(1), 10);
  await expect(tabs(page).nth(0)).toHaveAttribute('style', /translateX\([1-9]/);
  await expect(tabs(page).nth(1)).toHaveAttribute('style', /translateX\(-\d/);
  expect(
    await tabs(page)
      .nth(0)
      .evaluate((tab) => getComputedStyle(tab).getPropertyValue('app-region')),
  ).toBe('no-drag');
  // Esc puts it back, sliding home, and letting go after moves nothing, and shows nothing new.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  for (const tab of await tabs(page).all()) await expect(tab).not.toHaveAttribute('style', /\(/);
  await expect(tabs(page)).toHaveText(['a #1', 'b #2', 'c #3']);
  await expect(shown(page)).toHaveText('c #3');

  // Let go past c, it's last, and the tab on screen stays.
  await dragTab(page, tabs(page).nth(0), tabs(page).nth(2), 10);
  await page.mouse.up();
  await expect(tabs(page)).toHaveText(['b #2', 'c #3', 'a #1']);
  await expect(shown(page)).toHaveText('c #3');
  await expect(said(page, 'a #1 is now tab 3 of 3.')).toBeAttached();

  // A click still shows a tab, and its button still closes it.
  await tabs(page).nth(2).click();
  await expect(shown(page)).toHaveText('a #1');
  await shown(page).getByRole('button', { name: 'Close tab' }).click();
  await expect(tabs(page)).toHaveText(['b #2', 'c #3']);
});

test('⌃⇧PageUp and ⌃⇧PageDown move the tab on screen a place, keeping its focus and saying where', async ({
  page,
}) => {
  await open(page, pull('withlo', 'a', 1), pull('withlo', 'b', 2), pull('withlo', 'c', 3));
  await expect(shown(page)).toHaveText('c #3');
  await page.keyboard.press('Control+Shift+PageUp');
  await expect(tabs(page)).toHaveText(['a #1', 'c #3', 'b #2']);
  await expect(said(page, 'c #3 is now tab 2 of 3.')).toBeAttached();

  // From the tab itself, focus stays on it as it moves.
  await shown(page).focus();
  await page.keyboard.press('Control+Shift+PageDown');
  await expect(tabs(page)).toHaveText(['a #1', 'b #2', 'c #3']);
  await expect(said(page, 'c #3 is now tab 3 of 3.')).toBeAttached();
  await expect(shown(page)).toBeFocused();
  // Not round the end.
  await page.keyboard.press('Control+Shift+PageDown');
  await expect(said(page, 'The tab is last in the strip already.')).toBeVisible();
  await expect(tabs(page)).toHaveText(['a #1', 'b #2', 'c #3']);

  // Two quick presses move it two places.
  await page.keyboard.press('Control+Shift+PageUp');
  await page.keyboard.press('Control+Shift+PageUp');
  await expect(tabs(page)).toHaveText(['c #3', 'a #1', 'b #2']);
  await expect(shown(page)).toBeFocused();
  await expect(shown(page)).toHaveText('c #3');
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

test('macOS’s File, View and Window menus list closing a tab, the panels and stepping through tabs', async ({
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
      'View: Threads panel Command+Shift+\\',
      'Window: Next tab Command+Shift+]',
      'Window: Previous tab Command+Shift+[',
    ]);
});

// One tab; eight at 1440 px, the most that fit before "more" appears; forty at 1440 px, where most
// are folded; and sixteen at the screen's width. The counts between only move where the strip's
// edges are.
const strips = [
  [1440, 1],
  [1440, 8],
  [1440, 40],
  ['screen', 16],
] as const;
for (const [width, count] of strips) {
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

    // ⌘1, and ⌘9 to the last tab, which comes into the strip if it was folded away.
    await page.keyboard.press(`${cmd}+Digit1`);
    await expect(shown(page)).toHaveText('r1 #1');
    await expectFits(page);
    const last = (await inOrder(page)).at(-1) ?? '';
    await page.keyboard.press(`${cmd}+Digit9`);
    await expect(shown(page)).toHaveText(last);
    await expectFits(page);
    await expect(tabs(page).last()).toHaveText(last);
    // Stepping round both ends of the tabs the strip shows.
    const before = count === 1 ? last : ((await tabs(page).nth(-2).textContent()) ?? '');
    const steps: [string, string][] = [
      [`${cmd}+Shift+BracketRight`, 'r1 #1'],
      [`${cmd}+Shift+BracketLeft`, last],
      [`${cmd}+Shift+BracketLeft`, before],
      ['Control+Tab', last],
    ];
    for (const [key, tab] of steps) {
      await page.keyboard.press(key);
      await expect(shown(page)).toHaveText(tab);
      await expectFits(page);
    }
    await expect.poll(() => openCount(page)).toBe(count);
  });
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
  // In the order, after the last tab the strip shows.
  const order = await inOrder(page);
  await expect(items).toHaveText(order.slice(16 - folded));
  const chosen = order.at(-1) ?? '';
  const replaced = order[15 - folded] ?? '';
  await items.last().click();
  await expect(menu).toBeHidden();
  await expect(shown(page)).toHaveText(chosen);
  await expectFits(page);
  // It moves into the strip's last place, in the order too, and the tab that was there folds.
  await expect(tabs(page).last()).toHaveText(chosen);
  await expect.poll(async () => (await inOrder(page))[15 - folded]).toBe(chosen);
  await more(page).click();
  await expect(items.first()).toHaveText(replaced);
  await page.keyboard.press('Escape');
});

test('with a tab brought in from "N more", a drag and the keys move exactly what the strip shows', async ({
  app,
  page,
}) => {
  await resize(app, page, 1440);
  await ignoreSystemPointer(app);
  await open(page, ...many(16));
  await page.keyboard.press(`${cmd}+Digit1`);
  const folded = await more(page).getAttribute('aria-label');
  await more(page).click();
  const items = page.getByRole('menu', { name: 'More tabs' }).getByRole('menuitem');
  const chosen = (await items.last().textContent()) ?? '';
  await items.last().click();
  await expect(tabs(page).last()).toHaveText(chosen);
  await expect(shown(page)).toHaveText(chosen);
  const before = await tabs(page).allTextContents();
  const count = before.length;

  // The second tab, let go past the last, is last in the strip, and nothing folds or comes in.
  await dragTab(page, tabs(page).nth(1), tabs(page).last(), 10);
  await page.mouse.up();
  const dropped = [...before.filter((_, index) => index !== 1), before[1] ?? ''];
  await expect(tabs(page)).toHaveText(dropped);
  await expect(more(page)).toHaveAttribute('aria-label', folded ?? '');

  // The tab on screen moves a place left and right in the strip, and no further than its end.
  await page.keyboard.press('Control+Shift+PageUp');
  await expect(tabs(page)).toHaveText(
    dropped.toSpliced(count - 2, 1).toSpliced(count - 3, 0, chosen),
  );
  await page.keyboard.press('Control+Shift+PageDown');
  await page.keyboard.press('Control+Shift+PageDown');
  const last = dropped.toSpliced(count - 2, 1).toSpliced(count - 1, 0, chosen);
  await expect(tabs(page)).toHaveText(last);
  await expect(said(page, `${chosen} is now tab ${count} of 16.`)).toBeAttached();
  await page.keyboard.press('Control+Shift+PageDown');
  await expect(said(page, 'The tab is last in the strip already.')).toBeVisible();
  await expect(tabs(page)).toHaveText(last);
  await expect(more(page)).toHaveAttribute('aria-label', folded ?? '');
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

/** How wide an element is, and whether its text is cut short. */
function fits(locator: Locator) {
  return locator.evaluate((element) => ({
    width: element.clientWidth,
    cut: element.scrollWidth > element.clientWidth,
  }));
}

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
  const page = await drawnWindow(app);
  return { app, page };
}

test('the tabs come back after Lo restarts, in the order they were moved to, with the same one on screen', async () => {
  const first = await launch();
  try {
    await open(first.page, pull('withlo', 'a', 1), { kind: 'settings' }, pull('withlo', 'c', 3));
    await expect(shown(first.page)).toHaveText('c #3');
    await first.page.keyboard.press('Control+Shift+PageUp');
    await first.page.keyboard.press('Control+Shift+PageUp');
    await expect(tabs(first.page)).toHaveText(['c #3', 'a #1', 'Settings']);
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
