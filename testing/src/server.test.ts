import { expect, onTestFinished, test } from 'vitest';

import { Replay } from './replay.ts';
import { serveReplay } from './server.ts';

test("stands in for GitHub's API, website and uploads", async () => {
  const replay = new Replay('t', [
    {
      request: { method: 'GET', url: 'https://api.github.com/user' },
      response: {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { login: 'rozed-bot' },
      },
    },
    {
      request: {
        method: 'POST',
        url: 'https://github.com/login/device/code',
        body: 'client_id=abc',
      },
      response: { status: 200, headers: {}, body: { user_code: 'ABCD-1234' } },
    },
    {
      request: {
        method: 'POST',
        url: 'https://uploads.github.com/user-attachments/assets',
        body_sha256: 'x',
      },
      response: { status: 201, headers: {}, body: {} },
    },
  ]);
  const server = await serveReplay(replay);
  onTestFinished(() => server.close());

  const user = await fetch(`${server.urls.api}/user`);
  expect(await user.json()).toEqual({ login: 'rozed-bot' });
  expect(user.headers.get('content-type')).toBe('application/json');
  const code = await fetch(`${server.urls.web}/login/device/code`, {
    method: 'POST',
    body: 'client_id=abc',
  });
  expect(await code.json()).toEqual({ user_code: 'ABCD-1234' });
  expect(server.replay.seen.map(({ method, url }) => `${method} ${url}`)).toEqual([
    'GET https://api.github.com/user',
    'POST https://github.com/login/device/code',
  ]);
});

test("moves GitHub's addresses in links and redirects to the server's", async () => {
  const server = await serveReplay('push_history_fd_2212');
  onTestFinished(() => server.close());
  const url = `${server.urls.api}/repos/sharkdp/fd/activity?ref=refs%2Fheads%2Fmaster&direction=desc&per_page=100`;
  const response = await fetch(url);
  expect(response.status).toBe(200);
  const link = response.headers.get('link');
  expect(link).toMatch(new RegExp(`^<${server.urls.api}/repositories/90793418/activity\\?`));
  expect(link).not.toContain('github.com');
});

test("a request the cassette can't answer gets a 500 and fails the test when the server closes", async () => {
  const server = await serveReplay(new Replay('t', []));
  const response = await fetch(`${server.urls.api}/user`);
  expect(response.status).toBe(500);
  expect(await response.text()).toContain(
    'cassette t has no response for\n  GET https://api.github.com/user',
  );
  const outside = await fetch(server.urls.api.replace('/api', '/elsewhere'));
  expect(outside.status).toBe(500);
  expect(server.failures).toHaveLength(2);
  await expect(server.close()).rejects.toThrow("the replay server couldn't answer 2 request(s)");
});
