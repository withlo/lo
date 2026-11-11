/**
 * The skill's `SKILL.md`: the front matter Claude Code and Codex read, links only to what the skill
 * carries, and the checker's commands, which run as it says they do.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { overview, repositoryOf, runChecker, scratch, SKILL, skillFiles } from './support.ts';

const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
const manifest: { name: string } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('skill');
});

afterAll(() => root.remove());

describe('SKILL.md', () => {
  test('starts with front matter giving the skill’s name, and when to use it', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    const matter = lines.slice(1, lines.indexOf('---', 1));
    expect(matter[0]).toBe('name: lo-overview');
    expect(matter[1]).toMatch(/^description:/);
    // The description may go on over indented lines, as YAML allows. Nothing else is there.
    const rest = matter.slice(2);
    expect(rest.every((line) => line.startsWith('  '))).toBe(true);
    const description = [matter[1]!.slice('description:'.length), ...rest]
      .map((line) => line.trim())
      .join(' ')
      .trim();
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThanOrEqual(1024);
    // Nothing like a tag, which some readers of skills refuse.
    expect(description).not.toMatch(/[<>]/);
  });

  test('links only to the references the skill carries', () => {
    // Outside code, where links are only examples.
    const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const links = [...prose.matchAll(/\]\(([^)]*)\)/g)].map((match) => match[1]!);
    expect(links.toSorted()).toEqual(['references/figures.md', 'references/format.md']);
    for (const link of links) expect(skillFiles()).toContain(link);
  });

  test('runs this package’s checker, whose commands work as it says', () => {
    const repo = join(root.dir, 'repo');
    mkdirSync(repo);
    const commit = repositoryOf(repo, { 'src/a.ts': 'one\n' });
    const dir = join(root.dir, 'overview');
    mkdirSync(dir);
    writeFileSync(join(dir, 'artifact.md'), overview(commit, ':::code src/a.ts#L1\n:::\n'));

    const commands = [...text.matchAll(/^npx --yes (\S+) (.+)$/gm)].map((match) => ({
      spec: match[1],
      args: match[2]!.split(' ').map((arg) => ({ '<dir>': dir, '<n>': '4797' })[arg] ?? arg),
    }));
    expect(commands.map(({ spec, args }) => `${spec} ${args[0]}`)).toEqual([
      `${manifest.name}@latest check`,
      `${manifest.name}@latest commit`,
    ]);
    const [check, commitIt] = commands.map(({ args }) => runChecker(args, repo));
    expect(check).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
    expect(commitIt?.status).toBe(0);
    const id = /Committed the overview as ([0-9a-f]{40})/.exec(commitIt?.stdout ?? '')?.[1];
    expect(commitIt?.stdout).toContain(`git push <remote> ${id}:refs/lo/pr/4797\n`);
    expect(text).toContain('git push <remote> <id>:refs/lo/pr/<n>\n');
  });
});
