import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { appEnvironment, appFolder, dataFolder, electronBinary, expect, test } from './app.ts';

test('the window opens on a fresh data folder', async ({ app, page }) => {
  expect(page.url()).toBe('lo-app://app/index.html');
  expect(await page.title()).toBe('Lo');
  expect(app.windows()).toHaveLength(1);
  await expect(page.locator('header.strip')).toBeVisible();

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

test("the tab strip's row clears the window's controls", async ({ page }) => {
  const strip = page.locator('header.strip');
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
