/**
 * The skill's `SKILL.md`: the front matter Claude Code and Codex read, links only to what the skill
 * carries, and the checker's commands, which run as it says they do.
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
} from './support.ts';

const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');

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
    const npx = text.split('\n').filter((line) => /\bnpx\b/.test(line) && line.includes('--'));
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
    // In the source, only the checker's two commands name a version, and by the placeholder.
    expect(text.match(/\{version\}/g)).toHaveLength(2);
    expect(text.split(`${manifest.name}@{version} `)).toHaveLength(3);

    const skills = join(root.dir, 'pinned');
    expect(runChecker(['install', '--dir', skills], root.dir).status).toBe(0);
    const shipped = readFileSync(join(skills, 'lo-overview', 'SKILL.md'), 'utf8');
    expect(shipped).not.toContain('{version}');
    expect(shipped).not.toContain('@latest');
    expect(shipped.split(`${manifest.name}@${manifest.version} `)).toHaveLength(3);
  });
});
