/**
 * The skill's `SKILL.md`: the front matter Claude Code and Codex read, for a repository's copy and,
 * from `explain.md`, a person's; links only to what the skill carries; the git commands it runs in a
 * clone of its own; and the checker's commands, which run as it says they do.
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
function run(
  line: string,
  values: Readonly<Record<string, string>>,
  cwd: string,
  env: Readonly<Record<string, string>> = testGitEnvironment(),
): Shell {
  let written = line.replace(NPX, `'${process.execPath}' '${CHECKER}'`);
  written = written.replace(/<([a-z-]+)>/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for ${whole} in ${line}`);
    expect(value).not.toContain("'");
    return value;
  });
  const ran = spawnSync('sh', ['-c', written], { cwd, env, encoding: 'utf8' });
  if (ran.error) throw ran.error;
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

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
      line
        .split(/ *(?:&&|\||;) */)
        .map((part) => part.replace(/^xargs -0 -r /, ''))
        .filter((part) => /^git\b/.test(part)),
    );
    // Only reading the repository it started in, and making its own clone, name no clone.
    const own = "git -C '<work>/clone' ";
    expect(gits.filter((line) => !line.startsWith(own))).toEqual([
      'git rev-parse --path-format=absolute --git-common-dir',
      'git rev-parse --is-shallow-repository',
      'git config --get extensions.partialClone',
      "git config --get-regexp '^remote\\..*\\.promisor$'",
      "git clone --shared --no-checkout --no-tags --quiet '<local>' '<work>/clone'",
      "git init --quiet '<work>/clone'",
      'git config -z --get user.name',
      'git config -z --get user.email',
      'git remote -v',
    ]);
    expect(commands.filter((line) => line.includes('FETCH_HEAD'))).toEqual([]);

    // Every fetch names what it fetches, and where it goes: Lo's refs, or the writer's own.
    const fetches = gits.filter((line) => line.startsWith(`${own}fetch `));
    expect(fetches.length).toBeGreaterThan(5);
    const fetch =
      /^git -C '<work>\/clone' fetch --quiet --no-tags '<(?:url|fork-url)>' '\+([^':]+):((?:refs\/lo|refs\/writer)\/[^']+)'$/;
    expect(fetches.filter((line) => !fetch.test(line))).toEqual([]);
    // No block fetches into one ref twice: a fork's copy, fetched only when the base repository has
    // none, has a block of its own.
    const blocks = [...text.matchAll(/^ *```sh\n([\s\S]*?)^ *```$/gm)].map((match) => match[1]!);
    const twice = blocks.filter((block) => {
      const into = [...block.matchAll(/ fetch .*:([^':]+)'$/gm)].map((match) => match[1]);
      return new Set(into).size < into.length;
    });
    expect(twice).toEqual([]);

    // Every push is of one commit to one of Lo's refs, never forced.
    const pushes = gits.filter((line) => line.includes(' push '));
    expect(pushes.length).toBe(4);
    const push =
      /^git -C '<work>\/clone' push --no-follow-tags '<(?:url|fork-url)>' '<(id|stack-id)>:refs\/lo\/(pr\/<n>|stack\/<stack>)'$/;
    expect(pushes.filter((line) => !push.test(line))).toEqual([]);
    expect(text).toContain(
      "git -C '<work>/clone' push --no-follow-tags '<url>' '<id>:refs/lo/pr/<n>'\n",
    );
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
    const repo = join(root.dir, 'pinned-repo');
    mkdirSync(repo);
    repositoryOf(repo, { 'a.txt': 'a\n' });
    expect(runChecker(['install', '--repo', repo], root.dir).status).toBe(0);
    for (const path of [join(skills, 'lo-explain'), join(repo, '.claude/skills/lo-overview')]) {
      const shipped = readFileSync(join(path, 'SKILL.md'), 'utf8');
      expect(shipped).not.toContain('{version}');
      expect(shipped).not.toContain('@latest');
      expect(shipped.split(`${manifest.name}@${manifest.version} `)).toHaveLength(runs + 1);
    }
  });
});

/** Git as the person runs it: their identity from the clone's config, and tags pushed along. */
function asThePerson(): Record<string, string> {
  const env = testGitEnvironment();
  for (const name of Object.keys(env)) {
    if (/^(GIT_(AUTHOR|COMMITTER)_|EMAIL$)/.test(name)) delete env[name];
  }
  const count = Number(env.GIT_CONFIG_COUNT ?? '0');
  env[`GIT_CONFIG_KEY_${count}`] = 'push.followTags';
  env[`GIT_CONFIG_VALUE_${count}`] = 'true';
  env.GIT_CONFIG_COUNT = String(count + 1);
  return env;
}

describe('its git commands, run as written', () => {
  /**
   * A repository on "GitHub": its default branch, a lower layer's branch, a pull request's head on
   * it, the pull request's overview and the repository's definitions.
   */
  let remote: string;
  /** The clone the writer starts in, with an identity of its own and a tag the remote lacks. */
  let local: string;
  let main: string;
  let head: string;
  /** The overview the pull request has, which a writer starts from. */
  let theirs: string;

  beforeAll(() => {
    const seed = join(root.dir, 'seed');
    mkdirSync(seed);
    main = repositoryOf(seed, {
      'src/a.ts': 'one\n',
      '.lo/overview.md': '## Required\n\nThe default branch’s.\n',
    });
    writeFileSync(join(seed, '.lo/overview.md'), '## Required\n\nThe lower layer’s.\n');
    git(seed, 'commit', '-q', '-am', 'Lower');
    const lower = git(seed, 'rev-parse', 'HEAD');
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
    const tree = (name: string, content: string): string => {
      writeFileSync(join(seed, name), content);
      const blob = git(seed, 'hash-object', '-w', name);
      return gitBytes(seed, ['mktree'], `100644 blob ${blob}\t${name}\n`).toString('utf8').trim();
    };
    const terms = git(
      seed,
      'commit-tree',
      '-m',
      'Definitions',
      tree('terms.json', JSON.stringify(store)),
    );
    // An overview whose parent is the default branch's commit, which the writer's clone has tagged.
    theirs = git(
      seed,
      'commit-tree',
      '-p',
      main,
      '-m',
      'Overview',
      tree('artifact.md', overview(lower)),
    );

    remote = join(root.dir, 'remote.git');
    git(root.dir, 'init', '-q', '--bare', '--object-format=sha1', remote);
    git(seed, 'push', '-q', remote, `${main}:refs/heads/main`, `${lower}:refs/heads/lower`);
    git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    git(seed, 'push', '-q', remote, `${head}:refs/pull/4797/head`, `${terms}:refs/lo/terms`);
    git(seed, 'push', '-q', remote, `${theirs}:refs/lo/pr/4797`);
    git(remote, 'config', 'uploadpack.allowFilter', 'true');

    local = join(root.dir, 'local');
    git(root.dir, 'clone', '-q', remote, local);
    git(local, 'config', 'user.name', "Ann O'Hara");
    git(local, 'config', 'user.email', 'ann@lo.invalid');
    git(local, 'tag', '-a', '-m', 'Kept here', 'kept', main);
  });

  test('read the pull request, its instructions and the definitions, and push its overview', () => {
    const work = mkdtempSync(join(root.dir, 'work-'));
    const values: Record<string, string> = {
      work,
      url: remote,
      n: '4797',
      base: 'lower',
      commit: head,
      stack: '4790',
    };
    const env = asThePerson();
    const refsBefore = git(local, 'for-each-ref');
    const ok = (line: string, cwd = work): string => {
      const ran = run(line, values, cwd, env);
      if (ran.status !== 0) throw new Error(`${line} exited ${ran.status}: ${ran.stderr}`);
      return ran.stdout.trim();
    };
    const fails = (line: string, cwd = work): Shell => {
      const ran = run(line, values, cwd, env);
      expect(ran.status).not.toBe(0);
      return ran;
    };

    ok(command("mkdir '<work>/overview' '<work>/tools'"));
    values.local = ok(command('--git-common-dir'), local);
    expect(ok(command('--is-shallow-repository'), local)).toBe('false');
    expect(fails(command('extensions.partialClone'), local).stdout).toBe('');
    expect(fails(command('promisor'), local).stdout).toBe('');
    ok(command('clone --shared'));
    // It borrows the objects of the clone it started in, and none of its tags.
    expect(readFileSync(join(work, 'clone/.git/objects/info/alternates'), 'utf8').trim()).toBe(
      join(values.local, 'objects'),
    );
    expect(git(join(work, 'clone'), 'tag', '--list')).toBe('');
    // Were a tag there, no push would send it.
    git(join(work, 'clone'), 'tag', '-a', '-m', 'Made here', 'made', main);

    // It commits as the clone it started in does.
    ok(command('--get user.name'), local);
    ok(command('--get user.email'), local);
    ok(command('user.useConfigOnly'));
    expect(ok(command('var GIT_AUTHOR_IDENT'))).toMatch(/^Ann O'Hara <ann@lo\.invalid> \d+ /);

    ok(command('refs/pull/<n>/head:refs/writer/head'));
    expect(ok(command("rev-parse 'refs/writer/head'"))).toBe(head);
    ok(command('refs/heads/<base>:refs/writer/base'));
    // The default branch's instructions, never the pull request's or the layer's below it.
    ok(command('+HEAD:refs/writer/default'));
    expect(ok(command('refs/writer/default:.lo/overview.md'))).toContain('The default branch’s.');

    ok(command('+refs/lo/terms:refs/lo/terms'));
    ok(command("'refs/lo/terms:terms.json'"));
    ok(command('node -e'));
    expect(readFileSync(join(work, 'terms.txt'), 'utf8')).toBe(
      'Bucket\tbuckets\tThe tokens a tenant has to spend.\n',
    );

    // The pull request's overview, to start from.
    ok(command("fetch --quiet --no-tags '<url>' '+refs/lo/pr/<n>:refs/lo/pr/<n>'"));
    expect(ok(command("ls-tree -r --name-only 'refs/lo/pr/<n>'"))).toBe('artifact.md');
    ok(command("'refs/lo/pr/<n>:artifact.md' > '<work>/overview/artifact.md'"));
    // The stack has no overview yet.
    const none = fails(
      command("fetch --quiet --no-tags '<url>' '+refs/lo/stack/<stack>:refs/lo/stack/<stack>'"),
    );
    expect(none.stderr).toContain("couldn't find remote ref");

    writeFileSync(
      join(work, 'overview/artifact.md'),
      `${header(head)}\n## tl;dr\n\nEach [bucket](term:bucket) holds a [token](term:token).\n\n## Glossary\n\n- **Bucket**: The tokens a tenant has to spend.\n- **Token** (new): What a request spends to go through.\n`,
    );
    ok(command(`check '<work>/overview'`));
    const committed = ok(command(`commit '<work>/overview'`));
    values.id = /Committed the overview as ([0-9a-f]{40})/.exec(committed)?.[1] ?? '';
    ok(command("push --no-follow-tags '<url>' '<id>:refs/lo/pr/<n>'"));
    expect(ok(command("ls-remote '<url>' 'refs/lo/pr/<n>'"))).toBe(`${values.id}\trefs/lo/pr/4797`);

    // The remote's overview moved on from theirs, by the person, and it gained no other ref: no tag,
    // though the overview's history reaches the tags of both clones.
    expect(git(remote, 'log', '-1', '--format=%P %an <%ae>', 'refs/lo/pr/4797')).toBe(
      `${theirs} Ann O'Hara <ann@lo.invalid>`,
    );
    expect(git(remote, 'for-each-ref', '--format=%(refname)').split('\n')).toEqual([
      'refs/heads/lower',
      'refs/heads/main',
      'refs/lo/pr/4797',
      'refs/lo/terms',
      'refs/pull/4797/head',
    ]);
    // The clone it started in is as it was.
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

  test('tell a shallow or partial clone, which it makes no clone from', () => {
    const shallow = join(root.dir, 'shallow');
    git(root.dir, 'clone', '-q', '--depth', '1', `file://${remote}`, shallow);
    expect(run(command('--is-shallow-repository'), {}, shallow).stdout.trim()).toBe('true');

    const partial = join(root.dir, 'partial');
    git(root.dir, 'clone', '-q', '--filter=blob:none', `file://${remote}`, partial);
    const promisor = run(command('promisor'), {}, partial);
    expect(promisor.status).toBe(0);
    expect(promisor.stdout).not.toBe('');
  });

  test('stop when the clone it started in has no email address for its commits', () => {
    const work = mkdtempSync(join(root.dir, 'work-'));
    const values = { work };
    const env = asThePerson();
    expect(run(command('git init'), values, work, env).status).toBe(0);
    expect(run(command('--get user.email'), values, work, env)).toMatchObject({ stdout: '' });
    expect(run(command('user.useConfigOnly'), values, work, env).status).toBe(0);
    expect(run(command('var GIT_AUTHOR_IDENT'), values, work, env).status).not.toBe(0);
  });

  test('delete the handoff file, and its folder only when nothing else is in it', () => {
    const alone = mkdtempSync(join(root.dir, 'handoff-'));
    writeFileSync(join(alone, 'handoff.md'), 'Brief\n');
    for (const line of [command("rm -f '<handoff-folder>/handoff.md'"), command('rmdir')]) {
      expect(run(line, { 'handoff-folder': alone }, root.dir).status).toBe(0);
    }
    expect(existsSync(alone)).toBe(false);

    const shared = mkdtempSync(join(root.dir, 'handoff-'));
    writeFileSync(join(shared, 'handoff.md'), 'Brief\n');
    writeFileSync(join(shared, 'notes.md'), 'Not the skill’s\n');
    run(command("rm -f '<handoff-folder>/handoff.md'"), { 'handoff-folder': shared }, root.dir);
    expect(run(command('rmdir'), { 'handoff-folder': shared }, root.dir).status).not.toBe(0);
    expect(readFileSync(join(shared, 'notes.md'), 'utf8')).toBe('Not the skill’s\n');
  });
});
