/**
 * The skill's `SKILL.md`: the front matter Claude Code and Codex read, links only to what the skill
 * carries, the git commands it runs in a clone of its own, and the checker's commands, which run as
 * it says they do.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { git, gitBytes, testGitEnvironment } from '@lo/testing/git';

import {
  CHECKER,
  header,
  MANIFEST as manifest,
  overview,
  repositoryOf,
  runChecker,
  scratch,
  SKILL,
  skillFiles,
} from './support.ts';

const text = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');

/** Every line of SKILL.md's `sh` blocks, trimmed, in order. */
const commands = [...text.matchAll(/^ *```sh\n([\s\S]*?)^ *```$/gm)].flatMap((match) =>
  match[1]!
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== ''),
);

/** The checker as SKILL.md runs it, from `<work>/tools`. */
const NPX = "npx --prefix '<work>/tools' --yes @withlo/overview@{version}";

let root: ReturnType<typeof scratch>;

beforeAll(() => {
  root = scratch('skill');
});

afterAll(() => root.remove());

/** The one command of SKILL.md that holds `part`. */
function command(part: string): string {
  const found = commands.filter((line) => line.includes(part));
  if (found.length !== 1) throw new Error(`${found.length} commands hold ${part}`);
  return found[0]!;
}

/** What running a command did. */
interface Shell {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `line`, one of SKILL.md's commands, in `cwd` with `sh`, each `<name>` in it replaced by
 * `values[name]` and the checker run from this package's build, with git as the tests run it.
 */
function run(line: string, values: Readonly<Record<string, string>>, cwd: string): Shell {
  let written = line.replace(NPX, `'${process.execPath}' '${CHECKER}'`);
  written = written.replace(/<([a-z-]+)>/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for ${whole} in ${line}`);
    expect(value).not.toContain("'");
    return value;
  });
  const ran = spawnSync('sh', ['-c', written], {
    cwd,
    env: testGitEnvironment(),
    encoding: 'utf8',
  });
  if (ran.error) throw ran.error;
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

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
    expect(links.toSorted()).toEqual([
      'references/figures.md',
      'references/format.md',
      'references/writing.md',
    ]);
    for (const link of links) expect(skillFiles()).toContain(link);
  });

  test('single-quotes every value its commands take, and never uses double quotes', () => {
    expect(commands.length).toBeGreaterThan(40);
    const unquoted = commands.filter((line) => /<[^>]*>|"/.test(line.replace(/'[^']*'/g, '')));
    expect(unquoted).toEqual([]);
  });

  test('runs git in a clone of its own, fetching into refs of its own, and never forces a push', () => {
    const gits = commands.flatMap((line) =>
      line.split(/ *(?:&&|\||;) */).filter((part) => /^git\b/.test(part)),
    );
    // Only finding the repository it started in, and making its own clone, name no clone.
    const own = "git -C '<work>/clone' ";
    expect(gits.filter((line) => !line.startsWith(own))).toEqual([
      'git rev-parse --path-format=absolute --git-common-dir',
      'git config --get extensions.partialClone',
      "git clone --shared --no-checkout --quiet '<local>' '<work>/clone'",
      "git init --quiet '<work>/clone'",
      'git remote -v',
    ]);
    expect(commands.filter((line) => line.includes('FETCH_HEAD'))).toEqual([]);

    // Every fetch names what it fetches, and where it goes: Lo's refs, or the writer's own.
    const fetches = gits.filter((line) => line.startsWith(`${own}fetch `));
    expect(fetches.length).toBeGreaterThan(5);
    const fetch =
      /^git -C '<work>\/clone' fetch --quiet '<(?:url|fork-url)>' '\+([^':]+):((?:refs\/lo|refs\/writer)\/[^']+)'$/;
    expect(fetches.filter((line) => !fetch.test(line))).toEqual([]);

    // Every push is of one commit to one of Lo's refs, never forced.
    const pushes = gits.filter((line) => line.includes(' push '));
    expect(pushes.length).toBe(4);
    const push =
      /^git -C '<work>\/clone' push '<(?:url|fork-url)>' '<(id|stack-id)>:refs\/lo\/(pr\/<n>|stack\/<stack>)'$/;
    expect(pushes.filter((line) => !push.test(line))).toEqual([]);
    expect(text).toContain("git -C '<work>/clone' push '<url>' '<id>:refs/lo/pr/<n>'\n");
  });

  test('runs this package’s checker from a folder of its own, and its commands work as it says', () => {
    const repo = join(root.dir, 'repo');
    mkdirSync(repo);
    const commit = repositoryOf(repo, { 'src/a.ts': 'one\n' });
    const dir = join(root.dir, 'overview');
    mkdirSync(dir);
    writeFileSync(join(dir, 'artifact.md'), overview(commit, ':::code src/a.ts#L1\n:::\n'));
    const stack = join(root.dir, 'stack');
    mkdirSync(stack);
    const stackHeader = `---\nformat: 1\nstack: 4790\ncommit: ${commit}\n---\n`;
    writeFileSync(join(stack, 'artifact.md'), `${stackHeader}\n## tl;dr\n\nIt does things.\n`);
    const work = join(root.dir, 'work');
    mkdirSync(join(work, 'tools'), { recursive: true });

    // Every npx runs from <work>/tools, with it as npm's prefix, so nothing in a clone counts.
    const npx = commands.filter((line) => /\bnpx\b/.test(line));
    const shape = /^\(cd '<work>\/tools' && npx --prefix '<work>\/tools' --yes (\S+) (.+)\)$/;
    expect(npx.filter((line) => !shape.test(line))).toEqual([]);
    const values: Record<string, string> = {
      "'<work>/overview'": dir,
      "'<work>/stack'": stack,
      "'<work>/clone'": repo,
      "'<work>'": work,
      "'<n>'": '4797',
      "'<stack>'": '4790',
    };
    const said = npx.map((line) => {
      const [, spec, rest] = shape.exec(line) ?? [];
      const args = (rest ?? '').split(' ').map((arg) => values[arg] ?? arg);
      return { spec, args };
    });
    expect(said.map(({ spec, args }) => `${spec} ${args.join(' ')}`)).toEqual([
      `${manifest.name}@{version} transcript --out ${work}`,
      `${manifest.name}@{version} check ${dir} --pr 4797 --repo ${repo}`,
      `${manifest.name}@{version} commit ${dir} --pr 4797 --repo ${repo}`,
      `${manifest.name}@{version} check ${stack} --stack 4790 --repo ${repo}`,
      `${manifest.name}@{version} commit ${stack} --stack 4790 --repo ${repo}`,
    ]);

    // The transcript copy needs an agent's session, so only the checks and commits run here.
    const [checkPull, commitPull, checkStack, commitStack] = said
      .slice(1)
      .map(({ args }) => runChecker(args, join(work, 'tools')));
    for (const check of [checkPull, checkStack]) {
      expect(check).toEqual({ status: 0, stdout: 'No errors or warnings.\n', stderr: '' });
    }
    expect(commitPull?.status).toBe(0);
    const id = /Committed the overview as ([0-9a-f]{40})/.exec(commitPull?.stdout ?? '')?.[1];
    expect(commitPull?.stdout).toContain(`git push <remote> ${id}:refs/lo/pr/4797\n`);
    expect(commitStack?.status).toBe(0);
    const stackId = /Committed the overview as ([0-9a-f]{40})/.exec(commitStack?.stdout ?? '')?.[1];
    expect(commitStack?.stdout).toContain(`git push <remote> ${stackId}:refs/lo/stack/4790\n`);
  });

  test('runs the checker it was installed with, by its exact version', () => {
    // In the source, only the checker's commands name a version, and by the placeholder.
    const runs = commands.filter((line) => /\bnpx\b/.test(line)).length;
    expect(runs).toBe(5);
    expect(text.match(/\{version\}/g)).toHaveLength(runs);
    expect(text.split(`${manifest.name}@{version} `)).toHaveLength(runs + 1);

    const skills = join(root.dir, 'pinned');
    expect(runChecker(['install', '--dir', skills], root.dir).status).toBe(0);
    const shipped = readFileSync(join(skills, 'lo-overview', 'SKILL.md'), 'utf8');
    expect(shipped).not.toContain('{version}');
    expect(shipped).not.toContain('@latest');
    expect(shipped.split(`${manifest.name}@${manifest.version} `)).toHaveLength(runs + 1);
  });
});

describe('its git commands, run as written', () => {
  /** A repository on "GitHub": a base branch, a pull request's head, and its definitions. */
  let remote: string;
  /** The clone the writer starts in, on the base branch. */
  let local: string;
  let base: string;
  let head: string;

  beforeAll(() => {
    const seed = join(root.dir, 'seed');
    mkdirSync(seed);
    base = repositoryOf(seed, {
      'src/a.ts': 'one\n',
      '.lo/overview.md': '## Required\n\nThe base branch’s.\n',
    });
    writeFileSync(join(seed, 'src/a.ts'), 'one\ntwo\n');
    writeFileSync(join(seed, '.lo/overview.md'), '## Required\n\nThe pull request’s.\n');
    git(seed, 'commit', '-q', '-am', 'Change');
    head = git(seed, 'rev-parse', 'HEAD');
    const store = {
      format: 1,
      terms: {
        bucket: {
          term: 'Bucket',
          definition: 'The tokens a tenant has to spend.',
          aliases: ['buckets'],
          written: 'agent',
          by: { login: 'octocat' },
          from: '#4790',
          at: '2026-11-27T10:30:00Z',
        },
      },
    };
    writeFileSync(join(seed, 'terms.json'), JSON.stringify(store));
    const blob = git(seed, 'hash-object', '-w', 'terms.json');
    const tree = gitBytes(seed, ['mktree'], `100644 blob ${blob}\tterms.json\n`);
    const terms = git(seed, 'commit-tree', '-m', 'Definitions', tree.toString('utf8').trim());
    remote = join(root.dir, 'remote.git');
    git(root.dir, 'init', '-q', '--bare', '--object-format=sha1', remote);
    git(seed, 'push', '-q', remote, `${base}:refs/heads/main`);
    git(seed, 'push', '-q', remote, `${head}:refs/pull/4797/head`);
    git(seed, 'push', '-q', remote, `${terms}:refs/lo/terms`);
    local = join(root.dir, 'local');
    git(root.dir, 'clone', '-q', remote, local);
  });

  test('read the pull request, its instructions and the definitions, and push its overview', () => {
    const work = mkdtempSync(join(root.dir, 'work-'));
    const values: Record<string, string> = {
      work,
      url: remote,
      n: '4797',
      base: 'main',
      commit: head,
    };
    const refsBefore = git(local, 'for-each-ref');
    const ok = (line: string, cwd = work): string => {
      const ran = run(line, values, cwd);
      if (ran.status !== 0) throw new Error(`${line} exited ${ran.status}: ${ran.stderr}`);
      return ran.stdout.trim();
    };

    ok(command("mkdir '<work>/overview' '<work>/tools'"));
    values.local = ok(command('--git-common-dir'), local);
    expect(run(command('extensions.partialClone'), values, local)).toMatchObject({
      status: 1,
      stdout: '',
    });
    ok(command('clone --shared'));
    // It borrows the objects of the clone it started in.
    expect(readFileSync(join(work, 'clone/.git/objects/info/alternates'), 'utf8').trim()).toBe(
      join(values.local, 'objects'),
    );

    ok(command('refs/pull/<n>/head:refs/writer/head'));
    expect(ok(command("rev-parse 'refs/writer/head'"))).toBe(head);
    ok(command('refs/heads/<base>:refs/writer/base'));
    // The base branch's instructions, never the pull request's.
    expect(ok(command('refs/writer/base:.lo/overview.md'))).toContain('The base branch’s.');

    ok(command('+refs/lo/terms:refs/lo/terms'));
    ok(command("'refs/lo/terms:terms.json'"));
    ok(command('node -e'));
    expect(readFileSync(join(work, 'terms.txt'), 'utf8')).toBe(
      'Bucket\tbuckets\tThe tokens a tenant has to spend.\n',
    );

    // There's no overview yet, in the base repository or a fork.
    const none = run(
      command("fetch --quiet '<url>' '+refs/lo/pr/<n>:refs/lo/pr/<n>'"),
      values,
      work,
    );
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain("couldn't find remote ref");

    writeFileSync(
      join(work, 'overview/artifact.md'),
      `${header(head)}\n## tl;dr\n\nEach [bucket](term:bucket) holds a [token](term:token).\n\n## Glossary\n\n- **Bucket**: The tokens a tenant has to spend.\n- **Token** (new): What a request spends to go through.\n`,
    );
    ok(command(`check '<work>/overview'`));
    const committed = ok(command(`commit '<work>/overview'`));
    values.id = /Committed the overview as ([0-9a-f]{40})/.exec(committed)?.[1] ?? '';
    ok(command("push '<url>' '<id>:refs/lo/pr/<n>'"));
    expect(ok(command("ls-remote '<url>' 'refs/lo/pr/<n>'"))).toBe(`${values.id}\trefs/lo/pr/4797`);

    // The remote gained the overview's ref and nothing else; the clone it started in is as it was.
    expect(git(remote, 'for-each-ref', '--format=%(refname)').split('\n')).toEqual([
      'refs/heads/main',
      'refs/lo/pr/4797',
      'refs/lo/terms',
      'refs/pull/4797/head',
    ]);
    expect(git(local, 'for-each-ref')).toBe(refsBefore);
    expect(existsSync(join(local, '.git/FETCH_HEAD'))).toBe(false);

    ok(command("rm -rf '<work>'"), root.dir);
    expect(existsSync(work)).toBe(false);
  });

  test('make an empty clone when the folder it starts in isn’t a repository', () => {
    const work = mkdtempSync(join(root.dir, 'work-'));
    const nowhere = mkdtempSync(join(root.dir, 'nowhere-'));
    const values = { work, url: remote, n: '4797' };
    expect(run(command('--git-common-dir'), values, nowhere).status).not.toBe(0);
    expect(run(command('git init'), values, work).status).toBe(0);
    expect(run(command('refs/pull/<n>/head:refs/writer/head'), values, work).status).toBe(0);
    expect(run(command("rev-parse 'refs/writer/head'"), values, work).stdout.trim()).toBe(head);
  });
});
