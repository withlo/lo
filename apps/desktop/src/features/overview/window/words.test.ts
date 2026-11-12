import { describe, expect, it } from 'vitest';

import type { SkillAgent, SkillRefusal, SkillResult, SkillState } from '../contract.ts';
import {
  ABOUT,
  agentsToInstall,
  installedEverywhere,
  installLabel,
  refusalWords,
  resultWords,
  standing,
} from './words.ts';

/** Both agents as main reports them, `changes` over each. */
function state(claude: Partial<SkillAgent> = {}, codex: Partial<SkillAgent> = {}): SkillState {
  return {
    agents: [
      {
        agent: 'claude',
        name: 'Claude Code',
        setUp: true,
        installed: false,
        config: '~/.claude',
        skills: '~/.claude/skills',
        blocked: null,
        ...claude,
      },
      {
        agent: 'codex',
        name: 'Codex',
        setUp: true,
        installed: false,
        config: '~/.codex',
        skills: '~/.agents/skills',
        blocked: null,
        ...codex,
      },
    ],
  };
}

const nothing = state({ setUp: false }, { setUp: false });

/** A refusal for the file system's, in the Claude Code's skills folder, `changes` over it. */
function failed(changes: Partial<Extract<SkillRefusal, { kind: 'failed' }>>): SkillRefusal {
  return {
    kind: 'failed',
    skills: '~/.claude/skills',
    path: null,
    code: null,
    detail: 'It failed.',
    ...changes,
  };
}

describe('standing', () => {
  it('says what the skill is for until Lo has looked', () => {
    expect(standing(undefined)).toBe(ABOUT);
  });

  it('says where it is installed, and where each agent reads', () => {
    expect(standing(state({ installed: true }))).toBe(
      'Installed for Claude Code in ~/.claude/skills. Not installed for Codex, which reads ~/.agents/skills.',
    );
    expect(standing(state({ installed: true }, { installed: true }))).toBe(
      'Installed for Claude Code in ~/.claude/skills. Installed for Codex in ~/.agents/skills.',
    );
  });

  it('names the folder it found nothing in for an agent that is not set up', () => {
    expect(standing(state({ installed: true }, { setUp: false }))).toBe(
      "Installed for Claude Code in ~/.claude/skills. Codex isn't set up here: Lo found no ~/.codex.",
    );
    expect(standing(nothing)).toBe(
      "Claude Code isn't set up here: Lo found no ~/.claude. Codex isn't set up here: Lo found no ~/.codex.",
    );
  });
});

describe('standing, with what stops an install', () => {
  const link: SkillRefusal = { kind: 'link', path: '~/.claude/skills/lo-overview' };
  const LINK =
    "~/.claude/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.";

  it('says a skill reached through a link is installed, and that Lo can’t update it', () => {
    expect(standing(state({ installed: true, blocked: link }))).toBe(
      `Installed for Claude Code in ~/.claude/skills, but Lo can't update it. ${LINK} Not installed for Codex, which reads ~/.agents/skills.`,
    );
  });

  it('says what stops an install where the skill is not installed, and keeps to the truth', () => {
    const text = standing(
      state({ blocked: link }, { blocked: { kind: 'notFolder', path: '~/.agents' } }),
    );
    expect(text).toBe(
      `Not installed for Claude Code, which reads ~/.claude/skills. ${LINK} Not installed for Codex, which reads ~/.agents/skills. ~/.agents isn't a folder, so the skill can't go there. Remove it, then install again.`,
    );
    expect(text).not.toContain('Installed for');
  });

  it('says nothing of what stops an install for an agent that is not set up', () => {
    expect(standing(state({ installed: true }, { setUp: false, blocked: link }))).toBe(
      "Installed for Claude Code in ~/.claude/skills. Codex isn't set up here: Lo found no ~/.codex.",
    );
  });
});

describe('agentsToInstall', () => {
  it('is the agents set up that lack the skill', () => {
    expect(agentsToInstall(state())).toEqual(['claude', 'codex']);
    expect(agentsToInstall(state({ installed: true }))).toEqual(['codex']);
    expect(agentsToInstall(state({ installed: true }, { setUp: false }))).toEqual(['claude']);
    expect(agentsToInstall(state({ setUp: false, installed: true }))).toEqual(['codex']);
  });

  it('is every agent set up, to install again, once they all have it', () => {
    expect(agentsToInstall(state({ installed: true }, { installed: true }))).toEqual([
      'claude',
      'codex',
    ]);
    expect(agentsToInstall(state({ installed: true }, { setUp: false }))).toEqual(['claude']);
  });

  it('is none when none is set up', () => {
    expect(agentsToInstall(nothing)).toEqual([]);
    expect(agentsToInstall(state({ setUp: false, installed: true }, { setUp: false }))).toEqual([]);
  });
});

describe('the button', () => {
  it('says Install until it is installed for any, then names the rest, then Install again', () => {
    expect(installLabel(undefined)).toBe('Install');
    expect(installLabel(state())).toBe('Install');
    expect(installLabel(nothing)).toBe('Install');
    expect(installLabel(state({ installed: true }))).toBe('Install for Codex');
    expect(installLabel(state({}, { installed: true }))).toBe('Install for Claude Code');
    expect(installLabel(state({ installed: true }, { installed: true }))).toBe('Install again');
    expect(installLabel(state({ installed: true }, { setUp: false }))).toBe('Install again');
  });

  it('is installed everywhere only when some have it and every one set up does', () => {
    expect(installedEverywhere(undefined)).toBe(false);
    expect(installedEverywhere(nothing)).toBe(false);
    expect(installedEverywhere(state({ installed: true }))).toBe(false);
    expect(installedEverywhere(state({ installed: true }, { setUp: false }))).toBe(true);
    expect(installedEverywhere(state({ installed: true }, { installed: true }))).toBe(true);
  });
});

describe('refusalWords', () => {
  const claude = state();
  const refusals: [SkillRefusal, string][] = [
    [
      { kind: 'nothingSetUp' },
      'Lo found neither Claude Code nor Codex set up on this computer. Set one up, then install the skill.',
    ],
    [
      { kind: 'link', path: '/h/.claude/skills/lo-overview' },
      "/h/.claude/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.",
    ],
    [
      { kind: 'notFolder', path: '/h/.claude/skills/lo-overview' },
      "/h/.claude/skills/lo-overview isn't a folder, so the skill can't go there. Remove it, then install again.",
    ],
    [
      { kind: 'notFile', path: '/h/.claude/skills/lo-overview/SKILL.md' },
      "/h/.claude/skills/lo-overview/SKILL.md isn't a file, so the skill can't go there. Remove it, then install again.",
    ],
    [
      { kind: 'otherSkill', path: '/h/skills/lo-overview', name: 'review' },
      '/h/skills/lo-overview holds another skill, "review". Move it, then install again.',
    ],
    [
      { kind: 'otherSkill', path: '/h/skills/lo-overview', name: null },
      '/h/skills/lo-overview holds another skill. Move it, then install again.',
    ],
    [
      { kind: 'otherFiles', path: '/h/skills/lo-overview' },
      "/h/skills/lo-overview holds files that aren't the skill's. Move them, then install again.",
    ],
    [
      failed({ code: 'EACCES', path: '~/.claude/skills' }),
      "Lo doesn't have permission to use ~/.claude/skills. Change its permissions, then install again.",
    ],
    [
      failed({ code: 'EPERM', path: null }),
      "Lo doesn't have permission to use ~/.claude/skills. Change its permissions, then install again.",
    ],
    [
      failed({ code: 'EROFS', path: '~/.claude' }),
      "~/.claude is read-only, so the skill can't go there. Make it writable, then install again.",
    ],
    [
      failed({ code: 'ENOSPC', path: null }),
      "The disk is full, so Lo couldn't write in ~/.claude/skills. Free some space, then install again.",
    ],
    [
      failed({ code: 'EIO', path: null, detail: 'EIO: i/o error, mkdir.' }),
      "Lo couldn't write in ~/.claude/skills: EIO: i/o error, mkdir. Fix that, then install again.",
    ],
    [
      failed({ code: null, path: null, detail: 'Something odd' }),
      "Lo couldn't write in ~/.claude/skills: Something odd. Fix that, then install again.",
    ],
  ];

  it.each(refusals)('words %j', (why, words) => {
    expect(refusalWords(why, claude)).toBe(words);
  });

  it('never speaks of the command line, which the app has none of', () => {
    for (const [why] of refusals) expect(refusalWords(why, claude)).not.toContain('--');
  });
});

describe('resultWords', () => {
  const both = state();

  it('says where it installed', () => {
    expect(resultWords([{ kind: 'installed', agent: 'claude' }], both)).toBe(
      'Installed the overview skill for Claude Code in ~/.claude/skills.',
    );
    expect(
      resultWords(
        [
          { kind: 'installed', agent: 'claude' },
          { kind: 'installed', agent: 'codex' },
        ],
        both,
      ),
    ).toBe(
      'Installed the overview skill for Claude Code in ~/.claude/skills and Codex in ~/.agents/skills.',
    );
  });

  it('says what was installed and what was refused, and why', () => {
    const results: SkillResult[] = [
      { kind: 'installed', agent: 'claude' },
      {
        kind: 'refused',
        agent: 'codex',
        why: { kind: 'link', path: '~/.agents/skills/lo-overview' },
      },
    ];
    expect(resultWords(results, both)).toBe(
      "Installed the overview skill for Claude Code in ~/.claude/skills. Not installed for Codex. ~/.agents/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.",
    );
  });

  it('says a skill an agent has stays as it was when an update is refused, not that it is missing', () => {
    const results: SkillResult[] = [
      {
        kind: 'refused',
        agent: 'claude',
        why: { kind: 'link', path: '~/.claude/skills/lo-overview' },
      },
    ];
    expect(resultWords(results, state({ installed: true }))).toBe(
      "Lo left the skill for Claude Code as it was. ~/.claude/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.",
    );
    expect(resultWords(results, state())).toContain('Not installed for Claude Code.');
  });

  it('says that none is set up without naming an agent', () => {
    expect(
      resultWords([{ kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } }], nothing),
    ).toBe(
      'Lo found neither Claude Code nor Codex set up on this computer. Set one up, then install the skill.',
    );
  });
});
