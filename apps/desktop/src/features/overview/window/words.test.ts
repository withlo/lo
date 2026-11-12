import { describe, expect, it } from 'vitest';

import type { SkillAgent, SkillRefusal, SkillResult, SkillState } from '../contract.ts';
import {
  ABOUT,
  agentsToInstall,
  anyRefused,
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
        ...claude,
      },
      {
        agent: 'codex',
        name: 'Codex',
        setUp: true,
        installed: false,
        config: '~/.codex',
        skills: '~/.agents/skills',
        ...codex,
      },
    ],
  };
}

const nothing = state({ setUp: false }, { setUp: false });

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
      { kind: 'failed', skills: '/h/.claude/skills', detail: 'EACCES: permission denied' },
      "Lo couldn't write in /h/.claude/skills: EACCES: permission denied. Fix that, then install again.",
    ],
    [
      { kind: 'failed', skills: '/h/.claude/skills', detail: 'It is read-only.' },
      "Lo couldn't write in /h/.claude/skills: It is read-only. Fix that, then install again.",
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
        why: { kind: 'link', path: '/h/.agents/skills/lo-overview' },
      },
    ];
    expect(resultWords(results, both)).toBe(
      "Installed the overview skill for Claude Code in ~/.claude/skills. Not installed for Codex. /h/.agents/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.",
    );
    expect(anyRefused(results)).toBe(true);
    expect(anyRefused(results.slice(0, 1))).toBe(false);
  });

  it('says that none is set up without naming an agent', () => {
    expect(
      resultWords([{ kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } }], nothing),
    ).toBe(
      'Lo found neither Claude Code nor Codex set up on this computer. Set one up, then install the skill.',
    );
  });
});
