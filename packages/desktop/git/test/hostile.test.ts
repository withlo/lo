// git run from inside an environment where every variable that could change what git reads, runs
// or fetches is set to something that would show, against repositories that try the same from
// their own files.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, gitProgram } from '@lo/testing/git';
import { expect, test } from 'vitest';

import { GITHUB } from '../src/environment.ts';
import { gitAt } from '../src/find.ts';
import { type Location, Runner } from '../src/git.ts';
import { failureOf, script, tempFolder } from './support.ts';

/** The URL rewrite a hostile config applies: every `file://` URL goes nowhere. */
const REWRITE = '[url "file:///nowhere/"]\n\tinsteadOf = file://\n';

interface Hostile {
  dir: string;
  /** The remote's URL. */
  url: string;
  /**
   * A working copy, with `first` and `second` commits on `trunk`. Both have a `.gitattributes`
   * saying `*.txt -diff`, and `second` changes `a.txt`. Replace refs make `first` read as `second`.
   */
  work: string;
  first: string;
  markers: string;
  /** Lo's own `HOME` for git. */
  home: string;
  env: Record<string, string>;
}

function hostile(): Hostile {
  const dir = tempFolder();
  const work = join(dir, 'work');
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'trunk');
  writeFileSync(join(work, 'a.txt'), 'a\n');
  writeFileSync(join(work, '.gitattributes'), '*.txt -diff\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  const first = git(work, 'rev-parse', 'HEAD');
  writeFileSync(join(work, 'a.txt'), 'b\n');
  git(work, 'commit', '-q', '-am', 'second');
  const second = git(work, 'rev-parse', 'HEAD');
  git(dir, 'clone', '-q', '--bare', 'work', 'remote.git');
  // Replace refs that would make `first` read as `second`.
  git(work, 'replace', first, second);
  git(work, 'update-ref', `refs/evil/${first}`, second);

  // A program that leaves a marker named after itself, so a test can see it ran.
  const markers = join(dir, 'markers');
  const bin = join(dir, 'bin');
  mkdirSync(markers);
  mkdirSync(bin);
  const program = (name: string) =>
    script(join(bin, name), `/usr/bin/touch '${join(markers, name)}'\nexit 1`);
  const execPath = join(dir, 'exec-path');
  mkdirSync(execPath);
  copyFileSync(program('git-upload-pack'), join(execPath, 'git-upload-pack'));
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks);
  copyFileSync(program('post-checkout'), join(hooks, 'post-checkout'));
  const template = join(dir, 'template');
  mkdirSync(join(template, 'info'), { recursive: true });
  writeFileSync(join(template, 'info', 'hostile-template'), '');

  // The user's config and attributes, everywhere git might look for them.
  const userHome = join(dir, 'user-home');
  mkdirSync(join(userHome, '.config', 'git'), { recursive: true });
  writeFileSync(join(userHome, '.gitconfig'), REWRITE);
  writeFileSync(join(userHome, '.config', 'git', 'config'), REWRITE);
  writeFileSync(join(userHome, '.config', 'git', 'attributes'), '* binary\n');
  writeFileSync(join(userHome, '.netrc'), 'machine github.com login a password b\n');
  const global = join(dir, 'global-config');
  writeFileSync(global, REWRITE);
  const parameters =
    `'url.file:///nowhere/.insteadof'='file://' 'core.hookspath'='${hooks}' ` +
    `'core.fsmonitor'='${program('fsmonitor')}' 'protocol.allow'='always'`;
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: userHome,
    XDG_CONFIG_HOME: join(userHome, '.config'),
    GIT_CONFIG_GLOBAL: global,
    GIT_CONFIG_PARAMETERS: parameters,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'url.file:///nowhere/.insteadOf',
    GIT_CONFIG_VALUE_0: 'file://',
    GIT_DIR: '/nowhere/.git',
    GIT_TEMPLATE_DIR: template,
    GIT_EXEC_PATH: execPath,
    GIT_SSH_COMMAND: program('ssh-command'),
    GIT_SSH: program('ssh'),
    GIT_ASKPASS: program('git-askpass'),
    SSH_ASKPASS: program('ssh-askpass'),
    GIT_REPLACE_REF_BASE: 'refs/evil/',
    GIT_ATTR_SOURCE: second,
    GIT_PROTOCOL_FROM_USER: '1',
    GIT_ALLOW_PROTOCOL: 'file:ext:ssh',
  };
  const home = join(dir, 'lo-home');
  mkdirSync(home);
  return { dir, url: `file://${join(dir, 'remote.git')}`, work, first, markers, home, env };
}

/**
 * git run by Lo from inside the hostile environment, fetching from the hostile folder's own
 * `file://` repositories unless `remote` says otherwise.
 */
async function runner(context: Hostile, remote = `file://${context.dir}`): Promise<Runner> {
  const status = await gitAt(gitProgram(), { env: context.env, platform: process.platform });
  if (status.status !== 'found') throw new Error(`no git: ${status.status}`);
  return new Runner(status.git, {
    home: context.home,
    ceiling: context.dir,
    test: remote === GITHUB ? undefined : { remote },
  });
}

/** The hostile programs that ran. */
function programsRun(context: Hostile): string[] {
  return readdirSync(context.markers).toSorted();
}

test('hostile config has no effect', async () => {
  const context = hostile();
  const lo = await runner(context);

  // No URL rewrite, and git's own upload-pack, not GIT_EXEC_PATH's.
  const refs = await lo.command('none', { fetching: {} }).arg('ls-remote', context.url).run();
  expect(refs.toString('utf8')).toContain('refs/heads/trunk');

  // git sees no config but Lo's own.
  const config = (await lo.command('none').arg('config', '--list', '--show-origin').run()).toString(
    'utf8',
  );
  const lines = config.trimEnd().split('\n');
  expect(lines.filter((line) => !line.startsWith('command line:'))).toEqual([]);
  for (const absent of ['insteadof', 'hostile', 'markers', 'protocol.allow=always']) {
    expect(config).not.toContain(absent);
  }
  for (const pinned of [
    'credential.helper=',
    'core.askpass=',
    'http.followredirects=false',
    'core.hookspath=/dev/null',
    'core.fsmonitor=false',
    'core.attributesfile=/dev/null',
    'transfer.bundleuri=false',
    'fetch.bundleuri=',
    'promisor.acceptfromserver=None',
    'fetch.uriprotocols=',
    'core.precomposeunicode=false',
    'core.symlinks=false',
    'core.protecthfs=true',
    'core.protectntfs=true',
    'protocol.allow=never',
    'transfer.credentialsinurl=die',
    'safe.barerepository=explicit',
    'submodule.recurse=false',
    'fetch.recursesubmodules=false',
  ]) {
    expect(
      lines.some((line) => line.endsWith(`\t${pinned}`)),
      `${pinned} in ${config}`,
    ).toBe(true);
  }
  expect(programsRun(context)).toEqual([]);
});

test('hostile hooks and templates never run', async () => {
  const context = hostile();
  const lo = await runner(context);
  const clone = join(context.dir, 'clone');

  // A new repository gets no hostile template.
  await lo.command('none').arg('init', '-q').path(clone).run();
  expect(existsSync(join(clone, '.git', 'info', 'hostile-template'))).toBe(false);
  // Nor do the repository's own hooks run: on the refs a fetch writes, or after a checkout.
  for (const hook of ['post-checkout', 'reference-transaction']) {
    script(join(clone, '.git', 'hooks', hook), `/usr/bin/touch '${join(context.markers, hook)}'`);
  }
  const checkout: Location = { gitDir: join(clone, '.git'), workTree: clone };
  await lo.command(checkout, { fetching: {} }).arg('fetch', '-q', context.work, 'trunk').run();
  await lo.command(checkout).arg('update-ref', 'refs/heads/fetched', 'FETCH_HEAD').run();
  await lo.command(checkout).arg('checkout', '-q', 'FETCH_HEAD').run();
  await lo.command(checkout).arg('status', '--porcelain').run();

  expect(programsRun(context)).toEqual([]);
});

test('only https is allowed', async () => {
  const context = hostile();
  const lo = await runner(context, 'https://github.com');
  const ext = `ext::sh -c touch% ${join(context.markers, 'ext')}`;
  const transports = [
    [context.url, 'file'],
    ['ssh://git@example.invalid/a/b.git', 'ssh'],
    ['git@example.invalid:a/b.git', 'ssh'],
    ['git://example.invalid/a/b.git', 'git'],
    [ext, 'ext'],
  ] as const;
  const failures = [];
  for (const [url] of transports) {
    const listing = lo.command('none', { fetching: {} }).arg('ls-remote', url).run();
    failures.push([url, await failureOf(listing)]);
  }
  expect(failures).toEqual(
    transports.map(([url, transport]) => [
      url,
      expect.stringContaining(`transport '${transport}' not allowed`),
    ]),
  );
  expect(programsRun(context)).toEqual([]);
});

test('hostile attributes and replace refs have no effect', async () => {
  const context = hostile();
  const lo = await runner(context);

  // Neither the user's attributes, nor GIT_ATTR_SOURCE's, nor the repository's own, which a bare
  // repository reads from HEAD.
  const attributes = await lo
    .command({ gitDir: join(context.dir, 'remote.git') })
    .arg('check-attr', 'binary', 'diff', '--', 'a.txt')
    .run();
  expect(attributes.toString('utf8')).toBe(
    'a.txt: binary: unspecified\na.txt: diff: unspecified\n',
  );
  // `first` is itself, despite refs/replace/ and GIT_REPLACE_REF_BASE.
  const subject = await lo
    .command({ gitDir: join(context.work, '.git'), workTree: context.work })
    .arg('log', '-1', '--format=%s', context.first)
    .run();
  expect(subject.toString('utf8')).toBe('first\n');
});
