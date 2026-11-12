// The overview skill on a computer of the test's own: a temporary home, with the settings that move
// Claude Code's folder, so nothing reaches the real `~/.claude` or `~/.agents`.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installSkill, shown, skillState } from './skill.ts';

let root: string;
let made = 0;
/** The home of the computer in the test running now. */
let home: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lo-skill-')));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  home = join(root, `home-${made++}`);
  mkdirSync(home);
  // Node's `homedir` reads these, which is where the installer finds the home.
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});

afterEach(() => vi.unstubAllEnvs());

/** Why Claude Code's install is refused now, or the result when it is not. */
function why() {
  const [result] = installSkill(['claude'], {});
  return result?.kind === 'refused' ? result.why : result;
}

/** The skill's own `SKILL.md`, as installed in the skills folder `skills`. */
function skillIn(skills: string): string {
  return readFileSync(join(skills, 'lo-overview', 'SKILL.md'), 'utf8');
}

describe('shown', () => {
  it('writes the home folder as ~, and leaves other paths whole', () => {
    expect(shown('/home/tess', '/home/tess')).toBe('~');
    expect(shown('/home/tess/.claude/skills', '/home/tess')).toBe('~/.claude/skills');
    expect(shown('/home/tess2/.claude', '/home/tess')).toBe('/home/tess2/.claude');
    expect(shown('/opt/claude/skills', '/home/tess')).toBe('/opt/claude/skills');
  });
});

describe('skillState', () => {
  it('says neither agent is set up on a computer with neither, and where it looked', () => {
    expect(skillState({})).toEqual({
      agents: [
        {
          agent: 'claude',
          name: 'Claude Code',
          setUp: false,
          installed: false,
          config: '~/.claude',
          skills: '~/.claude/skills',
        },
        {
          agent: 'codex',
          name: 'Codex',
          setUp: false,
          installed: false,
          config: '~/.codex',
          skills: '~/.agents/skills',
        },
      ],
    });
  });

  it('follows CLAUDE_CONFIG_DIR and CODEX_HOME, naming the folders it found', () => {
    const config = join(home, 'work', 'claude');
    mkdirSync(config, { recursive: true });
    const codex = join(home, 'codex-state');
    mkdirSync(codex);
    const state = skillState({ CLAUDE_CONFIG_DIR: config, CODEX_HOME: codex });
    expect(
      state.agents.map(({ agent, setUp, config: at, skills }) => [agent, setUp, at, skills]),
    ).toEqual([
      ['claude', true, '~/work/claude', '~/work/claude/skills'],
      ['codex', true, '~/codex-state', '~/.agents/skills'],
    ]);
  });

  it('says which agents have the skill, and which only have their folder', () => {
    mkdirSync(join(home, '.claude'));
    mkdirSync(join(home, '.codex'));
    installSkill(['claude'], {});
    expect(
      skillState({}).agents.map(({ agent, setUp, installed }) => [agent, setUp, installed]),
    ).toEqual([
      ['claude', true, true],
      ['codex', true, false],
    ]);
  });

  it('counts a skill installed where its agent isn’t set up, as an install by name leaves one', () => {
    installSkill(['codex'], {});
    expect(skillState({}).agents[1]).toMatchObject({ setUp: false, installed: true });
  });
});

describe('installSkill', () => {
  it('installs for each agent that is set up when none is named, and for no other', () => {
    mkdirSync(join(home, '.claude'));
    expect(installSkill([], {})).toEqual([{ kind: 'installed', agent: 'claude' }]);
    expect(skillIn(join(home, '.claude', 'skills'))).toContain('name: lo-overview');
    expect(existsSync(join(home, '.agents'))).toBe(false);

    mkdirSync(join(home, '.codex'));
    expect(installSkill([], {})).toEqual([
      { kind: 'installed', agent: 'claude' },
      { kind: 'installed', agent: 'codex' },
    ]);
    expect(skillIn(join(home, '.agents', 'skills'))).toContain('name: lo-overview');
  });

  it('installs for the agents named, set up or not, in the order agents are installed for', () => {
    expect(installSkill(['codex', 'claude'], {})).toEqual([
      { kind: 'installed', agent: 'claude' },
      { kind: 'installed', agent: 'codex' },
    ]);
    expect(existsSync(join(home, '.claude', 'skills', 'lo-overview', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.agents', 'skills', 'lo-overview', 'SKILL.md'))).toBe(true);
  });

  it('puts Claude Code’s skill in CLAUDE_CONFIG_DIR, and leaves ~/.claude alone', () => {
    const config = join(home, 'work-claude');
    mkdirSync(config);
    expect(installSkill([], { CLAUDE_CONFIG_DIR: config })).toEqual([
      { kind: 'installed', agent: 'claude' },
    ]);
    expect(skillIn(join(config, 'skills'))).toContain('name: lo-overview');
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('refuses, with none named and none set up, saying so for no agent in particular', () => {
    expect(installSkill([], {})).toEqual([
      { kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } },
    ]);
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(home, '.agents'))).toBe(false);
  });

  it('refuses a link where the skill goes, and leaves what it leads to alone', () => {
    const elsewhere = join(home, 'checkout');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'SKILL.md'), '---\nname: lo-overview\n---\n\nMine.\n');
    const skills = join(home, '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    symlinkSync(elsewhere, join(skills, 'lo-overview'));
    expect(installSkill(['claude'], {})).toEqual([
      {
        kind: 'refused',
        agent: 'claude',
        why: { kind: 'link', path: join(skills, 'lo-overview') },
      },
    ]);
    expect(readFileSync(join(elsewhere, 'SKILL.md'), 'utf8')).toContain('Mine.');
  });

  it('says why for each refusal: a folder, a file, another skill, other files', () => {
    const skills = join(home, '.claude', 'skills');
    const folder = join(skills, 'lo-overview');
    mkdirSync(skills, { recursive: true });
    writeFileSync(folder, 'A file.\n');
    expect(why()).toEqual({ kind: 'notFolder', path: folder });
    rmSync(folder);

    mkdirSync(join(folder, 'SKILL.md'), { recursive: true });
    expect(why()).toEqual({ kind: 'notFile', path: join(folder, 'SKILL.md') });
    rmSync(folder, { recursive: true });

    mkdirSync(folder);
    writeFileSync(join(folder, 'SKILL.md'), '---\nname: review\n---\n');
    expect(why()).toEqual({ kind: 'otherSkill', path: folder, name: 'review' });
    writeFileSync(join(folder, 'SKILL.md'), 'No front matter.\n');
    expect(why()).toEqual({ kind: 'otherSkill', path: folder, name: null });
    rmSync(join(folder, 'SKILL.md'));

    writeFileSync(join(folder, 'notes.md'), 'Mine.\n');
    expect(why()).toEqual({ kind: 'otherFiles', path: folder });
  });

  it('says what the file system refused, when it does', () => {
    // A file where the agent's folder goes: nothing can be made or read below it.
    writeFileSync(join(home, '.claude'), 'A file.\n');
    const [result] = installSkill(['claude'], {});
    expect(result).toMatchObject({
      kind: 'refused',
      agent: 'claude',
      why: { kind: 'failed', skills: join(home, '.claude', 'skills') },
    });
  });

  it('leaves the others installed when one agent refuses', () => {
    const codex = join(home, '.agents', 'skills', 'lo-overview');
    mkdirSync(codex, { recursive: true });
    writeFileSync(join(codex, 'SKILL.md'), '---\nname: review\n---\n');
    expect(installSkill(['claude', 'codex'], {})).toEqual([
      { kind: 'installed', agent: 'claude' },
      { kind: 'refused', agent: 'codex', why: { kind: 'otherSkill', path: codex, name: 'review' } },
    ]);
    expect(skillIn(join(home, '.claude', 'skills'))).toContain('name: lo-overview');
    expect(readFileSync(join(codex, 'SKILL.md'), 'utf8')).toContain('name: review');
  });

  it('writes the skill the checker writes, pinned to its version', () => {
    installSkill(['claude'], {});
    const text = skillIn(join(home, '.claude', 'skills'));
    expect(text).toMatch(/@withlo\/overview@\d+\.\d+\.\d+/);
    expect(text).not.toContain('@withlo/overview@{version}');
  });
});
