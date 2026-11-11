// Each of git's guards, tried: a remote over another protocol, a read that would download, a
// filter a repository's attributes name, a symlink in a checkout, a repository's own settings, a
// repository above the cache, an address with a password, a proxy that asks for one, and a
// redirect.

import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { FakeServer, git, GitHttpServer, missingObjects, RepoServer } from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { gitAt } from '../src/find.ts';
import { type Location, Runner } from '../src/git.ts';
import { Token } from '../src/token.ts';
import { failureOf, foundGit, runnerIn, script, tempFolder, wrappedGit } from './support.ts';

const SECRET = 'gho_FAKE_TOKEN_FOR_TESTS';

/** A server of repositories in a folder, deleted when the test ends. */
function repoServer(): RepoServer {
  const server = new RepoServer();
  onTestFinished(() => server.remove());
  return server;
}

test('no setting of a test’s opens another protocol', async () => {
  const server = repoServer();
  server.repo('owner', 'repo');
  const lo = await runnerIn(tempFolder(), {
    remote: 'https://github.com',
    config: ['protocol.allow=always', 'protocol.file.allow=always'],
  });

  const listing = lo
    .command('none', { fetching: {} })
    .arg('ls-remote', `${server.baseUrl}/owner/repo.git`)
    .run();

  await expect(listing).rejects.toThrow("transport 'file' not allowed");
});

test('a git that ignores the protocol variable still takes only the remote’s protocol', async () => {
  const server = repoServer();
  server.repo('owner', 'repo');
  const dir = tempFolder();
  const unset = wrappedGit(join(dir, 'git'), { before: 'unset GIT_ALLOW_PROTOCOL' });
  const status = await gitAt(unset, { env: process.env, platform: process.platform });
  if (status.status !== 'found') throw new Error(status.message);
  const lo = await runnerIn(dir, { git: status.git, remote: 'https://github.com' });

  const listing = lo
    .command('none', { fetching: {} })
    .arg('ls-remote', `${server.baseUrl}/owner/repo.git`)
    .run();

  await expect(listing).rejects.toThrow("transport 'file' not allowed");
});

test('a read never downloads what the clone lacks', async () => {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('a.txt', 'a\n');
  const head = remote.commit('first');
  remote.publish('refs/heads/trunk');
  const dir = tempFolder();
  const lo = await runnerIn(dir, { remote: server.baseUrl });
  const clone = join(dir, 'clone.git');
  await lo.command('none').arg('init', '-q', '--bare', '--template=').path(clone).run();
  const repo: Location = { gitDir: clone };
  await lo
    .command(repo)
    .arg('config', 'remote.origin.url', `${server.baseUrl}/owner/repo.git`)
    .run();
  await lo
    .command(repo, { fetching: {} })
    .arg('fetch', '-q', '--filter=blob:none', 'origin', `${head}:refs/lo/head`)
    .run(undefined, { what: 'the head' });
  const blob = git(remote.work, 'rev-parse', `${head}:a.txt`);

  const read = await lo.command(repo).arg('cat-file', '-p', blob).finish();

  expect(read.code).not.toBe(0);
  expect(missingObjects(clone, head)).toEqual([blob]);
  // A fetch may download it.
  const fetched = await lo
    .command(repo, { fetching: {} })
    .arg('cat-file', '-p', blob)
    .run(undefined, { what: 'a.txt' });
  expect(fetched.toString('utf8')).toBe('a\n');
});

/** A clone of `remote`'s `trunk`, checked out by Lo's git into `checkout`. */
async function checkOut(lo: Runner, url: string, checkout: string): Promise<void> {
  mkdirSync(checkout);
  const location: Location = { gitDir: join(checkout, '.git'), workTree: checkout };
  await lo.command('none').arg('init', '-q', '--template=').path(checkout).run();
  await lo.command(location, { fetching: {} }).arg('fetch', '-q', url, 'trunk').run();
  await lo.command(location).arg('checkout', '-q', 'FETCH_HEAD').run();
}

test('a filter a repository’s attributes name never runs', async () => {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('.gitattributes', '*.txt filter=evil\n').write('a.txt', 'a\n').commit('first');
  remote.publish('refs/heads/trunk');
  const dir = tempFolder();
  const ran = join(dir, 'filter-ran');
  // A filter defined where git would read it: a user's config, or a clone's.
  const filter = script(join(dir, 'filter'), `/usr/bin/touch '${ran}'\ncat`);
  const lo = await runnerIn(dir, {
    remote: server.baseUrl,
    config: [`filter.evil.smudge=${filter}`, `filter.evil.clean=${filter}`],
  });

  await checkOut(lo, `${server.baseUrl}/owner/repo.git`, join(dir, 'checkout'));

  expect(readFileSync(join(dir, 'checkout', 'a.txt'), 'utf8')).toBe('a\n');
  expect(existsSync(ran)).toBe(false);
});

test('a symlink in a checkout is a plain file holding its target', async () => {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.symlink('link', '/etc/passwd').commit('first');
  remote.publish('refs/heads/trunk');
  const dir = tempFolder();
  const lo = await runnerIn(dir, { remote: server.baseUrl });

  await checkOut(lo, `${server.baseUrl}/owner/repo.git`, join(dir, 'checkout'));

  const link = join(dir, 'checkout', 'link');
  expect(lstatSync(link).isFile()).toBe(true);
  expect(readFileSync(link, 'utf8')).toBe('/etc/passwd');
});

test('nothing in a repository’s settings or git’s home folder runs a program or reads attributes', async () => {
  const dir = tempFolder();
  const markers = join(dir, 'markers');
  mkdirSync(markers);
  const program = (name: string) =>
    script(join(dir, name), `/usr/bin/touch '${join(markers, name)}'\necho password=stolen`);
  const hooks = join(dir, 'hooks');
  mkdirSync(hooks);
  script(join(hooks, 'reference-transaction'), `/usr/bin/touch '${join(markers, 'hook')}'`);
  const attributes = join(dir, 'attributes');
  writeFileSync(attributes, '* binary\n');
  const settings = [
    `[core]\n\tfsmonitor = ${program('fsmonitor')}\n\thooksPath = ${hooks}\n`,
    `\taskPass = ${program('askpass')}\n\tattributesFile = ${attributes}\n`,
    `[credential]\n\thelper = ${program('helper')}\n`,
  ].join('');
  const work = join(dir, 'work');
  git(dir, 'init', '-q', work);
  writeFileSync(join(work, 'a.txt'), 'a\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'first');
  // In the repository's own config, and in a file it includes.
  writeFileSync(join(dir, 'included'), settings);
  appendFileSync(
    join(work, '.git', 'config'),
    `${settings}[include]\n\tpath = ${join(dir, 'included')}\n`,
  );
  const lo = await runnerIn(dir, { remote: 'https://github.com' });
  // And in the home folder git gets, where something else may have written.
  writeFileSync(join(dir, 'home', '.gitconfig'), settings);
  const checkout: Location = { gitDir: join(work, '.git'), workTree: work };

  await lo.command(checkout).arg('status', '--porcelain').run();
  await lo.command(checkout).arg('update-ref', 'refs/heads/other', 'HEAD').run();
  const attribute = await lo.command(checkout).arg('check-attr', 'binary', '--', 'a.txt').run();
  const fill = lo
    .command(checkout, { fetching: { token: new Token(SECRET) } })
    .arg('credential', 'fill')
    .run('url=https://example.com/a/b.git\n\n');

  await expect(fill).rejects.toThrow('terminal prompts disabled');
  expect(attribute.toString('utf8')).toBe('a.txt: binary: unspecified\n');
  expect(readdirSync(markers)).toEqual([]);
  const config = await lo.command('none').arg('config', '--list', '--show-origin').run();
  const lines = config.toString('utf8').trimEnd().split('\n');
  expect(lines.filter((line) => !line.startsWith('command line:'))).toEqual([]);
});

test('a command with no repository finds none above the cache', async () => {
  // A repository holding the cache, as dotfiles kept in a home folder are.
  const above = tempFolder();
  git(above, 'init', '-q');
  const cache = join(above, 'cache');
  mkdirSync(join(cache, 'home'), { recursive: true });
  const lo = new Runner(await foundGit(), { home: join(cache, 'home'), ceiling: cache });

  const found = lo.command('none').arg('rev-parse', '--git-dir').run();

  await expect(found).rejects.toThrow('not a git repository');
});

test('an address with a password in it is refused', async () => {
  const server = await FakeServer.asksForAPassword();
  onTestFinished(() => server.close());
  const lo = await runnerIn(tempFolder(), { remote: server.url });
  const address = `http://x-access-token:${SECRET}@127.0.0.1:${server.port}/owner/repo.git`;

  const listing = lo.command('none', { fetching: {} }).arg('ls-remote', address).run();

  await expect(listing).rejects.toThrow('uses plaintext credentials');
  expect(server.requests()).toEqual([]);
});

test('the token never reaches a proxy, even one that asks for a password', async () => {
  const proxy = await FakeServer.proxy();
  onTestFinished(() => proxy.close());
  const lo = await runnerIn(tempFolder(), { remote: 'https://github.com' });
  const token = new Token(SECRET);

  const failures = [];
  for (const address of [proxy.url, `http://alice@127.0.0.1:${proxy.port}`]) {
    const listing = lo
      .command('none', { fetching: { token, proxy: address } })
      .arg('ls-remote', 'https://github.com/owner/repo.git')
      .run(undefined, { what: 'owner/repo' });
    failures.push(await failureOf(listing));
  }
  expect(failures).toEqual([
    expect.stringContaining("can't fetch owner/repo"),
    expect.stringContaining("can't fetch owner/repo"),
  ]);

  // git went through the proxy, which refused it, and never gave it the token.
  expect(proxy.requests().length).toBeGreaterThan(0);
  expect(proxy.saw(SECRET)).toBe(false);
});

test('a redirect is never followed, and the host it names never gets the token', async () => {
  const elsewhere = await FakeServer.asksForAPassword();
  const redirector = await FakeServer.redirectsTo(elsewhere.port);
  onTestFinished(async () => {
    await Promise.all([elsewhere.close(), redirector.close()]);
  });
  const token = new Token(SECRET);
  const list = async (config: string[]) => {
    const lo = await runnerIn(tempFolder(), { remote: redirector.url, config });
    const listing = lo
      .command('none', { fetching: { token } })
      .arg('ls-remote', `${redirector.url}/owner/repo.git`)
      .run(undefined, { what: 'owner/repo' });
    await expect(listing).rejects.toThrow("can't fetch owner/repo");
  };

  await list([]);
  expect(redirector.requests().length).toBeGreaterThan(0);
  expect(elsewhere.requests()).toEqual([]);

  // Even with redirects on, the token is only for the remote's own address.
  await list(['http.followRedirects=true']);
  expect(elsewhere.requests().length).toBeGreaterThan(0);
  expect(elsewhere.saw(SECRET)).toBe(false);
});

/** `owner/repo`, with a commit on `main`, served over HTTP to `token`, and a host elsewhere. */
async function served(token: string) {
  const server = repoServer();
  const remote = server.repo('owner', 'repo');
  remote.write('a.txt', 'a\n').commit('first');
  remote.publish('refs/heads/main');
  const http = await GitHttpServer.start(server.remotes, token);
  const elsewhere = await FakeServer.asksForAPassword();
  onTestFinished(async () => {
    await Promise.all([http.close(), elsewhere.close()]);
  });
  return { remote, http, elsewhere };
}

/** A bare repository with `settings` of its own, fetching `owner/repo` from `http`. */
async function withSettings(http: GitHttpServer, settings: [string, string][]) {
  const dir = tempFolder();
  const lo = await runnerIn(dir, { remote: http.url });
  const clone = join(dir, 'clone.git');
  git(dir, 'init', '-q', '--bare', clone);
  git(clone, 'config', 'remote.origin.url', `${http.url}/owner/repo.git`);
  for (const [key, value] of settings) git(clone, 'config', key, value);
  return { lo, clone };
}

test('a bundle a repository’s settings name is never downloaded', async () => {
  const { http, elsewhere } = await served(SECRET);
  const { lo, clone } = await withSettings(http, [
    ['fetch.bundleURI', `${elsewhere.url}/everything.bundle`],
  ]);

  await lo
    .command({ gitDir: clone }, { fetching: { token: new Token(SECRET) } })
    .arg('fetch', 'origin', '+refs/heads/main:refs/lo/main')
    .run(undefined, { what: 'owner/repo' });

  expect(git(clone, 'for-each-ref', '--format=%(refname)')).toBe('refs/lo/main');
  expect(elsewhere.requests()).toEqual([]);
});

test('a repository’s settings can’t take promisors or packfiles a server offers from elsewhere', async () => {
  const { http } = await served(SECRET);
  const { lo, clone } = await withSettings(http, [
    ['promisor.acceptFromServer', 'All'],
    ['fetch.uriProtocols', 'http,https'],
  ]);
  const setting = async (key: string) =>
    (await lo.command({ gitDir: clone }).arg('config', '--get', key).run()).toString('utf8');

  // The settings git goes by when a server offers them, whatever the repository says.
  expect(await setting('promisor.acceptFromServer')).toBe('None\n');
  expect(await setting('fetch.uriProtocols')).toBe('\n');
});
