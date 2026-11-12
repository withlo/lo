// The overview skill's rows in the app: the step on the welcome screen, the row in Settings' Command
// line, and the command in the app menu and the palette. Each test starts Lo with a home folder of
// its own, so the skill goes into folders the test made and never into the real ~/.claude or
// ~/.agents, and with the variables that move an agent's folder cleared or set to folders there.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test as base } from './app.ts';

const mac = process.platform === 'darwin';
/** ⌘ on macOS, Ctrl on Linux. */
const cmd = mac ? 'Meta' : 'Control';

const test = base.extend<{ home: string; claudeConfig: string | undefined }>({
  /** Where in `home` Claude Code's folder is moved to by `CLAUDE_CONFIG_DIR`, if it is. */
  claudeConfig: [undefined, { option: true }],
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
  launch: async ({ home, claudeConfig }, use) => {
    await use({
      env: {
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: claudeConfig === undefined ? '' : join(home, claudeConfig),
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

  test('says so when neither agent is set up, and installs nowhere', async ({ page, home }) => {
    await step(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(toast(page, 'Lo found neither')).toContainText(
      'Lo found neither Claude Code nor Codex set up on this computer. Set one up, then install the skill.',
    );
    await expect(step(page).getByRole('button', { name: 'Install', exact: true })).toBeEnabled();
    expect(existsSync(join(home, '.claude'))).toBe(false);
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

  test('says an agent that is not set up is not, and where Lo looked', async ({ page, home }) => {
    mkdirSync(join(home, '.claude'));
    await openSettings(page);
    await expect(row(page).getByRole('status')).toHaveText(
      "Not installed for Claude Code, which reads ~/.claude/skills. Codex isn't set up here: Lo found no ~/.codex.",
    );
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(row(page).getByRole('status')).toHaveText(
      "Installed for Claude Code in ~/.claude/skills. Codex isn't set up here: Lo found no ~/.codex.",
    );
    expect(isSkill(claudeSkill(home))).toBe(true);
    expect(existsSync(join(home, '.agents'))).toBe(false);
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

  test('stops saying a refusal once what caused it is gone, when Lo comes to the front', async ({
    page,
    home,
  }) => {
    mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
    // The skill is there, reached through a link: it reads as installed, and Lo can't update it.
    const outside = join(home, 'checkout');
    mkdirSync(outside);
    writeFileSync(join(outside, 'SKILL.md'), '---\nname: lo-overview\n---\n\nMine.\n');
    const link = join(home, '.claude', 'skills', 'lo-overview');
    symlinkSync(outside, link);

    await openSettings(page);
    await expect(row(page).getByRole('status')).toHaveText(
      "Installed for Claude Code in ~/.claude/skills, but Lo can't update it. ~/.claude/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again. Codex isn't set up here: Lo found no ~/.codex.",
    );
    await expect(row(page).getByRole('button', { name: 'Install again' })).toBeEnabled();

    // The link is removed outside Lo, which learns of it when it comes to the front.
    unlinkSync(link);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(row(page).getByRole('status')).toHaveText(
      "Not installed for Claude Code, which reads ~/.claude/skills. Codex isn't set up here: Lo found no ~/.codex.",
    );
    await expect(row(page).getByRole('button', { name: 'Install', exact: true })).toBeEnabled();
    expect(readFileSync(join(outside, 'SKILL.md'), 'utf8')).toContain('Mine.');
  });

  test('says a file where the skills folder goes is not a folder', async ({ page, home }) => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'skills'), 'A file.\n');
    const words =
      "~/.claude/skills isn't a folder, so the skill can't go there. Remove it, then install again.";

    await openSettings(page);
    await expect(row(page).getByRole('status')).toHaveText(
      `Not installed for Claude Code, which reads ~/.claude/skills. ${words} Codex isn't set up here: Lo found no ~/.codex.`,
    );
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(toast(page, 'Install overview skill')).toHaveText(
      `Install overview skillNot installed for Claude Code. ${words}`,
    );
    expect(readFileSync(join(home, '.claude', 'skills'), 'utf8')).toBe('A file.\n');
  });

  test('does not freeze on a SKILL.md that is a pipe, which opening waits on forever', async ({
    page,
    home,
  }) => {
    test.skip(process.platform === 'win32', 'Pipes are a Unix thing.');
    const folder = join(home, '.claude', 'skills', 'lo-overview');
    mkdirSync(folder, { recursive: true });
    execFileSync('mkfifo', [join(folder, 'SKILL.md')]);

    await openSettings(page);
    await expect(row(page).getByRole('status')).toHaveText(
      "Not installed for Claude Code, which reads ~/.claude/skills. ~/.claude/skills/lo-overview/SKILL.md isn't a file, so the skill can't go there. Remove it, then install again. Codex isn't set up here: Lo found no ~/.codex.",
    );
    // Main still answers, and the app with it.
    await row(page).getByRole('button', { name: 'Install', exact: true }).click();
    await expect(toast(page, 'Install overview skill')).toBeVisible();
  });

  test('says in its own words when the folder will not let Lo write', async ({ page, home }) => {
    test.skip(process.platform === 'win32' || process.getuid?.() === 0, 'Needs permissions.');
    const claude = join(home, '.claude');
    mkdirSync(claude);
    chmodSync(claude, 0o500);
    try {
      await openSettings(page);
      await row(page).getByRole('button', { name: 'Install', exact: true }).click();
      await expect(toast(page, 'Install overview skill')).toHaveText(
        "Install overview skillNot installed for Claude Code. Lo doesn't have permission to use ~/.claude/skills. Change its permissions, then install again.",
      );
    } finally {
      // So that the test's folder can be cleared.
      chmodSync(claude, 0o700);
      rmSync(claude, { recursive: true, force: true });
    }
  });

  test.describe('with Claude Code’s folder moved by CLAUDE_CONFIG_DIR', () => {
    test.use({ claudeConfig: 'work/claude' });

    test('names that folder, and installs there and not in ~/.claude', async ({ page, home }) => {
      mkdirSync(join(home, 'work', 'claude'), { recursive: true });
      await openSettings(page);
      await expect(row(page).getByRole('status')).toContainText(
        'Not installed for Claude Code, which reads ~/work/claude/skills.',
      );
      await row(page).getByRole('button', { name: 'Install', exact: true }).click();
      await expect(row(page).getByRole('status')).toContainText(
        'Installed for Claude Code in ~/work/claude/skills.',
      );
      expect(isSkill(join(home, 'work', 'claude', 'skills', 'lo-overview', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.claude'))).toBe(false);
    });
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
