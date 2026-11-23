// The overview skill's rows in the app: the step on the welcome screen, the rows in Settings' Command
// line, and the command in the app menu and the palette. Each test starts Lo with a home folder of
// its own, so the skill goes into folders the test made and never into the real ~/.claude or
// ~/.agents, and with the variables that move an agent's folder cleared.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test as base } from './app.ts';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const test = base.extend<{ home: string }>({
  // Playwright reads a fixture's dependencies from its first parameter, which must be a pattern.
  // oxlint-disable-next-line no-empty-pattern
  home: async ({}, use) => {
    const home = test.info().outputPath('home');
    mkdirSync(home, { recursive: true });
    const real = realpathSync(home);
    // The one rule of this file: nothing here can reach the home folder of whoever runs it.
    expect(real).not.toBe(realpathSync(homedir()));
    expect(real.startsWith(realpathSync(test.info().outputDir))).toBe(true);
    await use(real);
  },
  launch: async ({ home }, use) => {
    await use({
      env: {
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: '',
        CODEX_HOME: '',
      },
    });
  },
});

const welcome = (page: Page) => page.locator('[data-lo-scope="welcome"]');
const step = (page: Page) =>
  welcome(page).getByRole('listitem').filter({ hasText: 'Overview skill' });
const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text }).first();

/** The skill's row, in Settings › Integrations. */
const row = (page: Page) => page.locator('[data-settings-row="overview.skillRow"]');

/** What Settings' row says of each agent, a line each. */
const lines = (page: Page) => row(page).getByRole('status').locator('li');

/** Where an agent's copy of the skill's `SKILL.md` goes in `home`. */
const claudeSkill = (home: string) => join(home, '.claude', 'skills', 'lo-overview', 'SKILL.md');
const codexSkill = (home: string) => join(home, '.agents', 'skills', 'lo-overview', 'SKILL.md');

/** Whether `path` is the overview skill's `SKILL.md`. */
function isSkill(path: string): boolean {
  return existsSync(path) && readFileSync(path, 'utf8').includes('name: lo-overview');
}

/** Asks main to install the skill for `agents`, as the rows do. */
async function installFor(page: Page, agents: ('claude' | 'codex')[]): Promise<void> {
  const reply = await page.evaluate(
    (named) => window.lo.invoke('overview.installSkill', { agents: named }),
    agents,
  );
  expect(reply.ok).toBe(true);
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('main[data-lo-middle]').focus();
  await page.keyboard.press(`${cmd}+Comma`);
  await expect(page.getByRole('navigation', { name: 'Settings' })).toBeVisible();
  await expect(row(page)).toBeVisible();
}

test.describe('on the welcome screen', () => {
  test('the step installs the skill for the agent that is set up, and for no other, and says so itself', async ({
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude'));
    // The skill's row is on the welcome's set-up step, two on from the first.
    await welcome(page)
      .getByRole('button', { name: /^Continue/ })
      .click();
    await welcome(page)
      .getByRole('button', { name: /^Continue/ })
      .click();
    await expect(step(page)).toContainText(
      'Teaches Claude Code and Codex to write overviews that Lo shows.',
    );
    await step(page).getByRole('button', { name: 'Install', exact: true }).click();
    // The step says so, and nothing else says it again.
    await expect(step(page)).toContainText('Installed');
    await expect(step(page).getByRole('button')).toHaveCount(0);
    await expect(toast(page, 'Installed the overview skill')).toHaveCount(0);
    expect(isSkill(claudeSkill(home))).toBe(true);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });
});

test.describe('in Settings', () => {
  test('names where the skill goes, installs for the rest, and installs again', async ({
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.codex'));
    await installFor(page, ['claude']);
    // A change of the user's, in the skill's own file: installing for Codex leaves it, since
    // Claude Code has the skill already, and installing again puts the file back.
    writeFileSync(claudeSkill(home), `${readFileSync(claudeSkill(home), 'utf8')}\nMine.\n`);

    await openSettings(page);
    await expect(lines(page)).toHaveText([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · not installed',
    ]);
    await row(page).getByRole('button', { name: 'Install for Codex' }).click();
    await expect(lines(page)).toHaveText([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · installed in ~/.agents/skills',
    ]);
    expect(isSkill(codexSkill(home))).toBe(true);
    expect(readFileSync(claudeSkill(home), 'utf8')).toContain('Mine.');

    // The row says where the skill stands, and nothing else says it again.
    await row(page).getByRole('button', { name: 'Install again' }).click();
    await expect.poll(() => readFileSync(claudeSkill(home), 'utf8')).not.toContain('Mine.');
    expect(isSkill(claudeSkill(home))).toBe(true);
  });

  test('refuses a link, says why for that agent, and installs for the other', async ({
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.codex'));
    // Where Codex's copy of the skill goes is a link, which could lead anywhere.
    const outside = join(home, 'checkout');
    mkdirSync(outside);
    const skills = join(home, '.agents', 'skills');
    mkdirSync(skills, { recursive: true });
    symlinkSync(outside, join(skills, 'lo-overview'));
    const link =
      "~/.agents/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.";

    await openSettings(page);
    // What would stop the install is said before it's tried.
    await expect(lines(page)).toHaveText([
      'Claude Code · not installed',
      `Codex · not installed ${link}`,
    ]);
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    // It stays said, since the link is still there, and it isn't in the way of Claude Code's.
    await expect(lines(page)).toHaveText([
      'Claude Code · installed in ~/.claude/skills',
      `Codex · not installed ${link}`,
    ]);
    expect(isSkill(claudeSkill(home))).toBe(true);
    expect(lstatSync(join(skills, 'lo-overview')).isSymbolicLink()).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });
});

test.describe('in Settings, from a terminal', () => {
  test('shows the command that installs the skill Lo does, which y c copies', async ({
    app,
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude'));
    await installFor(page, ['claude']);
    // The version of the checker the skill Lo installs runs.
    const pinned = /@withlo\/overview@(\S+) /.exec(readFileSync(claudeSkill(home), 'utf8'))?.[1];
    expect(pinned).toBeDefined();
    const command = `npx @withlo/overview@${pinned} install`;

    await openSettings(page);
    const terminal = page.locator('[data-settings-row="overview.installCommand"]');
    await expect(terminal).toContainText(
      `On another computerThe overview skill installs from a terminal.${command}`,
    );
    // Writing the clipboard only where it's the test's own: not on a Mac someone works on.
    test.skip(mac, "The Mac's clipboard is its user's.");
    await page.keyboard.press('y');
    await page.keyboard.press('c');
    await expect(terminal.getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(command);
  });
});

test.describe('as a command', () => {
  test('is in the palette with no key, and runs from it', async ({ page, home }) => {
    mkdirSync(join(home, '.claude'));
    await page.locator('main[data-lo-middle]').focus();
    await page.keyboard.press(`${cmd}+Shift+KeyP`);
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('Install overview skill');
    const option = palette.getByRole('option', { name: 'Install overview skill' });
    await expect(option).toBeVisible();
    await expect(option.locator('kbd')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(toast(page, 'Installed the overview skill')).toBeVisible();
    expect(isSkill(claudeSkill(home))).toBe(true);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  test('is in the app menu beside the command-line tool, and a click runs it', async ({
    app,
    page,
    home,
  }) => {
    test.skip(!mac, 'The app menu is the Mac’s.');
    mkdirSync(join(home, '.claude'));
    const labels = await app.evaluate(({ Menu }) =>
      (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? []).map((item) => item.label),
    );
    const at = labels.indexOf('Install lo command');
    expect(at).toBeGreaterThan(-1);
    expect(labels[at + 1]).toBe('Install overview skill');
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.items[0]?.submenu?.items.find(
        ({ label }) => label === 'Install overview skill',
      );
      item?.click({ triggeredByAccelerator: false });
    });
    await expect(toast(page, 'Installed the overview skill')).toBeVisible();
    expect(isSkill(claudeSkill(home))).toBe(true);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });
});
