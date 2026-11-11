// The diff view's keys, pressed for real, through the registry's listener as in the app, on a small
// pull request: the cursor stays on screen, `Tab` and `⌃o` cross and come back, a comment box keeps
// its keys and stays level as it grows, a held key dies on blur, and a key Lo holds still reaches
// Vim when it isn't Lo's.

import {
  app,
  boxText,
  cursor,
  expect,
  fileOf,
  focusSide,
  inBox,
  lineOf,
  press,
  test,
} from './suite.ts';

test('j, ]f, ]t and G keep the cursor on screen', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g');
  for (let step = 0; step < 30; step++) await press(page, 'j');
  await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
  const files: string[] = [];
  for (let step = 0; step < 5; step++) {
    await press(page, ']', 'f');
    await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
    files.push(fileOf((await cursor(page))?.at) ?? '');
  }
  expect(files).toEqual([
    'src/new-name.ts',
    'src/from.ts',
    'src/to.ts',
    'docs/added.ts',
    'src/removed.ts',
  ]);
  await press(page, 'g', 'g');
  const threads: string[] = [];
  for (let step = 0; step < 2; step++) {
    await press(page, ']', 't');
    await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
    const at = (await cursor(page))?.at;
    threads.push(`${fileOf(at)}:${lineOf(at)}`);
  }
  expect(threads).toEqual(['src/app.ts:40', 'docs/added.ts:120']);
  await press(page, 'G');
  await expect.poll(async () => (await cursor(page))?.onScreen).toBe(true);
  expect(fileOf((await cursor(page))?.at)).toBe('src/removed.ts');
});

test('Tab crosses to the other side, and ⌃o comes back', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', 'j', 'j');
  const start = await cursor(page);
  expect(start?.pane).toBe('new');
  await press(page, 'Tab');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
  await press(page, 'Control+o');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('new');
  const back = (await cursor(page))?.at;
  expect([fileOf(back), lineOf(back)]).toEqual([fileOf(start?.at), lineOf(start?.at)]);
  await press(page, 'Control+i');
  await expect.poll(async () => (await cursor(page))?.pane).toBe('old');
});

test('a comment box grows as you type, and the sides stay level', async ({ page }) => {
  await focusSide(page, 'old');
  await press(page, 'g', 'g', ']', 'c', 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  const box = page.locator('.lo-diffcomposer');
  const first = (await box.boundingBox())?.height ?? 0;
  for (let line = 1; line <= 6; line++) {
    await page.keyboard.type(`Line ${line} of the comment`);
    await press(page, 'Enter');
    await expect
      .poll(() => page.evaluate(() => window.diffView.misalignment().worst))
      .toBeLessThanOrEqual(0.5);
  }
  expect((await box.boundingBox())?.height ?? 0).toBeGreaterThan(first + 60);
  expect(await boxText(page)).toContain('Line 6 of the comment');
});

test('Tab and ⇧Tab in a box keep focus there in both modes, and the next letter lands in it', async ({
  page,
}) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  const line = await cursor(page);
  await press(page, 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  // Insert mode, where Tab indents.
  await press(page, 'Tab');
  expect(await inBox(page)).toBe(true);
  await page.keyboard.type('a');
  expect(await boxText(page)).toEqual(['  a']);
  await press(page, 'Shift+Tab');
  expect(await inBox(page)).toBe(true);
  await page.keyboard.type('b');
  expect((await boxText(page)).join('\n')).toContain('ab');
  // Normal mode.
  await press(page, 'Escape', 'Tab', 'Shift+Tab', 'Tab');
  expect(await inBox(page)).toBe(true);
  await press(page, 'A');
  await page.keyboard.type('c');
  expect((await boxText(page)).join('\n')).toContain('abc');
  // Nothing reached the diff.
  await press(page, 'Escape', 'Escape');
  await expect.poll(() => inBox(page)).toBe(false);
  expect((await cursor(page))?.at).toEqual(line?.at);
});

test('a held g dies on blur', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', 'j');
  const start = await cursor(page);
  for (const blur of [
    // Focus leaves the side, and comes back.
    () =>
      page.evaluate(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) focused.blur();
        document.querySelector<HTMLElement>('.cm-content[aria-label="After"]')?.focus();
      }),
    // The window loses focus.
    () => page.evaluate(() => window.dispatchEvent(new FocusEvent('blur'))),
  ]) {
    await press(page, 'g');
    await blur();
    // Were the first `g` still held, this would be `gg`, to the top.
    await press(page, 'g');
    await page.waitForTimeout(200);
    expect((await cursor(page))?.at).toEqual(start?.at);
    await press(page, 'Escape');
  }
});

test('y w still reaches Vim', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c', '0');
  const start = await cursor(page);
  // A held `y` that went missing would leave `w` to move the cursor a word on.
  await press(page, 'y', 'w');
  await page.waitForTimeout(100);
  expect((await cursor(page))?.at).toEqual(start?.at);
  // What it yanked pastes into a comment box.
  await press(page, 'c');
  await expect.poll(() => inBox(page)).toBe(true);
  await press(page, 'Escape', 'p');
  const line = app.new[(lineOf(start?.at) ?? 1) - 1] ?? '';
  // `yw` takes the space after the word too.
  expect(await boxText(page)).toEqual([`${line.split(' ')[0]} `]);
});

test('gi goes inline and back', async ({ page }) => {
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  const start = await cursor(page);
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('inline');
  expect(await cursor(page)).toMatchObject({ pane: 'inline', at: start?.at });
  await press(page, 'g', 'i');
  await expect.poll(() => page.evaluate(() => window.diffView.layout)).toBe('split');
  expect(await cursor(page)).toMatchObject({ pane: 'new', at: start?.at });
});

test('an input method composing in a diff is cancelled, and focus moves on cleanly', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await focusSide(page, 'new');
  await press(page, 'g', 'g', ']', 'c');
  // As an input method types, through the browser's own protocol.
  const cdp = await page.context().newCDPSession(page);
  for (const round of [1, 2]) {
    await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
    await page.waitForTimeout(100);
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 });
    await page.waitForTimeout(100);
    await cdp.send('Input.insertText', { text: '日本' });
    await page.waitForTimeout(200);
    await focusSide(page, 'old');
    await press(page, 'j');
    await focusSide(page, 'new');
    await press(page, round === 1 ? 'k' : 'Tab');
    await page.waitForTimeout(200);
  }
  expect(errors).toEqual([]);
  await expect(page.locator('.cm-content[aria-label="After"]')).not.toContainText('日本');
});
