// What Electron's `net.fetch`, which every request Lo makes to GitHub goes through, reports when
// GitHub can't be reached, and which of those Lo counts as offline: run against local sockets, so a
// change in Chromium's network errors shows here. Each request goes through a session of its own,
// straight to the host or through a test proxy, whatever proxy the machine has.

import { createServer, type Server, type Socket } from 'node:net';

import { classifyNetworkError, GithubError } from '@lo/github';
import { _electron as electron, type ElectronApplication } from '@playwright/test';

import { appEnvironment, appFolder, expect, test } from './app.ts';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
const servers: Server[] = [];
const sockets: Socket[] = [];
let sessions = 0;

test.beforeAll(async ({}, info) => {
  app = await electron.launch({
    args: [appFolder],
    env: appEnvironment(info.outputPath('data')),
    chromiumSandbox: true,
  });
});

test.afterAll(async () => {
  await app.close();
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
});

/** A local server that does `answer` with each connection, and its port. */
async function server(answer: (socket: Socket) => void): Promise<number> {
  const listening = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    answer(socket);
  });
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  servers.push(listening);
  const address = listening.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  return address.port;
}

/** A server that reads each request and answers it with `answer`. */
function answering(answer: string): Promise<number> {
  return server((socket) => socket.once('data', () => socket.end(answer)));
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const port = await server(() => {});
  const listening = servers.pop();
  await new Promise((resolve) => listening?.close(resolve));
  return port;
}

/** What one link of what `net.fetch` threw says. */
interface Link {
  name: unknown;
  code: unknown;
  message: unknown;
}

/**
 * What `net.fetch` gets for `GET url`, straight to the host or through the proxy at `proxy`: the
 * status it answered with, or what it threw, as Lo's GitHub client reports it.
 */
async function fetchVia(
  url: string,
  options: { timeout?: number; proxy?: number } = {},
): Promise<{ status: number } | GithubError> {
  sessions += 1;
  const got = await app.evaluate(
    async ({ session }, { url, timeout, proxy, partition }) => {
      const ses = session.fromPartition(partition);
      await ses.setProxy(
        proxy === undefined ? { mode: 'direct' } : { proxyRules: `http://127.0.0.1:${proxy}` },
      );
      try {
        const response = await ses.fetch(url, { signal: AbortSignal.timeout(timeout) });
        return { status: response.status, chain: [] };
      } catch (error) {
        const chain: { name: unknown; code: unknown; message: unknown }[] = [];
        let current: unknown = error;
        for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
          chain.push({
            name: Reflect.get(current, 'name'),
            code: Reflect.get(current, 'code'),
            message: Reflect.get(current, 'message'),
          });
          current = Reflect.get(current, 'cause');
        }
        return { status: undefined, chain };
      }
    },
    {
      url,
      timeout: options.timeout ?? 10_000,
      proxy: options.proxy,
      partition: `test-${sessions}`,
    },
  );
  if (got.status !== undefined) return { status: got.status };
  // What was thrown, rebuilt with its causes, as the client's classifier reads it.
  const thrown = got.chain.reduceRight<unknown>(
    (cause, link: Link) => ({ ...link, cause }),
    undefined,
  );
  const message = got.chain.map((link) => String(link.message)).join(': ');
  return new GithubError({ kind: 'network', failure: classifyNetworkError(thrown), message });
}

/** What `net.fetch` threw for `GET url`, as Lo's GitHub client reports it. */
async function get(url: string, options: { timeout?: number; proxy?: number } = {}) {
  const got = await fetchVia(url, options);
  if (!(got instanceof GithubError)) throw new Error(`${url} answered ${got.status}`);
  return got;
}

test('a port nothing listens on is unreachable', async () => {
  const error = await get(`http://127.0.0.1:${await closedPort()}/`);
  expect(error.isUnreachable(), error.message).toBe(true);
  expect(error.isRetryable(), error.message).toBe(true);
});

test('a host with no DNS answer is unreachable', async () => {
  const error = await get('http://api.lo-test.invalid/');
  expect(error.isUnreachable(), error.message).toBe(true);
});

test('a dead proxy is unreachable', async () => {
  const error = await get('https://api.github.com/', { proxy: await closedPort() });
  expect(error.isUnreachable(), error.message).toBe(true);
});

test("a server that never answers isn't offline but is worth trying again", async () => {
  // Holds the connection open without a word.
  const port = await server(() => {});
  const error = await get(`http://127.0.0.1:${port}/`, { timeout: 500 });
  expect(error.isUnreachable(), error.message).toBe(false);
  expect(error.isRetryable(), error.message).toBe(true);
});

test("a connection closed before the answer isn't offline but is worth trying again", async () => {
  // Reads the request and hangs up, as a connection that died under it does.
  const port = await server((socket) => socket.once('data', () => socket.destroy()));
  const error = await get(`http://127.0.0.1:${port}/`);
  expect(error.isUnreachable(), error.message).toBe(false);
  expect(error.isRetryable(), error.message).toBe(true);
});

test("a proxy that can't reach GitHub is worth trying again", async () => {
  const port = await answering('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');
  const error = await get('https://api.github.com/', { proxy: port });
  expect(error.isUnreachable(), error.message).toBe(false);
  expect(error.isRetryable(), error.message).toBe(true);
});

test("a proxy that wants a password isn't offline", async () => {
  const port = await answering(
    'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="lo"\r\nContent-Length: 0\r\n\r\n',
  );
  // net.fetch hands the proxy's refusal back as an answer, which the client takes as a refusal
  // to show, never as being offline or as worth trying again.
  expect(await fetchVia('https://api.github.com/', { proxy: port })).toEqual({ status: 407 });
  const error = GithubError.fromResponse(407, new Headers(), '');
  expect(error.isUnreachable(), error.message).toBe(false);
  expect(error.isRetryable(), error.message).toBe(false);
});

test("a failed TLS handshake isn't offline", async () => {
  // Speaks plain HTTP where TLS is expected, as a broken intercepting proxy might.
  const port = await answering('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
  const error = await get(`https://127.0.0.1:${port}/`);
  expect(error.isUnreachable(), error.message).toBe(false);
});
