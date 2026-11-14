import { once } from 'node:events';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer as createNetServer, type Socket } from 'node:net';

import { classifyNetworkError, type FetchInit } from '@lo/github';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authorities, hopsOf, onceFetch, writesOnce } from './once.ts';
import { AUTHORITY, LOCALHOST } from './test/tls.ts';

/** What reached a test server: each request, with its body. */
interface Arrival {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

/** Starts `server` on a free port of 127.0.0.1, closed after the test, and gives the port. */
async function listening(server: Server | ReturnType<typeof createNetServer>): Promise<number> {
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  closers.push(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

/**
 * A server that answers each request with `answer`: an answer, `'drop'` to drop the connection
 * without a word, as a proxy cut off does, or `'hold'` to say nothing. `tls` serves https.
 */
async function serving(
  answer: (arrival: Arrival) => { status: number; body?: string } | 'drop' | 'hold' = () => ({
    status: 200,
    body: '{"ok":true}',
  }),
  tls = false,
): Promise<{ origin: string; arrivals: Arrival[] }> {
  const arrivals: Arrival[] = [];
  const server = (tls ? createHttpsServer(LOCALHOST) : createHttpServer()).on(
    'request',
    (asked: IncomingMessage, reply) => {
      const chunks: Buffer[] = [];
      asked.on('data', (chunk: Buffer) => chunks.push(chunk));
      asked.on('end', () => {
        const arrival = {
          method: asked.method ?? '',
          url: asked.url ?? '',
          headers: asked.headers,
          body: Buffer.concat(chunks).toString(),
        };
        arrivals.push(arrival);
        const answered = answer(arrival);
        if (answered === 'hold') return;
        if (answered === 'drop') {
          asked.socket.destroy();
          return;
        }
        reply.writeHead(answered.status, { 'content-type': 'application/json', 'x-seen': '1' });
        reply.end(answered.body);
      });
    },
  );
  const port = await listening(server);
  return { origin: `${tls ? 'https' : 'http'}://localhost:${port}`, arrivals };
}

/** An HTTP proxy that opens tunnels, or answers each `CONNECT` with `refuse`'s status. */
async function httpProxy(
  options: { refuse?: number; tls?: boolean } = {},
): Promise<{ port: number; asked: string[] }> {
  const asked: string[] = [];
  const server = options.tls ? createHttpsServer(LOCALHOST) : createHttpServer();
  server.on('connect', (request: IncomingMessage, client: Socket, head: Buffer) => {
    asked.push(request.url ?? '');
    if (options.refuse !== undefined) {
      client.end(`HTTP/1.1 ${options.refuse} No\r\n\r\n`);
      return;
    }
    const [host = '', port = ''] = (request.url ?? '').split(/:(?=\d+$)/);
    const onward = connect(Number(port), host === 'localhost' ? '127.0.0.1' : host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      onward.write(head);
      onward.pipe(client).pipe(onward);
    });
    onward.on('error', () => client.destroy());
    client.on('error', () => onward.destroy());
  });
  return { port: await listening(server), asked };
}

/** A SOCKS proxy, of version 4 or 5, that connects without asking who's asking. */
async function socksProxy(): Promise<{ port: number; asked: string[] }> {
  const asked: string[] = [];
  const server = createNetServer((client) => {
    let held = Buffer.alloc(0);
    const ahead = (host: string, port: number, reply: Buffer) => {
      client.removeAllListeners('data');
      asked.push(`${host}:${port}`);
      const onward = connect(port, host === 'localhost' ? '127.0.0.1' : host, () => {
        client.write(reply);
        onward.pipe(client).pipe(onward);
      });
      onward.on('error', () => client.destroy());
      client.on('error', () => onward.destroy());
    };
    client.on('data', (chunk: Buffer) => {
      held = Buffer.concat([held, chunk]);
      if (held[0] === 4 && held.length >= 9 && held.indexOf(0, 8) >= 0) {
        const port = held.readUInt16BE(2);
        ahead([...held.subarray(4, 8)].join('.'), port, Buffer.from([0, 0x5a, 0, 0, 0, 0, 0, 0]));
      } else if (held[0] === 5 && held.length === 3) {
        client.write(Buffer.from([5, 0]));
        held = Buffer.alloc(0);
      } else if (held[0] === 5 && held[3] === 3 && held.length >= 5 + (held[4] ?? 0) + 2) {
        const length = held[4] ?? 0;
        ahead(
          held.subarray(5, 5 + length).toString(),
          held.readUInt16BE(5 + length),
          Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
        );
      }
    });
  });
  return { port: await listening(server), asked };
}

/** A port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createNetServer();
  const port = await listening(server);
  server.close();
  return port;
}

/** A `fetch` of writes that goes the way `proxy` says, trusting `ca`. */
function writes(proxy = 'DIRECT', ca: () => readonly string[] = () => [AUTHORITY]) {
  return onceFetch({ proxy: () => Promise.resolve(proxy), ca });
}

/** What a failed write threw. */
async function thrown(answer: Promise<unknown>): Promise<unknown> {
  return answer.then(
    () => expect.fail('the write was answered'),
    (error: unknown) => error,
  );
}

const comment = (): FetchInit => ({
  method: 'POST',
  headers: { authorization: 'token t', 'content-type': 'application/json' },
  body: '{"body":"Looks good"}',
  once: true,
});

describe('a write', () => {
  it('goes once, and its whole answer comes back', async () => {
    const { origin, arrivals } = await serving();

    const answer = await writes()(`${origin}/repos/o/r/pulls/1/comments?x=1`, comment());

    expect(answer.status).toBe(200);
    expect(answer.headers.get('x-seen')).toBe('1');
    expect(await answer.json()).toEqual({ ok: true });
    expect(arrivals).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/repos/o/r/pulls/1/comments?x=1',
        body: '{"body":"Looks good"}',
        headers: expect.objectContaining({
          host: new URL(origin).host,
          authorization: 'token t',
          'content-length': '21',
          connection: 'close',
        }) as unknown,
      }),
    ]);
  });

  it('whose connection drops before its answer is never sent again, and fails as lost', async () => {
    const { origin, arrivals } = await serving(() => 'drop');

    const error = await thrown(writes()(`${origin}/graphql`, comment()));

    expect(arrivals).toHaveLength(1);
    expect(classifyNetworkError(error)).toBe('lost');
  });

  it('goes over TLS, trusting only the authorities it was given', async () => {
    const { origin, arrivals } = await serving(undefined, true);

    expect((await writes()(`${origin}/graphql`, comment())).status).toBe(200);
    const error = await thrown(writes('DIRECT', authorities)(`${origin}/graphql`, comment()));

    expect(classifyNetworkError(error)).toBe('refused');
    expect(arrivals).toHaveLength(1);
  });

  it('goes through an HTTP proxy, or an HTTPS one, by a tunnel', async () => {
    const { origin, arrivals } = await serving(undefined, true);
    const plain = await httpProxy();
    const secure = await httpProxy({ tls: true });

    const through = await writes(`PROXY 127.0.0.1:${plain.port}`)(`${origin}/graphql`, comment());
    const securely = await writes(`HTTPS localhost:${secure.port}`)(`${origin}/x`, comment());

    expect([through.status, securely.status]).toEqual([200, 200]);
    expect(plain.asked).toEqual([new URL(origin).host]);
    expect(secure.asked).toEqual([new URL(origin).host]);
    expect(arrivals).toHaveLength(2);
  });

  it('goes through a SOCKS proxy: by name for SOCKS5, at its address for SOCKS4', async () => {
    const { origin, arrivals } = await serving(undefined, true);
    const { port } = new URL(origin);
    const socks = await socksProxy();

    await writes(`SOCKS5 127.0.0.1:${socks.port}`)(`${origin}/graphql`, comment());
    await writes(`SOCKS 127.0.0.1:${socks.port}`)(`${origin}/graphql`, comment());

    expect(socks.asked).toEqual([`localhost:${port}`, `127.0.0.1:${port}`]);
    expect(arrivals).toHaveLength(2);
  });

  it('takes the next way when a proxy is down, before anything went', async () => {
    const { origin, arrivals } = await serving();
    const down = await closedPort();

    const answer = await writes(`PROXY 127.0.0.1:${down}; DIRECT`)(`${origin}/x`, comment());

    expect(answer.status).toBe(200);
    expect(arrivals).toHaveLength(1);
  });

  it('fails as never sent when no way goes through', async () => {
    const { origin, arrivals } = await serving();
    const refusing = await httpProxy({ refuse: 502 });
    const asking = await httpProxy({ refuse: 407 });
    const fail = (proxy: string) => thrown(writes(proxy)(`${origin}/x`, comment()));

    expect(classifyNetworkError(await fail(`PROXY 127.0.0.1:${refusing.port}`))).toBe('tunnel');
    expect(classifyNetworkError(await fail(`PROXY 127.0.0.1:${asking.port}`))).toBe('refused');
    expect(classifyNetworkError(await fail(`QUIC 127.0.0.1:${asking.port}`))).toBe('refused');
    expect(classifyNetworkError(await fail(''))).toBe('refused');
    expect(arrivals).toEqual([]);
  });

  it('given up is cancelled, and fails with its reason', async () => {
    let arrived: (() => void) | undefined;
    const reached = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const { origin, arrivals } = await serving(() => {
      arrived?.();
      return 'hold';
    });
    const giveUp = new AbortController();
    const why = new Error('given up');

    const answer = writes()(`${origin}/x`, { ...comment(), signal: giveUp.signal });
    await reached;
    giveUp.abort(why);

    expect(await thrown(answer)).toBe(why);
    expect(arrivals).toHaveLength(1);
  });

  it('tells how much of its body has gone, once more as the answer starts', async () => {
    const { origin, arrivals } = await serving();
    const uploadProgress = vi.fn<(sent: number, total: number) => void>();
    const body = 'x'.repeat(200_000);

    const upload: FetchInit = { ...comment(), body, uploadProgress };

    await writes()(`${origin}/upload`, upload);

    expect(arrivals[0]?.body).toBe(body);
    expect(uploadProgress).toHaveBeenLastCalledWith(200_000, 200_000);
  });
});

describe('the ways to the server', () => {
  it('are the ones Chromium names, in its order, but those a write cant take', () => {
    const ipv6 = '[::1]';
    expect(
      hopsOf(`PROXY proxy:3128; HTTPS secure.proxy:443;SOCKS s:1080; SOCKS5 ${ipv6}:1081; DIRECT`),
    ).toEqual([
      { kind: 'http', host: 'proxy', port: 3128 },
      { kind: 'https', host: 'secure.proxy', port: 443 },
      { kind: 'socks4', host: 's', port: 1080 },
      { kind: 'socks5', host: '::1', port: 1081 },
      { kind: 'direct' },
    ]);
    expect(hopsOf('QUIC proxy:443; PROXY nowhere; PROXY a:0; ')).toEqual([]);
  });
});

it('writes go the way that sends them once, and reads the usual way', async () => {
  const reads = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('read')));
  const sending = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response('write')));
  const routed = writesOnce(reads, sending);

  await routed('https://api.github.com/graphql', { method: 'POST', once: true } as FetchInit);
  await routed('https://api.github.com/graphql', { method: 'POST' });
  await routed('https://api.github.com/user');

  expect(sending.mock.calls.map(([, init]) => init?.method)).toEqual(['POST']);
  expect(reads).toHaveBeenCalledTimes(2);
});
