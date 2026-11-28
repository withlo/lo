import { describe, expect, it } from 'vitest';

import type { SkillAgent, SkillRefusal, SkillState } from '../contract.ts';
import {
  agentsToInstall,
  installedEverywhere,
  installLabel,
  installWords,
  notSetUp,
  refusalWords,
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
  it('says where it is installed, a line for each agent', () => {
    expect(standing(state({ installed: true }))).toEqual([
      { line: 'Claude Code · installed in', folder: '~/.claude/skills' },
      { line: 'Codex · not installed' },
    ]);
    expect(standing(state({ installed: true }, { installed: true }))).toEqual([
      { line: 'Claude Code · installed in', folder: '~/.claude/skills' },
      { line: 'Codex · installed in', folder: '~/.agents/skills' },
    ]);
  });

  it('says an agent is not set up', () => {
    expect(standing(nothing)).toEqual([
      { line: 'Claude Code · not set up' },
      { line: 'Codex · not set up' },
    ]);
  });
});

describe('standing, with what stops an install', () => {
  const link: SkillRefusal = { kind: 'link', path: '~/.claude/skills/lo-explain' };
  const LINK = '`~/.claude/skills/lo-explain` is a link, not a folder.';

  it('says a skill reached through a link is installed, and that Lo can’t update it', () => {
    expect(standing(state({ installed: true, blocked: link }))[0]).toEqual({
      line: 'Claude Code · installed, can’t update',
      why: LINK,
    });
  });

  it('says what stops an install where the skill is not installed', () => {
    expect(
      standing(state({ blocked: link }, { blocked: { kind: 'notFolder', path: '~/.agents' } })),
    ).toEqual([
      { line: 'Claude Code · not installed', why: LINK },
      {
        line: 'Codex · not installed',
        why: '`~/.agents` is a file, not a folder.',
      },
    ]);
  });

  it('says nothing of what stops an install for an agent that is not set up', () => {
    expect(standing(state({ installed: true }, { setUp: false, blocked: link }))[1]).toEqual({
      line: 'Codex · not set up',
    });
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
  it('says Install until it is installed for every agent set up, then Install again', () => {
    expect(installLabel(undefined)).toBe('Install');
    expect(installLabel(state())).toBe('Install');
    expect(installLabel(nothing)).toBe('Install');
    // The rows under it name the rest.
    expect(installLabel(state({ installed: true }))).toBe('Install');
    expect(installLabel(state({}, { installed: true }))).toBe('Install');
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
    [{ kind: 'nothingSetUp' }, 'Set up Claude Code or Codex first'],
    [
      { kind: 'link', path: '/h/.claude/skills/lo-explain' },
      '`/h/.claude/skills/lo-explain` is a link, not a folder.',
    ],
    [
      { kind: 'notFolder', path: '/h/.claude/skills/lo-explain' },
      '`/h/.claude/skills/lo-explain` is a file, not a folder.',
    ],
    [
      { kind: 'notFile', path: '/h/.claude/skills/lo-explain/SKILL.md' },
      '`/h/.claude/skills/lo-explain/SKILL.md` is a folder, not a file.',
    ],
    [
      { kind: 'otherSkill', path: '/h/skills/lo-explain', name: 'review' },
      '`/h/skills/lo-explain` holds another skill, “review”.',
    ],
    [
      { kind: 'otherSkill', path: '/h/skills/lo-explain', name: null },
      '`/h/skills/lo-explain` holds another skill.',
    ],
    [
      { kind: 'otherFiles', path: '/h/skills/lo-explain' },
      '`/h/skills/lo-explain` holds other files.',
    ],
    [failed({ code: 'EACCES', path: '~/.claude/skills' }), '`~/.claude/skills` isn’t writable.'],
    [failed({ code: 'EPERM', path: null }), '`~/.claude/skills` isn’t writable.'],
    [failed({ code: 'EROFS', path: '~/.claude' }), '`~/.claude` is read-only.'],
    [failed({ code: 'ENOSPC', path: null }), 'The disk is full.'],
    [
      failed({ code: 'EIO', path: null, detail: 'EIO: i/o error, mkdir.' }),
      // A cause Lo can't name: no reason line, and the system's words behind Details.
      '',
    ],
    [failed({ code: null, path: null, detail: 'Something odd' }), ''],
  ];

  it.each(refusals)('words %j', (why, words) => {
    expect(refusalWords(why, claude)).toBe(words);
  });

  it('never speaks of the command line, which the app has none of', () => {
    for (const [why] of refusals) expect(refusalWords(why, claude)).not.toContain('--');
  });
});

describe('notSetUp', () => {
  it('names the agents to set up while none is, and nothing once one is or before Lo knows', () => {
    expect(notSetUp(nothing)).toBe('Set up Claude Code or Codex first');
    expect(notSetUp(state())).toBeUndefined();
    expect(notSetUp(state({ setUp: false }))).toBeUndefined();
    expect(notSetUp(undefined)).toBeUndefined();
  });
});

describe('installWords', () => {
  const link = { kind: 'link', path: '~/.agents/skills/lo-explain' } as const;

  it('says it’s done, with no agent named, where it went for each', () => {
    expect(
      installWords(
        [
          { kind: 'installed', agent: 'claude' },
          { kind: 'installed', agent: 'codex' },
        ],
        state(),
      ),
    ).toEqual({ done: 'Installed overview skill', failed: [] });
  });

  it('names each agent where it went for some and failed for the rest, with why', () => {
    const said = installWords(
      [
        { kind: 'installed', agent: 'claude' },
        { kind: 'refused', agent: 'codex', why: link },
      ],
      state(),
    );
    expect(said.done).toBe('Installed overview skill for Claude Code');
    expect(said.failed).toEqual([
      {
        title: 'Couldn’t install Codex’s overview skill',
        body: refusalWords(link, state()),
        details: undefined,
      },
    ]);
  });

  it('puts what the system said of a failure behind Details, with no reason where Lo can’t name it', () => {
    const odd = failed({ code: 'EIO', detail: 'EIO: i/o error, mkdir' });
    expect(installWords([{ kind: 'refused', agent: 'codex', why: odd }], state()).failed).toEqual([
      {
        title: 'Couldn’t install Codex’s overview skill',
        body: '',
        details: 'EIO: i/o error, mkdir',
      },
    ]);
  });

  it('says nothing done where it failed for each', () => {
    const said = installWords([{ kind: 'refused', agent: 'codex', why: link }], state());
    expect(said.done).toBeUndefined();
    expect(said.failed.map((each) => each.title)).toEqual([
      'Couldn’t install Codex’s overview skill',
    ]);
  });
});
