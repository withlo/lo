/**
 * `install --repo`: what it writes into a clone, that it keeps every other key of the files it adds
 * the hook to, that run again it replaces only what it wrote, and that a refusal leaves the clone as
 * it was.
 */

import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  CLAUDE_GROUPS,
  CODEX_GROUPS,
  OVERVIEW_TEMPLATE,
  SETTINGS_TEMPLATE,
  SKILL_RULES,
} from '../src/repo.ts';
import { expectSkill, repositoryOf, runChecker, scratch, type Ran } from './support.ts';

let root: ReturnType<typeof scratch>;
let made = 0;

beforeAll(() => {
  root = scratch('repo');
});

afterAll(() => root.remove());

/** A new clone, with one commit, in a folder named as the checker names it: its top folder. */
function freshClone(): string {
  const dir = join(realpathSync(root.dir), `clone-${made++}`);
  mkdirSync(dir, { recursive: true });
  repositoryOf(dir, { 'README.md': 'Demo.\n' });
  return dir;
}

/** A home of its own, with no skills in it. */
function freshHome(): string {
  const dir = join(realpathSync(root.dir), `home-${made++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs `install --repo` with `args`, in `cwd`, for a user whose home is `home`. */
function installRepo(args: readonly string[], cwd: string, home = freshHome()): Ran {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  return runChecker(['install', '--repo', ...args], cwd, env);
}

/** What `install --repo --json` prints. */
interface Printed {
  root: string;
  changes: { path: string; state: string }[];
  shared: boolean;
  shadows: { agent: string; folder: string }[];
}

/** What `install --repo --json` printed, from `clone`. */
function installed(clone: string, home?: string): Printed {
  const ran = installRepo(['--json'], clone, home);
  expect(ran.stderr).toBe('');
  expect(ran.status).toBe(0);
  const printed: Printed = JSON.parse(ran.stdout);
  return printed;
}

/** Every file and link in `dir` but git's own, each with its text or where it leads. */
function snapshot(dir: string, inner = ''): Record<string, string> {
  return Object.fromEntries(
    readdirSync(join(dir, inner)).flatMap((name): [string, string][] => {
      const path = inner === '' ? name : `${inner}/${name}`;
      if (path === '.git') return [];
      const stats = lstatSync(join(dir, path));
      if (stats.isSymbolicLink()) return [[path, `-> ${readlinkSync(join(dir, path))}`]];
      if (stats.isDirectory()) return [[`${path}/`, ''], ...Object.entries(snapshot(dir, path))];
      if (!stats.isFile()) return [[path, 'not a file']];
      return [[path, readFileSync(join(dir, path), 'utf8')]];
    }),
  );
}

/** The JSON file at `path` in `clone`. */
function jsonAt(clone: string, path: string): unknown {
  return JSON.parse(readFileSync(join(clone, path), 'utf8'));
}

/** `.claude/settings.json` as a clone with none has it after the install. */
const CLAUDE_SETTINGS = {
  hooks: { PostToolUse: CLAUDE_GROUPS },
  permissions: { allow: SKILL_RULES },
};

/** `.codex/hooks.json` as a clone with none has it after the install. */
const CODEX_HOOKS = { hooks: { PostToolUse: CODEX_GROUPS } };

describe('install --repo, in a clone with none of it', () => {
  test('writes the skill, its link for Codex, the hooks and the templates, and says so', () => {
    const clone = freshClone();
    const ran = installRepo([], clone);
    expect(ran).toEqual({
      status: 0,
      stdout: `Installed the lo-overview skill in ${clone}:

  .claude/skills/lo-overview/: written
  .agents/skills/lo-overview: written
  .claude/settings.json: written
  .codex/hooks.json: written
  .lo/overview.md: written
  .lo/settings.json: written

Commit them in a pull request. On Codex, each person approves the hook once, in /hooks.
`,
      stderr: '',
    });
    expectSkill(join(clone, '.claude/skills/lo-overview'), 'repo');
    expect(readlinkSync(join(clone, '.agents/skills/lo-overview'))).toBe(
      '../../.claude/skills/lo-overview',
    );
    expectSkill(join(clone, '.agents/skills/lo-overview'), 'repo');
    expect(jsonAt(clone, '.claude/settings.json')).toEqual(CLAUDE_SETTINGS);
    expect(jsonAt(clone, '.codex/hooks.json')).toEqual(CODEX_HOOKS);
    expect(readFileSync(join(clone, '.lo/overview.md'), 'utf8')).toBe(OVERVIEW_TEMPLATE);
    expect(readFileSync(join(clone, '.lo/settings.json'), 'utf8')).toBe(SETTINGS_TEMPLATE);
  });

  test('runs the hook from the clone’s top, wherever the agent started', () => {
    const [claude] = CLAUDE_GROUPS;
    expect(claude?.hooks.map((handler) => handler.command)).toEqual([
      'node "$CLAUDE_PROJECT_DIR/.claude/skills/lo-overview/hook.mjs"',
      'node "$CLAUDE_PROJECT_DIR/.claude/skills/lo-overview/hook.mjs"',
      'node "$CLAUDE_PROJECT_DIR/.claude/skills/lo-overview/hook.mjs"',
    ]);
    expect(claude?.hooks.map((handler) => ('if' in handler ? handler.if : undefined))).toEqual([
      'Bash(git *push*)',
      'Bash(gh pr create *)',
      'Bash(gh pr new *)',
    ]);
    // Codex runs it through a shell, in the folder its session started in, which may be one in the
    // clone; on Windows, through cmd, from the clone's top.
    expect(CODEX_GROUPS[0]?.hooks[0]).toEqual({
      type: 'command',
      command: 'node "$(git rev-parse --show-toplevel)/.agents/skills/lo-overview/hook.mjs"',
      commandWindows: 'node .agents/skills/lo-overview/hook.mjs',
      timeout: 60,
    });
  });

  test('runs Codex’s hook as Codex does, through the shell, from a folder deep in the clone', () => {
    const clone = freshClone();
    installed(clone);
    const deep = join(clone, 'src', 'deep');
    mkdirSync(deep, { recursive: true });
    const hooks = JSON.parse(readFileSync(join(clone, '.codex/hooks.json'), 'utf8'));
    const { command } = hooks.hooks.PostToolUse[0].hooks[0];
    for (const cwd of [clone, deep]) {
      const ran = spawnSync('sh', ['-c', command], { cwd, input: '{}', encoding: 'utf8' });
      expect({ cwd, status: ran.status, stderr: ran.stderr }).toEqual({
        cwd,
        status: 0,
        stderr: '',
      });
    }
  });

  test('finds the clone’s top from a folder in it, or the one --repo names', () => {
    const clone = freshClone();
    mkdirSync(join(clone, 'src', 'deep'), { recursive: true });
    expect(installed(join(clone, 'src', 'deep')).root).toBe(clone);
    const other = freshClone();
    mkdirSync(join(other, 'src'));
    const ran = installRepo([join(other, 'src'), '--json'], clone);
    expect(JSON.parse(ran.stdout).root).toBe(other);
    expect(snapshot(other)['.claude/skills/lo-overview/SKILL.md']).toBeDefined();
  });

  test('refuses a folder that isn’t in a clone, or isn’t there', () => {
    const home = freshHome();
    expect(installRepo([], home, home)).toEqual({
      status: 2,
      stdout: '',
      stderr: `${home} isn't in a clone of a repository. Run this in one, or name one with --repo <folder>. Nothing was written.\n`,
    });
    expect(installRepo([join(home, 'gone')], home, home).status).toBe(2);
    expect(readdirSync(home)).toEqual([]);
  });
});

describe('install --repo, beside what a clone has', () => {
  test('keeps every other key of .claude/settings.json and .codex/hooks.json, in order', () => {
    const clone = freshClone();
    const claude = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: { allow: ['Bash(pnpm test *)', 'Skill(lo-overview)'], deny: ['Read(.env)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
        PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'format.sh' }] }],
      },
      env: { FOO: '1' },
    };
    const codex = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify.sh' }] }] } };
    mkdirSync(join(clone, '.claude'));
    mkdirSync(join(clone, '.codex'));
    // Four spaces and no last newline, as the team wrote them.
    writeFileSync(join(clone, '.claude/settings.json'), JSON.stringify(claude, null, 4));
    writeFileSync(join(clone, '.codex/hooks.json'), `${JSON.stringify(codex, null, '\t')}\n`);

    expect(installed(clone).changes.slice(2, 4)).toEqual([
      { path: '.claude/settings.json', state: 'updated' },
      { path: '.codex/hooks.json', state: 'updated' },
    ]);
    const settings = readFileSync(join(clone, '.claude/settings.json'), 'utf8');
    expect(settings).toBe(
      JSON.stringify(
        {
          ...claude,
          permissions: { ...claude.permissions, allow: ['Bash(pnpm test *)', ...SKILL_RULES] },
          hooks: { ...claude.hooks, PostToolUse: [...claude.hooks.PostToolUse, ...CLAUDE_GROUPS] },
        },
        null,
        4,
      ),
    );
    expect(Object.keys(JSON.parse(settings))).toEqual(['$schema', 'permissions', 'hooks', 'env']);
    expect(readFileSync(join(clone, '.codex/hooks.json'), 'utf8')).toBe(
      `${JSON.stringify({ hooks: { ...codex.hooks, PostToolUse: CODEX_GROUPS } }, null, '\t')}\n`,
    );
  });

  test('run again, keeps what’s as it wrote it, and replaces its own older hook', () => {
    const clone = freshClone();
    installed(clone);
    const before = snapshot(clone);
    expect(installed(clone).changes.map(({ state }) => state)).toEqual([
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
      'kept',
    ]);
    expect(snapshot(clone)).toEqual(before);

    // An older version's hook, in a group of its own, and beside the team's own in another.
    const older = { type: 'command', command: 'node .claude/skills/lo-overview/hook.mjs --old' };
    const theirs = { type: 'command', command: 'audit.sh' };
    writeFileSync(
      join(clone, '.claude/settings.json'),
      `${JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              { matcher: 'Bash', hooks: [older] },
              { matcher: 'Write', hooks: [theirs, older] },
            ],
          },
        },
        null,
        2,
      )}\n`,
    );
    // And an older version's skill.
    writeFileSync(
      join(clone, '.claude/skills/lo-overview/SKILL.md'),
      '---\nname: lo-overview\ndescription: Older.\n---\n\nOlder.\n',
    );
    writeFileSync(join(clone, '.lo/settings.json'), '{ "overview.auto": false }\n');
    expect(installed(clone).changes).toEqual([
      { path: '.claude/skills/lo-overview/', state: 'updated' },
      { path: '.agents/skills/lo-overview', state: 'kept' },
      { path: '.claude/settings.json', state: 'updated' },
      { path: '.codex/hooks.json', state: 'kept' },
      { path: '.lo/overview.md', state: 'kept' },
      { path: '.lo/settings.json', state: 'kept' },
    ]);
    expectSkill(join(clone, '.claude/skills/lo-overview'), 'repo');
    expect(jsonAt(clone, '.claude/settings.json')).toEqual({
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [theirs] }, ...CLAUDE_GROUPS] },
      permissions: { allow: SKILL_RULES },
    });
    // The team's settings are theirs.
    expect(readFileSync(join(clone, '.lo/settings.json'), 'utf8')).toBe(
      '{ "overview.auto": false }\n',
    );
  });

  test('leaves the team’s own .lo files as they are', () => {
    const clone = freshClone();
    mkdirSync(join(clone, '.lo'));
    writeFileSync(join(clone, '.lo/overview.md'), '## Required\n\nShort.\n');
    expect(installed(clone).changes.slice(4)).toEqual([
      { path: '.lo/overview.md', state: 'kept' },
      { path: '.lo/settings.json', state: 'written' },
    ]);
    expect(readFileSync(join(clone, '.lo/overview.md'), 'utf8')).toBe('## Required\n\nShort.\n');
  });

  test('makes no link where Codex reads .claude/skills itself', () => {
    for (const before of ['skills first', 'link first']) {
      const clone = freshClone();
      mkdirSync(join(clone, '.agents'));
      if (before === 'skills first') mkdirSync(join(clone, '.claude/skills'), { recursive: true });
      symlinkSync('../.claude/skills', join(clone, '.agents/skills'));
      const ran = installRepo([], clone);
      expect(ran.status).toBe(0);
      expect(ran.stdout).toContain(
        '  .claude/skills/lo-overview/: written\n  .agents/skills: Codex reads the skill through it\n  .claude/settings.json',
      );
      expect(readlinkSync(join(clone, '.agents/skills'))).toBe('../.claude/skills');
      expectSkill(join(clone, '.agents/skills/lo-overview'), 'repo');
      expect(installed(clone).shared).toBe(true);
    }
  });

  test('warns of a person’s own copy under the old name, which runs in place of the clone’s', () => {
    const clone = freshClone();
    const home = freshHome();
    const old = join(home, '.claude/skills/lo-overview');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'SKILL.md'), '---\nname: lo-overview\ndescription: Old.\n---\n');
    const ran = installRepo([], clone, home);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toContain(
      `\n${old}, a copy of your own under the same name, runs in place of the repository's on Claude Code. Run npx @withlo/overview install to replace it with lo-explain.\n`,
    );
    expect(installed(clone, home).shadows).toEqual([{ agent: 'claude', folder: old }]);
  });
});

describe('install --repo, refused', () => {
  /** What's refused, set up in a clone: the start of its message. */
  const cases: [string, (clone: string) => void, string][] = [
    [
      'settings that aren’t JSON',
      (clone) => {
        mkdirSync(join(clone, '.claude'));
        writeFileSync(join(clone, '.claude/settings.json'), '{ // A comment.\n}\n');
      },
      "settings.json isn't JSON Lo can read",
    ],
    [
      'settings that aren’t an object',
      (clone) => {
        mkdirSync(join(clone, '.codex'));
        writeFileSync(join(clone, '.codex/hooks.json'), '[]\n');
      },
      "hooks.json doesn't hold a JSON object",
    ],
    [
      'hooks that aren’t an object',
      (clone) => {
        mkdirSync(join(clone, '.claude'));
        writeFileSync(join(clone, '.claude/settings.json'), '{ "hooks": [] }\n');
      },
      'settings.json\'s "hooks" isn\'t an object',
    ],
    [
      'allowed rules that aren’t a list',
      (clone) => {
        mkdirSync(join(clone, '.claude'));
        writeFileSync(
          join(clone, '.claude/settings.json'),
          '{ "permissions": { "allow": "all" } }\n',
        );
      },
      'settings.json\'s "allow" isn\'t a list',
    ],
    [
      'settings through a link',
      (clone) => {
        mkdirSync(join(clone, '.claude'));
        writeFileSync(join(clone, 'mine.json'), '{}\n');
        symlinkSync('../mine.json', join(clone, '.claude/settings.json'));
      },
      'settings.json is a link',
    ],
    [
      'settings that are a folder',
      (clone) => mkdirSync(join(clone, '.claude/settings.json'), { recursive: true }),
      "settings.json isn't a file",
    ],
    [
      'a folder that leads out of the clone',
      (clone) => symlinkSync(realpathSync(root.dir), join(clone, '.claude')),
      ".claude is a link that doesn't lead to a folder in the clone",
    ],
    [
      'a folder that’s a file',
      (clone) => writeFileSync(join(clone, '.lo'), 'x\n'),
      ".lo isn't a folder",
    ],
    [
      'a folder for Codex that isn’t a link to the skill',
      (clone) => mkdirSync(join(clone, '.agents/skills/lo-overview'), { recursive: true }),
      "lo-overview isn't the link to .claude/skills/lo-overview that Codex reads the skill through",
    ],
    [
      'another skill where the skill goes',
      (clone) => {
        mkdirSync(join(clone, '.claude/skills/lo-overview'), { recursive: true });
        writeFileSync(
          join(clone, '.claude/skills/lo-overview/SKILL.md'),
          '---\nname: review\n---\n',
        );
      },
      'lo-overview holds another skill, "review", so Lo left it alone. Remove it, and install the skill again. Nothing was written.',
    ],
  ];

  test.each(cases)('for %s, and leaves the clone as it was', (_name, setUp, said) => {
    const clone = freshClone();
    setUp(clone);
    const before = snapshot(clone);
    const ran = installRepo([], clone);
    expect(ran.status).toBe(2);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toContain(said);
    expect(ran.stderr).toMatch(/Nothing was written\.\n$/);
    expect(ran.stderr).not.toContain('--dir');
    expect(snapshot(clone)).toEqual(before);
  });

  test('says so as JSON, with --json', () => {
    const clone = freshClone();
    writeFileSync(join(clone, '.lo'), 'x\n');
    const ran = installRepo(['--json'], clone);
    expect(ran.status).toBe(2);
    expect(JSON.parse(ran.stdout)).toEqual({
      error: `${join(clone, '.lo')} isn't a folder, so the skill can't go there. Nothing was written.`,
    });
  });

  test('won’t take the options for a person’s install', () => {
    const clone = freshClone();
    for (const option of ['--claude', '--codex', '--dir']) {
      const ran = installRepo(option === '--dir' ? [option, clone] : [option], clone);
      expect(ran.status).toBe(2);
    }
    expect(Object.keys(snapshot(clone))).toEqual(['README.md']);
  });
});
