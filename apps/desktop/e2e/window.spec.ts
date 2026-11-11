import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { appEnvironment, appFolder, dataFolder, electronBinary, expect, test } from './app.ts';

test('the window opens on a fresh data folder', async ({ app, page }) => {
  expect(page.url()).toBe('lo-app://app/index.html');
  expect(await page.title()).toBe('Lo');
  expect(app.windows()).toHaveLength(1);
  await expect(page.getByRole('tablist', { name: 'Pull requests' })).toBeVisible();

  const paths = await app.evaluate((electron) => ({
    data: electron.app.getPath('userData'),
    window: electron.session.fromPartition('persist:window').getStoragePath(),
  }));
  expect(paths).toEqual({
    data: dataFolder(),
    window: join(dataFolder(), 'Partitions', 'window'),
  });
});

test('a second launch on the same data folder hands over to the first', async ({ app, page }) => {
  const handedOver = await app.evaluateHandle((electron) => ({
    promise: new Promise<boolean>((resolve) => {
      electron.app.once('second-instance', () => resolve(true));
    }),
  }));

  // It exits cleanly, without opening a window; execFile rejects on any other exit.
  await promisify(execFile)(electronBinary, [appFolder], {
    env: appEnvironment(dataFolder()),
    timeout: 20_000,
  });

  expect(await handedOver.evaluate(({ promise }) => promise)).toBe(true);
  expect(app.windows()).toEqual([page]);
});

test('the window opens on Recent pull requests alone, in both of its fonts', async ({ page }) => {
  const strip = page.getByRole('tablist', { name: 'Pull requests' });
  await expect(strip.getByRole('tab')).toHaveText(['Recent pull requests']);
  const open = strip.getByRole('button', { name: 'Open a pull request' });
  await expect(open).toBeVisible();
  expect(
    await open.evaluate((button) => getComputedStyle(button).getPropertyValue('app-region')),
  ).toBe('no-drag');

  const fonts = await page.evaluate(async () => {
    const ui = await document.fonts.load('13px "Host Grotesk"');
    const mono = await document.fonts.load('12.5px "Fragment Mono"');
    const files = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.woff2'));
    return {
      ui: ui.map((face) => face.status),
      mono: mono.map((face) => face.status),
      files: files.every((name) => name.startsWith('lo-app://app/assets/')),
      family: getComputedStyle(document.body.querySelector('.lo-app') ?? document.body).fontFamily,
    };
  });
  expect(fonts.ui).toContain('loaded');
  expect(fonts.mono).toContain('loaded');
  expect(fonts.files).toBe(true);
  expect(fonts.family).toMatch(/^"Host Grotesk"/);
  // It opens the box to open a pull request with.
  await open.click();
  await expect(page.getByRole('dialog', { name: 'Open a pull request' })).toBeVisible();
  // Their licenses ship with the window's files.
  for (const font of ['host-grotesk', 'fragment-mono']) {
    expect(
      await readFile(join(appFolder, 'dist', 'window', 'licenses', `${font}.txt`), 'utf8'),
    ).toContain('SIL Open Font License');
  }
});

test("the tab strip's row clears the window's controls", async ({ page }) => {
  // The strip's row, which holds the tab list between the window's insets.
  const strip = page.getByRole('tablist', { name: 'Pull requests' }).locator('..');
  const layout = await strip.evaluate((element) => {
    const style = getComputedStyle(element);
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect };
      }
    ).windowControlsOverlay;
    const titlebar = overlay?.visible ? overlay.getTitlebarAreaRect() : undefined;
    return {
      platform: document.documentElement.dataset.loPlatform,
      frame: document.documentElement.dataset.loFrame,
      height: element.getBoundingClientRect().height,
      start: parseFloat(style.paddingInlineStart),
      end: parseFloat(style.paddingInlineEnd),
      drag: style.getPropertyValue('app-region'),
      controls: titlebar && window.innerWidth - titlebar.right,
    };
  });

  expect(layout.height).toBe(38);
  expect(layout.drag).toBe('drag');
  if (process.platform === 'darwin') {
    // The traffic lights sit at the start of the strip.
    expect(layout).toMatchObject({ platform: undefined, frame: undefined, start: 78, end: 0 });
  } else {
    // Frameless: the system's controls are drawn over the end of the strip.
    expect(layout).toMatchObject({ platform: 'linux', frame: 'custom', start: 0 });
    expect(layout.controls).toBeGreaterThan(0);
    expect(layout.end).toBeCloseTo(layout.controls ?? 0, 0);
  }
});

test('the strip with nothing open looks as designed', async ({ app, page }) => {
  // Screenshots differ from system to system, so they're compared on Linux, where CI runs.
  test.skip(process.platform !== 'linux', 'Compared on Linux only.');
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'dark';
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.evaluate(() => document.fonts.ready);
  const strip = page.getByRole('tablist', { name: 'Pull requests' });
  await expect(strip.getByRole('tab', { name: 'Recent pull requests' })).toBeVisible();
  await expect(strip.locator('..')).toHaveScreenshot('empty-strip.png');
});
