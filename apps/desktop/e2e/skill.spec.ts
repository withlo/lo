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
  welcome(page).getByRole('listitem').filter({ hasText: 'Install the overview skill' });
const toast = (page: Page, text: string) =>
  page.getByRole('status').filter({ hasText: text }).first();

/** The skill's row, in Settings' Command line section. */
const row = (page: Page) =>
  page.locator('[data-settings-section="open.command"]').locator('.setting-row').filter({
    hasText: 'Overview skill',
  });

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
  test('the step installs the skill for the agent that is set up, and for no other', async ({
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude'));
    await expect(step(page)).toContainText(
      'Teaches Claude Code and Codex to write overviews that Lo shows.',
    );
    await step(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(step(page).getByRole('button', { name: 'Installed' })).toBeDisabled();
    await expect(toast(page, 'Installed the overview skill')).toHaveText(
      'Install overview skillInstalled the overview skill for Claude Code in ~/.claude/skills.',
    );
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
    await expect(row(page).getByRole('status')).toHaveText(
      'Installed for Claude Code in ~/.claude/skills. Not installed for Codex, which reads ~/.agents/skills.',
    );
    await row(page).getByRole('button', { name: 'Install for Codex' }).click();
    await expect(row(page).getByRole('status')).toHaveText(
      'Installed for Claude Code in ~/.claude/skills. Installed for Codex in ~/.agents/skills.',
    );
    expect(isSkill(codexSkill(home))).toBe(true);
    expect(readFileSync(claudeSkill(home), 'utf8')).toContain('Mine.');

    await row(page).getByRole('button', { name: 'Install again' }).click();
    await expect(toast(page, 'Installed the overview skill for Claude Code')).toBeVisible();
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
    await expect(row(page).getByRole('status')).toHaveText(
      `Not installed for Claude Code, which reads ~/.claude/skills. Not installed for Codex, which reads ~/.agents/skills. ${link}`,
    );
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(toast(page, 'Installed the overview skill')).toHaveText(
      `Install overview skillInstalled the overview skill for Claude Code in ~/.claude/skills. Not installed for Codex. ${link}`,
    );
    // It stays said, since the link is still there, and it isn't in the way of Claude Code's.
    await expect(row(page).getByRole('status')).toHaveText(
      `Installed for Claude Code in ~/.claude/skills. Not installed for Codex, which reads ~/.agents/skills. ${link}`,
    );
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
    const terminal = page
      .locator('[data-settings-section="open.command"]')
      .locator('.setting-row')
      .filter({ hasText: 'Install from a terminal' });
    await expect(terminal).toContainText(
      `${command} installs the skill Lo does, for each agent set up on the computer you run it on.`,
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
    const at = labels.indexOf('Install command-line tool');
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
