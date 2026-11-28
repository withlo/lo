/**
 * The skill's `SKILL.md`: the front matter Claude Code and Codex read, for a repository's copy and,
 * from `explain.md`, a person's; links only to what the skill carries; and the checker's commands,
 * which run as it says they do.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  MANIFEST as manifest,
  overview,
  repositoryOf,
  runChecker,
  scratch,
  SKILL,
  skillFiles,
  splitMatter,
} from './support.ts';

const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
const explain = readFileSync(join(SKILL, 'explain.md'), 'utf8');

/**
 * The keys of the front matter `matter` names, each with its value, in order: a value may go on over
 * indented lines, as YAML allows, joined by spaces. Throws on a line that's neither.
 */
function keysOf(matter: string): [string, string][] {
  const lines = matter.split('\n').slice(1, -2);
  const keys: [string, string][] = [];
  for (const line of lines) {
    const key = /^([a-z][a-z-]*):(.*)$/.exec(line);
    if (key) keys.push([key[1]!, key[2]!.trim()]);
    else if (line.startsWith('  ') && keys.length > 0) {
      const last = keys.at(-1)!;
      last[1] = `${last[1]} ${line.trim()}`.trim();
    } else throw new Error(`A line front matter doesn't take: ${JSON.stringify(line)}`);
  }
  return keys;
}

/** What a description must be for every reader of skills: long enough, short enough, no tags. */
function expectDescription(description: string): void {
  expect(description.length).toBeGreaterThan(100);
  expect(description.length).toBeLessThanOrEqual(1024);
  // Nothing like a tag, which some readers of skills refuse.
  expect(description).not.toMatch(/[<>]/);
}

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('skill');
});

afterAll(() => root.remove());

describe('SKILL.md', () => {
  test('starts with a repository’s front matter: its name, when to start it, and how it runs', () => {
    const keys = keysOf(splitMatter(text).matter);
    expect(keys.map(([key]) => key)).toEqual(['name', 'description', 'argument-hint', 'context']);
    const matter = Object.fromEntries(keys);
    expect(matter.name).toBe('lo-overview');
    expectDescription(matter.description!);
    // An agent starts it by itself after it opens or pushes to a pull request, unless it's off.
    expect(matter.description).toMatch(
      /\bafter you open a pull request or push commits to an open one\b/,
    );
    expect(matter.description).toContain('overview.auto');
    expect(matter.description).toContain('spawn_agent');
    // In a subagent of its own, in the background, on Claude Code.
    expect(matter.context).toBe('fork');
    // Allowed nothing without asking: no rule could take in what it runs and nothing more.
    expect(matter['allowed-tools']).toBeUndefined();
  });

  test('has a person’s front matter in explain.md, which never starts by itself', () => {
    const { matter, body } = splitMatter(explain);
    expect(body).toBe('');
    const keys = keysOf(matter);
    expect(keys.map(([key]) => key)).toEqual(['name', 'description']);
    const { name, description = '' } = Object.fromEntries(keys);
    expect(name).toBe('lo-explain');
    expectDescription(description);
    expect(description).toMatch(/\bonly when asked\b/);
    expect(description).toMatch(/\bNever start it by yourself\b/);
  });

  test('links only to the references the skill carries', () => {
    // Outside code, where links are only examples.
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const links = [...prose.matchAll(/\]\(([^)]*)\)/g)].map((match) => match[1]!);
    expect(links.toSorted()).toEqual(['references/figures.md', 'references/format.md']);
    for (const link of links) expect(skillFiles()).toContain(link);
  });

  test('single-quotes every value its commands take, and never uses double quotes', () => {
    const lines = [...text.matchAll(/^ *```sh\n([\s\S]*?)^ *```$/gm)].flatMap((match) =>
      match[1]!.split('\n').filter((line) => line.trim() !== ''),
    );
    expect(lines.length).toBeGreaterThan(20);
    const unquoted = lines.filter((line) => /<[^>]*>|"/.test(line.replace(/'[^']*'/g, '')));
    expect(unquoted).toEqual([]);
  });

  test('runs this package’s checker from a folder of its own, and its commands work as it says', () => {
    const repo = join(root.dir, 'repo');
    mkdirSync(repo);
    const commit = repositoryOf(repo, { 'src/a.ts': 'one\n' });
    const dir = join(root.dir, 'overview');
    mkdirSync(dir);
    writeFileSync(join(dir, 'artifact.md'), overview(commit, ':::code src/a.ts#L1\n:::\n'));
    const tools = join(root.dir, 'tools');
    mkdirSync(tools);

    // Every npx runs from <tools>, with it as npm's prefix, so nothing in the clone counts.
    const npx = splitMatter(text)
      .body.split('\n')
      .filter((line) => /\bnpx\b/.test(line) && line.includes('--'));
    const shape = /^\(cd '<tools>' && npx --prefix '<tools>' --yes (\S+) (.+)\)$/;
    expect(npx.length).toBe(2);
    expect(npx.filter((line) => !shape.test(line))).toEqual([]);
    const values: Record<string, string> = { '<dir>': dir, '<n>': '4797', '<clone>': repo };
    const commands = npx.map((line) => {
      const [, spec, rest] = shape.exec(line) ?? [];
      const args = (rest ?? '').split(' ').map((arg) => arg.replace(/^'(.*)'$/, '$1'));
      return { spec, args: args.map((arg) => values[arg] ?? arg) };
    });
    expect(commands.map(({ spec, args }) => `${spec} ${args[0]}`)).toEqual([
      `${manifest.name}@{version} check`,
      `${manifest.name}@{version} commit`,
    ]);
    const [check, commitIt] = commands.map(({ args }) => runChecker(args, tools));
    expect(check).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
    expect(commitIt?.status).toBe(0);
    const id = /Committed the overview as ([0-9a-f]{40})/.exec(commitIt?.stdout ?? '')?.[1];
    expect(commitIt?.stdout).toContain(`git push <remote> ${id}:refs/lo/pr/4797\n`);
    expect(text).toContain("git push '<remote>' '<id>:refs/lo/pr/<n>'\n");
  });

  test('runs the checker it was installed with, by its exact version', () => {
    // In the source, the checker is named only with the placeholder for its version.
    const named = text.match(new RegExp(`${manifest.name}@\\S*`, 'g')) ?? [];
    expect(named.length).toBeGreaterThan(1);
    expect(named.every((each) => each === `${manifest.name}@{version}`)).toBe(true);
    expect(text.match(/\{version\}/g)).toHaveLength(named.length);

    const skills = join(root.dir, 'pinned');
    expect(runChecker(['install', '--dir', skills], root.dir).status).toBe(0);
    const repo = join(root.dir, 'pinned-repo');
    mkdirSync(repo);
    repositoryOf(repo, { 'a.txt': 'a\n' });
    expect(runChecker(['install', '--repo', repo], root.dir).status).toBe(0);
    for (const path of [join(skills, 'lo-explain'), join(repo, '.claude/skills/lo-overview')]) {
      const shipped = readFileSync(join(path, 'SKILL.md'), 'utf8');
      expect(shipped).not.toContain('{version}');
      expect(shipped).not.toContain('@latest');
      const pinned = shipped.match(new RegExp(`${manifest.name}@\\S*`, 'g')) ?? [];
      expect(pinned.length).toBe(named.length);
      expect(pinned.every((each) => each === `${manifest.name}@${manifest.version}`)).toBe(true);
    }
  });
});
