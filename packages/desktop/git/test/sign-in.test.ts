// Signing in: git gets the token only on a fetch, only from Lo's credential helper, and only for
// the remote's own address.

import { mkdirSync, readdirSync } from 'node:fs';
import { inspect } from 'node:util';
import { join } from 'node:path';

import { GitHttpServer, RepoServer } from '@lo/testing/git';
import { expect, onTestFinished, test } from 'vitest';

import { CREDENTIAL_HELPER, TOKEN_VARIABLE } from '../src/environment.ts';
import { GitError } from '../src/errors.ts';
import type { Runner } from '../src/git.ts';
import { Token } from '../src/token.ts';
import { failureOf, foundGit, runnerIn, script, tempFolder } from './support.ts';

const GITHUB = 'https://github.com';

/** Asks git for credentials for `url`, as it does when a server or proxy answers 401 or 407. */
async function credentialFill(lo: Runner, token: Token | undefined, url: string): Promise<string> {
  const output = await lo
    .command('none', { fetching: { token } })
    .arg('credential', 'fill')
    .run(`url=${url}\n\n`);
  return output.toString('utf8');
}

/** A runner in an environment that names an askpass program, which leaves a marker if it runs. */
async function withAskpass(): Promise<{ lo: Runner; ran: () => string[] }> {
  const dir = tempFolder();
  const markers = join(dir, 'markers');
  mkdirSync(markers);
  const askpass = (name: string) =>
    script(join(dir, name), `/usr/bin/touch '${join(markers, name)}'\necho stolen`);
  const git = await foundGit({
    ...process.env,
    GIT_ASKPASS: askpass('git-askpass'),
    SSH_ASKPASS: askpass('ssh-askpass'),
    HOME: join(dir, 'user-home'),
  });
  const lo = await runnerIn(dir, { git, remote: GITHUB });
  return { lo, ran: () => readdirSync(markers) };
}

test('git signs in to the remote with the token', async () => {
  const lo = await runnerIn(tempFolder(), { remote: GITHUB });
  const token = new Token('gho_secret\n');

  const credentials = await credentialFill(lo, token, 'https://github.com/a/b.git');

  expect(credentials).toContain('username=x-access-token\n');
  expect(credentials).toContain('password=gho_secret\n');
  // The token is in no argument, only in the variable the helper reads.
  const command = lo.command('none', { fetching: { token } }).arg('credential', 'fill');
  expect(command.display).not.toContain('gho_secret');
  const child = command.start({ input: true });
  const args = child.spawnargs;
  child.stdin?.end();
  await child.exited;
  expect(args.join(' ')).not.toContain('gho_secret');
  expect(CREDENTIAL_HELPER).toContain(`$${TOKEN_VARIABLE}`);
});

test('the token goes to no other host or proxy', async () => {
  const { lo, ran } = await withAskpass();
  const token = new Token('gho_secret');

  const urls = [
    // A proxy whose URL names a user and no password.
    'http://alice@proxy.example:3128',
    'https://alice@proxy.example:3128',
    // Another host, such as one a request was redirected to.
    'https://example.com/a/b.git',
    'https://github.com.example.com/a/b.git',
    'https://gist.github.com/a.git',
    // github.com, but not over HTTPS.
    'http://github.com/a/b.git',
    'https://github.com:8443/a/b.git',
  ];
  const failures = [];
  for (const url of urls) failures.push([url, await failureOf(credentialFill(lo, token, url))]);
  expect(failures).toEqual(
    urls.map((url) => [url, expect.stringContaining('terminal prompts disabled')]),
  );
  // Nor does any askpass the environment names run.
  expect(ran()).toEqual([]);
});

test('a token that would split the helpers answer isnt used', async () => {
  const lo = await runnerIn(tempFolder(), { remote: GITHUB });
  const token = new Token('gho_secret\nhost=example.com');

  await expect(credentialFill(lo, token, 'https://github.com/a/b.git')).rejects.toThrow(
    'terminal prompts disabled',
  );
  expect(new Token(' gho_ok\n').usable).toBe(true);
  expect(new Token('').usable).toBe(false);
  expect(new Token('a b').usable).toBe(false);
  expect(new Token('a\u0085b').usable).toBe(false);
});

test('without a token git never prompts', async () => {
  const { lo, ran } = await withAskpass();

  await expect(credentialFill(lo, undefined, 'https://github.com/a/b.git')).rejects.toThrow(
    'terminal prompts disabled',
  );
  // Not GIT_ASKPASS's or SSH_ASKPASS's helper either.
  expect(ran()).toEqual([]);
});

test('without a fetch git gets no token', async () => {
  const lo = await runnerIn(tempFolder(), { remote: GITHUB });
  const read = lo.command('none').arg('credential', 'fill');

  await expect(read.run('url=https://github.com/a/b.git\n\n')).rejects.toThrow(
    'terminal prompts disabled',
  );
});

test('proxy passwords stay out of debug output', async () => {
  const git = await foundGit({
    ...process.env,
    PATH: '/usr/bin:/bin',
    https_proxy: 'http://alice:hunter2@proxy:3128',
    ALL_PROXY: 'socks5://bob:swordfish@proxy:1080',
  });
  const lo = await runnerIn(tempFolder(), { git, remote: GITHUB });
  const command = lo
    .command('none', { fetching: { proxy: 'http://carol:opensesame@proxy:3128' } })
    .arg('ls-remote', 'https://github.com/a/b.git');

  for (const shown of [inspect(git), inspect(lo), inspect(command), command.display, String(git)]) {
    for (const password of ['hunter2', 'swordfish', 'opensesame']) {
      expect(shown).not.toContain(password);
    }
  }
  expect(inspect(git)).toContain('/usr/bin:/bin');
});

test('a fetch signs in over HTTP, and a token the server refuses is told from none', async () => {
  const server = new RepoServer();
  onTestFinished(() => server.remove());
  const remote = server.repo('owner', 'repo');
  remote.write('a.txt', 'a\n');
  const head = remote.commit('first');
  remote.publish('refs/heads/main');
  const http = await GitHttpServer.start(server.remotes, 'gho_ACCEPTED');
  onTestFinished(() => http.close());
  const lo = await runnerIn(tempFolder(), { remote: http.url });
  const list = (token?: string) =>
    lo
      .command('none', { fetching: { token: token === undefined ? undefined : new Token(token) } })
      .arg('ls-remote', `${http.url}/owner/repo.git`, 'refs/heads/main')
      .run(undefined, { what: 'owner/repo' });

  expect((await list('gho_ACCEPTED')).toString('utf8')).toBe(`${head}\trefs/heads/main\n`);
  const refused = await list('gho_REVOKED').catch((error: unknown) => error);
  const none = await list().catch((error: unknown) => error);

  expect(refused instanceof GitError && refused.detail).toMatchObject({ failure: 'tokenRefused' });
  expect(none instanceof GitError && none.detail).toMatchObject({ failure: 'auth' });
  expect(new Set(http.signedInWith())).toEqual(new Set(['gho_ACCEPTED', 'gho_REVOKED']));
});
