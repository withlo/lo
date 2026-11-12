/**
 * `install` as the desktop app calls it, in this process rather than through the command line:
 * where each agent keeps its skills for a user whose home and settings the test sets, what's set up
 * and installed there, and why an install is refused, as a `reason` the caller can word for itself.
 * Nothing here touches the real home folder.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  agentFolders,
  install,
  InstallError,
  installedIn,
  isSetUp,
  targetsOf,
  type InstallReason,
  type Target,
} from '../src/install.ts';
import { expectSkill, listing } from './support.ts';

let root: string;
let made = 0;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-checker-reasons-')));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The user's home folder in the test running now. */
let home: string;

beforeEach(() => {
  home = join(root, `home-${made++}`);
  mkdirSync(home);
  // A home of the test's own, as Node's `homedir` reads it, so nothing reaches the real one.
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});

afterEach(() => vi.unstubAllEnvs());

/** The reason an install is refused for, or an error saying it wasn't. */
function reasonOf(targets: readonly Target[]): InstallReason {
  try {
    install(targets);
  } catch (error) {
    if (error instanceof InstallError) return error.reason;
    throw error;
  }
  throw new Error('The install was not refused.');
}

/** Why no agent is chosen when none is named and none is set up, or an error saying one was. */
function reasonOfNone(): InstallReason {
  try {
    targetsOf({ agents: [], dir: undefined }, {});
  } catch (error) {
    if (error instanceof InstallError) return error.reason;
    throw error;
  }
  throw new Error('An agent was chosen.');
}

/** The skills folder `name` in the user's home, as a target no agent owns. */
function skills(name = 'skills'): Target {
  return { agent: undefined, skills: join(home, name) };
}

describe('agentFolders', () => {
  test('puts each agent’s skills in its default folder under the home', () => {
    expect(agentFolders('claude', {})).toEqual({
      skills: join(home, '.claude', 'skills'),
      setUp: join(home, '.claude'),
    });
    expect(agentFolders('codex', {})).toEqual({
      skills: join(home, '.agents', 'skills'),
      setUp: join(home, '.codex'),
    });
  });

  test('follows CLAUDE_CONFIG_DIR and CODEX_HOME when they’re absolute, and ignores them when not', () => {
    const config = join(home, 'elsewhere');
    expect(agentFolders('claude', { CLAUDE_CONFIG_DIR: config })).toEqual({
      skills: join(config, 'skills'),
      setUp: config,
    });
    // Codex reads its skills from the home's `.agents`, wherever its own state is.
    expect(agentFolders('codex', { CODEX_HOME: config })).toEqual({
      skills: join(home, '.agents', 'skills'),
      setUp: config,
    });
    expect(agentFolders('claude', { CLAUDE_CONFIG_DIR: 'relative' }).setUp).toBe(
      join(home, '.claude'),
    );
    expect(agentFolders('codex', { CODEX_HOME: '' }).setUp).toBe(join(home, '.codex'));
  });
});

describe('isSetUp', () => {
  test('is true for an agent whose own folder is there, a link to one included', () => {
    expect([isSetUp('claude', {}), isSetUp('codex', {})]).toEqual([false, false]);
    mkdirSync(join(home, '.claude'));
    expect([isSetUp('claude', {}), isSetUp('codex', {})]).toEqual([true, false]);
    mkdirSync(join(home, 'kept'));
    symlinkSync(join(home, 'kept'), join(home, '.codex'));
    expect(isSetUp('codex', {})).toBe(true);
    // A file there isn't a set-up agent, and CLAUDE_CONFIG_DIR moves the folder looked in.
    writeFileSync(join(home, 'config'), 'A file.\n');
    expect(isSetUp('claude', { CLAUDE_CONFIG_DIR: join(home, 'config') })).toBe(false);
    expect(isSetUp('claude', { CLAUDE_CONFIG_DIR: join(home, 'kept') })).toBe(true);
  });
});

describe('installedIn', () => {
  test('says whether the skills folder holds the skill', () => {
    const target = skills();
    expect(installedIn(target.skills)).toBe(false);
    install([target]);
    expect(installedIn(target.skills)).toBe(true);
    expectSkill(join(target.skills, 'lo-overview'));
  });

  test('doesn’t count a folder of another skill, or one with no SKILL.md', () => {
    const folder = join(home, 'skills', 'lo-overview');
    mkdirSync(folder, { recursive: true });
    expect(installedIn(join(home, 'skills'))).toBe(false);
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: review\n---\n');
    expect(installedIn(join(home, 'skills'))).toBe(false);
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: lo-overview\n---\n');
    expect(installedIn(join(home, 'skills'))).toBe(true);
  });

  test('counts a skill read through a link, as the agent reads it', () => {
    const source = join(home, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'SKILL.md'), '---\nname: lo-overview\n---\n');
    mkdirSync(join(home, 'skills'));
    symlinkSync(source, join(home, 'skills', 'lo-overview'));
    expect(installedIn(join(home, 'skills'))).toBe(true);
  });

  test('is false, not an error, for a SKILL.md that is a folder', () => {
    mkdirSync(join(home, 'skills', 'lo-overview', 'SKILL.md'), { recursive: true });
    expect(installedIn(join(home, 'skills'))).toBe(false);
  });
});

describe('targetsOf', () => {
  test('with no agent named, takes each that’s set up, and refuses with none', () => {
    expect(reasonOfNone()).toEqual({ kind: 'nothingSetUp' });
    mkdirSync(join(home, '.codex'));
    expect(targetsOf({ agents: [], dir: undefined }, {})).toEqual([
      { agent: 'codex', skills: join(home, '.agents', 'skills') },
    ]);
  });

  test('takes the agents named whether or not they’re set up', () => {
    expect(targetsOf({ agents: ['claude'], dir: undefined }, {})).toEqual([
      { agent: 'claude', skills: join(home, '.claude', 'skills') },
    ]);
  });
});

describe('install', () => {
  test('writes into a temp home’s agent folders, and into CLAUDE_CONFIG_DIR’s skills', () => {
    const config = join(home, 'work-claude');
    const env = { CLAUDE_CONFIG_DIR: config };
    mkdirSync(config);
    mkdirSync(join(home, '.codex'));
    const targets = targetsOf({ agents: [], dir: undefined }, env);
    const done = install(targets);
    expect(done.map(({ agent, folder }) => [agent, folder])).toEqual([
      ['claude', join(config, 'skills', 'lo-overview')],
      ['codex', join(home, '.agents', 'skills', 'lo-overview')],
    ]);
    for (const { folder } of done) expectSkill(folder);
    // Claude Code's own default folder is left alone, since its settings moved.
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });
});

describe('a reason', () => {
  test('link, for a link where the skill’s folder, a folder in it or a file of it goes', () => {
    const target = skills();
    const folder = join(target.skills, 'lo-overview');
    mkdirSync(target.skills);
    mkdirSync(join(home, 'outside'));
    symlinkSync(join(home, 'outside'), folder);
    expect(reasonOf([target])).toEqual({ kind: 'link', path: folder });
    rmSync(folder);

    mkdirSync(folder);
    symlinkSync(join(home, 'outside'), join(folder, 'references'));
    expect(reasonOf([target])).toEqual({ kind: 'link', path: join(folder, 'references') });
    rmSync(join(folder, 'references'));

    writeFileSync(join(home, 'mine.md'), 'Mine.\n');
    symlinkSync(join(home, 'mine.md'), join(folder, 'SKILL.md'));
    expect(reasonOf([target])).toEqual({ kind: 'link', path: join(folder, 'SKILL.md') });
    expect(listing(home)).toContain(`skills/lo-overview/SKILL.md -> ${join(home, 'mine.md')}`);
    expect(listing(join(home, 'outside'))).toEqual([]);
  });

  test('notFolder and notFile, for a file or a folder where the other goes', () => {
    const target = skills();
    const folder = join(target.skills, 'lo-overview');
    mkdirSync(target.skills);
    writeFileSync(folder, 'A file.\n');
    expect(reasonOf([target])).toEqual({ kind: 'notFolder', path: folder });
    rmSync(folder);
    mkdirSync(join(folder, 'SKILL.md'), { recursive: true });
    expect(reasonOf([target])).toEqual({ kind: 'notFile', path: join(folder, 'SKILL.md') });
  });

  test('otherSkill, with its name when it gives one, and otherFiles', () => {
    const target = skills();
    const folder = join(target.skills, 'lo-overview');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: "review"\n---\n');
    expect(reasonOf([target])).toEqual({ kind: 'otherSkill', path: folder, name: 'review' });
    writeFileSync(join(folder, 'SKILL.md'), 'No front matter.\n');
    expect(reasonOf([target])).toEqual({ kind: 'otherSkill', path: folder, name: undefined });
    rmSync(join(folder, 'SKILL.md'));
    writeFileSync(join(folder, 'notes.md'), 'Mine.\n');
    expect(reasonOf([target])).toEqual({ kind: 'otherFiles', path: folder });
  });

  test('failed, with what the file system said, when the folder can’t be made or read', () => {
    // A file where the skills folder's parent goes: it can be neither read nor made.
    writeFileSync(join(home, 'file'), 'A file.\n');
    const target: Target = { agent: undefined, skills: join(home, 'file', 'skills') };
    const reason = reasonOf([target]);
    expect(reason).toMatchObject({ kind: 'failed', skills: target.skills });
    expect(reason.kind === 'failed' && reason.detail).toMatch(/ENOTDIR|not a directory/i);
  });

  test('keeps its message for the command line, with the reason beside it', () => {
    const target = skills();
    mkdirSync(join(target.skills, 'lo-overview'), { recursive: true });
    writeFileSync(join(target.skills, 'lo-overview', 'SKILL.md'), '---\nname: review\n---\n');
    expect(() => install([target])).toThrow(
      `${join(target.skills, 'lo-overview')} holds another skill, "review", so Lo left it alone. Remove it, or install the skill somewhere else with --dir. Nothing was installed.`,
    );
  });

  test('is the first refusal’s, and nothing is written for any target', () => {
    const fine = skills('fine');
    const refused = skills('refused');
    mkdirSync(join(refused.skills, 'lo-overview'), { recursive: true });
    writeFileSync(join(refused.skills, 'lo-overview', 'SKILL.md'), '---\nname: review\n---\n');
    const before = listing(home);
    expect(reasonOf([fine, refused])).toMatchObject({ kind: 'otherSkill' });
    expect(listing(home)).toEqual(before);
  });
});
