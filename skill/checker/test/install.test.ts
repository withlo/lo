/**
 * `install`: the skill it writes is the repository's, byte for byte; it goes where Claude Code and
 * Codex look for it; and it replaces only its own files, never writing through a link or deleting
 * anything.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { expectSkill, listing, runChecker, scratch, skillFiles, type Ran } from './support.ts';

let root: ReturnType<typeof scratch>;
let made = 0;

beforeAll(() => {
  root = scratch('install');
});

afterAll(() => root.remove());

/** A new empty folder. */
function fresh(): string {
  // Without links, so it's named as the checker, run there, names it.
  const dir = join(realpathSync(root.dir), `case-${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The environment of a user whose home is `home`, with `set` set and nothing else of Lo's tests'. */
function userEnvironment(home: string, set: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  return { ...env, ...set };
}

/** Runs `install` with `args` for a user whose home is `home`. */
function install(args: readonly string[], home: string, set?: Record<string, string>): Ran {
  return runChecker(['install', ...args], home, userEnvironment(home, set));
}

describe('install --dir', () => {
  test('writes the skill in its own folder, and run again, replaces only the skill’s own files', () => {
    const home = fresh();
    const skills = join(home, 'skills');
    const folder = join(skills, 'lo-overview');

    expect(install(['--dir', skills], home)).toEqual({
      status: 0,
      stdout: `Installed the lo-overview skill in ${folder}.\n`,
      stderr: '',
    });
    expect(listing(folder)).toEqual([...skillFiles(), 'references/'].toSorted());
    expectSkill(folder);

    // Changed, removed and added since: the skill's own files are put back, and nothing else is
    // touched.
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: lo-overview\n---\n\nEdited.\n');
    rmSync(join(folder, 'references/figures.md'));
    writeFileSync(join(folder, 'notes.md'), 'Mine.\n');
    writeFileSync(join(folder, 'references/mine.md'), 'Mine too.\n');
    writeFileSync(join(skills, 'beside.md'), 'Beside.\n');

    expect(install(['--dir', skills], home)).toEqual({
      status: 0,
      stdout: `Installed the lo-overview skill in ${folder}.\n`,
      stderr: '',
    });
    expect(listing(folder)).toEqual(
      [...skillFiles(), 'references/', 'notes.md', 'references/mine.md'].toSorted(),
    );
    expectSkill(folder);
    expect(readFileSync(join(folder, 'notes.md'), 'utf8')).toBe('Mine.\n');
    expect(readFileSync(join(folder, 'references/mine.md'), 'utf8')).toBe('Mine too.\n');
    expect(readFileSync(join(skills, 'beside.md'), 'utf8')).toBe('Beside.\n');
  });

  test('takes a relative folder, from where it runs, and says where as JSON', () => {
    const home = fresh();
    const ran = runChecker(['install', '--dir=skills', '--json'], home, userEnvironment(home));
    expect(ran.status).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual({
      installed: [{ agent: null, folder: join(home, 'skills', 'lo-overview') }],
    });
    expectSkill(join(home, 'skills', 'lo-overview'));
  });

  test('finishes an install that was cut short, with no SKILL.md yet', () => {
    const home = fresh();
    const folder = join(home, 'skills', 'lo-overview');
    mkdirSync(join(folder, 'references'), { recursive: true });
    writeFileSync(join(folder, 'LICENSE'), 'Part.\n');
    writeFileSync(join(folder, 'references/format.md'), 'Part.\n');
    expect(install(['--dir', join(home, 'skills')], home).status).toBe(0);
    expect(listing(folder)).toEqual([...skillFiles(), 'references/'].toSorted());
    expectSkill(folder);
  });
});

describe('install for an agent', () => {
  test('puts the skill in Claude Code’s and Codex’s skills folders', () => {
    const home = fresh();
    const ran = install(['--claude', '--codex'], home);
    const claude = join(home, '.claude', 'skills', 'lo-overview');
    const codex = join(home, '.agents', 'skills', 'lo-overview');
    expect(ran).toEqual({
      status: 0,
      stdout: `Installed the lo-overview skill for Claude Code, in ${claude}.\nInstalled the lo-overview skill for Codex, in ${codex}.\n`,
      stderr: '',
    });
    expectSkill(claude);
    expectSkill(codex);
  });

  test('puts Claude Code’s skill where CLAUDE_CONFIG_DIR says Claude Code’s folder is', () => {
    const home = fresh();
    const config = join(home, 'elsewhere');
    expect(install(['--claude'], home, { CLAUDE_CONFIG_DIR: config }).status).toBe(0);
    expectSkill(join(config, 'skills', 'lo-overview'));
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  test('with no agent or folder named, installs for each agent set up here, and with none, nothing', () => {
    const home = fresh();
    const none = install([], home);
    expect(none).toEqual({
      status: 2,
      stdout: '',
      stderr:
        'Lo found neither Claude Code nor Codex set up here. Say where to install the skill with --claude, --codex or --dir <folder>. Nothing was installed.\n',
    });
    expect(readdirSync(home)).toEqual([]);

    mkdirSync(join(home, '.claude'));
    expect(install([], home).stdout).toBe(
      `Installed the lo-overview skill for Claude Code, in ${join(home, '.claude/skills/lo-overview')}.\n`,
    );
    expect(existsSync(join(home, '.agents'))).toBe(false);

    const codex = join(home, 'codex');
    mkdirSync(codex);
    expect(install([], home, { CODEX_HOME: codex }).stdout).toContain(
      `Installed the lo-overview skill for Codex, in ${join(home, '.agents/skills/lo-overview')}.\n`,
    );
    expectSkill(join(home, '.agents/skills/lo-overview'));
  });

  test('follows a link to the skills folder, as kept with someone’s other settings', () => {
    const home = fresh();
    const kept = join(home, 'settings', 'skills');
    mkdirSync(kept, { recursive: true });
    mkdirSync(join(home, '.claude'));
    symlinkSync(kept, join(home, '.claude', 'skills'));
    expect(install(['--claude'], home).status).toBe(0);
    expectSkill(join(kept, 'lo-overview'));
  });
});

/** What came of an install: how it exited, what it said, and what's in `home` after. */
interface Attempt extends Ran {
  home: string[];
}

/** Runs `install --dir <skills>` for a user whose home is `home`. */
function attempt(skills: string, home: string): Attempt {
  return { ...install(['--dir', skills], home), home: listing(home) };
}

/** A refusal, saying `why` of `path`, with `home` holding what it did before, `before`. */
function refusal(path: string, why: string, before: string[]): Attempt {
  return { status: 2, stdout: '', stderr: `${path} ${why} Nothing was installed.\n`, home: before };
}

/** What a refusal says to do instead. */
const INSTEAD = 'Remove it, or install the skill somewhere else with --dir.';

const LINK = `is a link, and Lo doesn't install the skill through links, since one could lead anywhere. ${INSTEAD}`;

describe('install refuses', () => {
  test('a link where the skill’s folder goes, never writing through it', () => {
    const home = fresh();
    const source = join(home, 'source');
    mkdirSync(join(source, 'references'), { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), '---\nname: lo-overview\n---\n\nMy own copy.\n');
    const skills = join(home, 'skills');
    mkdirSync(skills);
    symlinkSync(source, join(skills, 'lo-overview'));
    const before = listing(home);
    expect(attempt(skills, home)).toEqual(refusal(join(skills, 'lo-overview'), LINK, before));
    expect(readFileSync(join(source, 'SKILL.md'), 'utf8')).toContain('My own copy.');
  });

  test('a link where one of the skill’s folders goes', () => {
    const home = fresh();
    const outside = join(home, 'outside');
    mkdirSync(outside);
    const skills = join(home, 'skills');
    const folder = join(skills, 'lo-overview');
    mkdirSync(folder, { recursive: true });
    symlinkSync(outside, join(folder, 'references'));
    const before = listing(home);
    expect(attempt(skills, home)).toEqual(refusal(join(folder, 'references'), LINK, before));
    expect(readdirSync(outside)).toEqual([]);
  });

  test('a link where one of the skill’s files goes, keeping the link and what it leads to', () => {
    const home = fresh();
    const outside = join(home, 'outside.md');
    writeFileSync(outside, 'Mine.\n');
    const skills = join(home, 'skills');
    const folder = join(skills, 'lo-overview');
    mkdirSync(folder, { recursive: true });
    for (const path of ['SKILL.md', 'LICENSE']) {
      const at = join(folder, path);
      symlinkSync(outside, at);
      const before = listing(home);
      expect(attempt(skills, home)).toEqual(refusal(at, LINK, before));
      expect(readFileSync(outside, 'utf8')).toBe('Mine.\n');
      rmSync(at);
    }
  });

  test('a folder or file where it expects the other', () => {
    const home = fresh();
    const skills = join(home, 'skills');
    const folder = join(skills, 'lo-overview');
    mkdirSync(skills);
    writeFileSync(folder, 'A file.\n');
    const notFolder = `isn't a folder, so the skill can't go there. ${INSTEAD}`;
    expect(attempt(skills, home)).toEqual(refusal(folder, notFolder, listing(home)));

    rmSync(folder);
    mkdirSync(join(folder, 'SKILL.md'), { recursive: true });
    const notFile = `isn't a file, so the skill can't go there. ${INSTEAD}`;
    expect(attempt(skills, home)).toEqual(
      refusal(join(folder, 'SKILL.md'), notFile, listing(home)),
    );
  });

  test('a folder holding another skill, or files that aren’t the skill’s', () => {
    const home = fresh();
    const skills = join(home, 'skills');
    const folder = join(skills, 'lo-overview');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: "review"\ndescription: Mine.\n---\n');
    const named = `holds another skill, "review", so Lo left it alone. ${INSTEAD}`;
    expect(attempt(skills, home)).toEqual(refusal(folder, named, listing(home)));

    writeFileSync(join(folder, 'SKILL.md'), 'No front matter.\n');
    const unnamed = `holds another skill, so Lo left it alone. ${INSTEAD}`;
    expect(attempt(skills, home)).toEqual(refusal(folder, unnamed, listing(home)));

    rmSync(join(folder, 'SKILL.md'));
    mkdirSync(join(folder, 'references'));
    writeFileSync(join(folder, 'references', 'notes.md'), 'Mine.\n');
    const others = `holds files that aren't the lo-overview skill's, and no SKILL.md, so Lo left it alone. ${INSTEAD}`;
    expect(attempt(skills, home)).toEqual(refusal(folder, others, listing(home)));
  });

  test('everything, when any one folder refuses', () => {
    const home = fresh();
    const skills = join(home, 'skills');
    mkdirSync(join(skills, 'lo-overview'), { recursive: true });
    writeFileSync(join(skills, 'lo-overview', 'SKILL.md'), '---\nname: review\n---\n');
    const before = listing(home);
    const ran = install(['--claude', '--dir', skills], home);
    expect(ran.status).toBe(2);
    expect(listing(home)).toEqual(before);
  });

  test('anything but its own options', () => {
    const home = fresh();
    for (const args of [
      ['install', 'skills'],
      ['install', '--pr', '1'],
      ['install', '--dir'],
      ['install', '--dir='],
      ['install', '--claud'],
      ['check', '--claude'],
      ['commit', 'dir', '--pr', '1', '--dir', 'skills'],
    ]) {
      const ran = runChecker(args, home, userEnvironment(home));
      expect(ran.status, `for ${args.join(' ')}`).toBe(2);
      expect(ran.stderr).toContain('Usage:');
    }
    expect(readdirSync(home)).toEqual([]);
  });
});
