import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { afterAll, expect, onTestFinished, test } from 'vitest';

import { gitProgram, testGitEnvironment } from './git.ts';
import { GitHttpServer } from './http.ts';
import { RepoServer } from './repos.ts';

const repos = new RepoServer();
afterAll(() => repos.remove());

/** The token the server lets in. Not a real one. */
const TOKEN = 'TOKEN_FOR_TESTS';

test('holds every request until the test lets them go, then answers each', async () => {
  const repo = repos.repo('owner', 'repo').write('README.md', '# repo\n');
  const head = repo.commit('first');
  repo.publish('refs/heads/trunk');
  const server = await GitHttpServer.start(repos.remotes, TOKEN);
  onTestFinished(() => server.close());
  const url = new URL(`${server.url}/owner/repo.git`);
  url.username = 'git';
  url.password = TOKEN;

  const letGo = server.hold();
  let answered = false;
  const listed = promisify(execFile)(gitProgram(), ['ls-remote', url.href, 'refs/heads/trunk'], {
    env: { ...testGitEnvironment(), GIT_TERMINAL_PROMPT: '0' },
  }).finally(() => {
    answered = true;
  });
  await expect.poll(() => server.waiting).toBe(1);
  expect(answered).toBe(false);

  letGo();
  expect((await listed).stdout).toBe(`${head}\trefs/heads/trunk\n`);
  expect(server.waiting).toBe(0);
});
