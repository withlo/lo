// Main's writes to GitHub, sent at most once, over Node's own HTTP client.
//
// Chromium's network stack, which every other request takes (`fetch.ts`), sends a request again by
// itself, whatever its method, when the kept-alive connection it reused drops before any of the
// answer comes, and on some HTTP/2 failures: a comment would post twice. Node's HTTP client sends
// a request once, and says when its connection dropped. So a write (a request whose `init` says
// `once`) opens a connection of its own, closed once it's answered, through the proxy Chromium
// takes for the address (its answer from `session.resolveProxy`), trusting the system's
// certificate authorities and Node's own, and nothing else.

import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, getCACertificates } from 'node:tls';

import type { FetchInit } from '@lo/github';

import { UPLOAD_PROGRESS_EVERY } from './fetch.ts';

/** A way to the server: straight there, or through a proxy of a kind Chromium names. */
export type Hop =
  | { readonly kind: 'direct' }
  | {
      readonly kind: 'http' | 'https' | 'socks4' | 'socks5';
      readonly host: string;
      readonly port: number;
    };

/** Each kind of proxy Chromium names that a write can go through. */
const HOP_KINDS: Readonly<Record<string, 'http' | 'https' | 'socks4' | 'socks5'>> = {
  PROXY: 'http',
  HTTPS: 'https',
  SOCKS: 'socks4',
  SOCKS4: 'socks4',
  SOCKS5: 'socks5',
};

/**
 * The ways Chromium's answer for an address, such as `PROXY proxy:3128; DIRECT`, names, in its
 * order, leaving out any a write can't take, such as a QUIC proxy.
 */
export function hopsOf(answer: string): Hop[] {
  const hops: Hop[] = [];
  for (const entry of answer.split(';')) {
    const [word = '', address = '', ...rest] = entry.trim().split(/\s+/);
    const kind = word.toUpperCase();
    if (kind === 'DIRECT' && address === '') {
      hops.push({ kind: 'direct' });
      continue;
    }
    const hop = Object.hasOwn(HOP_KINDS, kind) ? HOP_KINDS[kind] : undefined;
    const parsed = /^(?:\[([0-9a-fA-F:.]+)\]|([^\s/@:[\]]+)):(\d{1,5})$/.exec(address);
    const port = Number(parsed?.[3]);
    if (hop === undefined || !parsed || rest.length > 0 || port < 1 || port > 65535) continue;
    hops.push({ kind: hop, host: parsed[1] ?? parsed[2] ?? '', port });
  }
  return hops;
}

let trusted: readonly string[] | undefined;

/** The certificate authorities a write trusts: the system's, and those Node carries. */
export function authorities(): readonly string[] {
  trusted ??= [...new Set([...getCACertificates('bundled'), ...getCACertificates('system')])];
  return trusted;
}

export interface OnceOptions {
  /** Chromium's answer for the way a request to `address` goes, as `session.resolveProxy` says. */
  readonly proxy: (address: string) => Promise<string>;
  /** The certificate authorities to trust, as PEM. */
  readonly ca: () => readonly string[];
}

/** Statuses whose answer has no body. */
const NO_BODY: ReadonlySet<number> = new Set([204, 205, 304]);

/** How much of a body goes to the connection at a time, so an upload's progress can be told. */
const CHUNK = 64 * 1024;

/**
 * A `fetch` that sends each request once, never again by itself, over a connection of its own,
 * and reads the whole answer before resolving. It follows no redirect: one is the answer. A request
 * given up through its signal is cancelled, and fails with the signal's reason. When its connection
 * drops after the request went, it fails as Node says (`ECONNRESET`), which GitHub's client counts
 * as an answer lost. One whose `init` has an `uploadProgress` hears how much of its body has gone
 * every {@link UPLOAD_PROGRESS_EVERY} ms while that changes, and once more as the answer starts.
 */
export function onceFetch(options: OnceOptions): typeof globalThis.fetch {
  return async (input, init?: FetchInit) => {
    const asked = new Request(input, init);
    const { signal } = asked;
    signal.throwIfAborted();
    const url = new URL(asked.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new TypeError(`Lo sends writes only over https and http, not ${url.protocol}`);
    }
    const body = asked.body === null ? undefined : Buffer.from(await asked.arrayBuffer());
    const headers: Record<string, string> = {};
    asked.headers.forEach((value, name) => {
      headers[name] = value;
    });
    headers['host'] = url.host;
    headers['connection'] = 'close';
    if (body !== undefined || !['GET', 'HEAD'].includes(asked.method)) {
      headers['content-length'] = String(body?.length ?? 0);
    }
    const socket = await connected(url, options, signal);
    if (signal.aborted) socket.destroy();
    signal.throwIfAborted();
    return exchange(socket, asked.method, url, headers, body, signal, init?.uploadProgress);
  };
}

/**
 * Sends the requests whose `init` says `once`, writes, through `writes`, and the rest through
 * `reads`.
 */
export function writesOnce(
  reads: typeof globalThis.fetch,
  writes: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return (input, init?: FetchInit) =>
    init?.once === true ? writes(input, init) : reads(input, init);
}

/** The server's host, as a socket connects to it: an IPv6 address without its brackets. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

function portOf(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * A connection to `url`'s server, ready for the request: through the first of the ways Chromium
 * names that connects, and, for https, with TLS made with it. A way that fails is left for the next
 * only while nothing has gone to the server.
 */
async function connected(url: URL, options: OnceOptions, signal: AbortSignal): Promise<Socket> {
  const hops = hopsOf(await options.proxy(url.href));
  signal.throwIfAborted();
  if (hops.length === 0) {
    throw new Error('net::ERR_NO_SUPPORTED_PROXIES: no proxy Lo can send a write through');
  }
  const host = hostOf(url);
  const port = portOf(url);
  let failed: unknown;
  for (const hop of hops) {
    let socket: Socket;
    try {
      socket = await reach(hop, host, port, options, signal);
    } catch (error) {
      signal.throwIfAborted();
      failed = error;
      continue;
    }
    if (url.protocol === 'http:') return socket;
    return secured(socket, host, options, signal);
  }
  throw failed instanceof Error ? failed : new Error(String(failed));
}

/** Runs `step` on `socket`, destroying it when the step fails or `signal` gives up. */
async function within<T>(socket: Socket, signal: AbortSignal, step: () => Promise<T>): Promise<T> {
  const giveUp = () => socket.destroy();
  signal.addEventListener('abort', giveUp, { once: true });
  try {
    signal.throwIfAborted();
    return await step();
  } catch (error) {
    socket.destroy();
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener('abort', giveUp);
  }
}

/** A connection that carries bytes to `host`'s `port`, the way `hop` says. */
async function reach(
  hop: Hop,
  host: string,
  port: number,
  options: OnceOptions,
  signal: AbortSignal,
): Promise<Socket> {
  if (hop.kind === 'direct') return opened(netConnect({ host, port }), signal);
  const toProxy =
    hop.kind === 'https'
      ? await secured(await opened(netConnect(hop), signal), hop.host, options, signal)
      : await opened(netConnect(hop), signal);
  return within(toProxy, signal, async () => {
    if (hop.kind === 'socks5') await socks5(toProxy, host, port);
    else if (hop.kind === 'socks4') await socks4(toProxy, host, port);
    else await tunnel(toProxy, host, port);
    return toProxy;
  });
}

/** `socket` once it has connected. */
function opened(socket: Socket, signal: AbortSignal): Promise<Socket> {
  return within(socket, signal, () => ready(socket, 'connect'));
}

/** TLS with `host` over `socket`, checked against the authorities the options trust. */
async function secured(
  socket: Socket,
  host: string,
  options: OnceOptions,
  signal: AbortSignal,
): Promise<Socket> {
  const secure = tlsConnect({
    socket,
    ...(isIP(host) === 0 ? { servername: host } : { host }),
    ca: [...options.ca()],
    ALPNProtocols: ['http/1.1'],
  });
  return within(secure, signal, () => ready(secure, 'secureConnect'));
}

/** Resolves with `socket` once it emits `event`, or rejects with its error, or as it closes. */
function ready(socket: Socket, event: 'connect' | 'secureConnect'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const done = () => {
      socket.off('error', failed);
      socket.off('close', closed);
      resolve(socket);
    };
    const failed = (error: Error) => {
      socket.off(event, done);
      socket.off('close', closed);
      reject(error);
    };
    const closed = () => failed(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }));
    socket.once(event, done);
    socket.once('error', failed);
    socket.once('close', closed);
  });
}

/** Fails as a tunnel the proxy wouldn't open, which nothing went through. */
function noTunnel(why: string): Error {
  return new Error(`unsuccessful tunnel: ${why}`);
}

/** Asks the HTTP proxy at the other end of `socket` for a tunnel to `host`'s `port`. */
async function tunnel(socket: Socket, host: string, port: number): Promise<void> {
  const authority = `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
  const head = await headOf(socket);
  const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1];
  if (status === '407') throw new Error('net::ERR_PROXY_AUTH_REQUESTED: the proxy asks who Lo is');
  if (status === undefined || !status.startsWith('2')) {
    throw noTunnel(`the proxy answered ${status ?? 'with something that isn’t HTTP'}`);
  }
}

/** The longest answer to `CONNECT` a proxy may give, headers and all. */
const HEAD_LIMIT = 64 * 1024;

/** What comes from `socket` up to the blank line after its headers; the rest is left in it. */
async function headOf(socket: Socket): Promise<string> {
  let held = Buffer.alloc(0);
  for (;;) {
    const end = held.indexOf('\r\n\r\n');
    if (end >= 0) {
      if (end + 4 < held.length) socket.unshift(held.subarray(end + 4));
      return held.subarray(0, end).toString('latin1');
    }
    if (held.length > HEAD_LIMIT) throw noTunnel('the proxy’s answer has no end');
    held = Buffer.concat([held, await chunkOf(socket)]);
  }
}

/** Exactly `count` bytes from `socket`. */
async function bytesOf(socket: Socket, count: number): Promise<Buffer> {
  let held = Buffer.alloc(0);
  while (held.length < count) held = Buffer.concat([held, await chunkOf(socket)]);
  if (held.length > count) socket.unshift(held.subarray(count));
  return held.subarray(0, count);
}

/** The next bytes `socket` has, once it has some. */
function chunkOf(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const take = () => {
      const chunk: unknown = socket.read();
      if (chunk === null) return;
      stop();
      if (Buffer.isBuffer(chunk)) resolve(chunk);
      else reject(noTunnel('the proxy’s answer isn’t bytes'));
    };
    const failed = (error: Error) => {
      stop();
      reject(error);
    };
    const ended = () => failed(noTunnel('the proxy closed the connection'));
    const stop = () => {
      socket.off('readable', take);
      socket.off('error', failed);
      socket.off('end', ended);
      socket.off('close', ended);
    };
    socket.on('readable', take);
    socket.once('error', failed);
    socket.once('end', ended);
    socket.once('close', ended);
    take();
  });
}

/** Asks the SOCKS5 proxy at the other end of `socket` to connect to `host`'s `port`, by name. */
async function socks5(socket: Socket, host: string, port: number): Promise<void> {
  socket.write(Buffer.from([5, 1, 0]));
  const [version, method] = await bytesOf(socket, 2);
  if (version !== 5 || method !== 0) throw noTunnel('the SOCKS proxy wants a way to sign in');
  const family = isIP(host);
  const address =
    family === 4
      ? Buffer.from([1, ...host.split('.').map(Number)])
      : family === 6
        ? Buffer.concat([Buffer.from([4]), ipv6(host)])
        : Buffer.concat([Buffer.from([3, Buffer.byteLength(host)]), Buffer.from(host)]);
  if (family === 0 && Buffer.byteLength(host) > 255) throw noTunnel('the name is too long');
  socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, portBytes(port)]));
  const [, reply, , type] = await bytesOf(socket, 4);
  if (reply !== 0) throw noTunnel(`the SOCKS proxy refused, with ${reply ?? 'nothing'}`);
  const bound =
    type === 1 ? 4 : type === 4 ? 16 : type === 3 ? ((await bytesOf(socket, 1))[0] ?? 0) : -1;
  if (bound < 0) throw noTunnel('the SOCKS proxy answered with an address Lo doesn’t know');
  await bytesOf(socket, bound + 2);
}

/**
 * Asks the SOCKS4 proxy at the other end of `socket` to connect to `host`'s `port`, at the IPv4
 * address it has, as Chromium does.
 */
async function socks4(socket: Socket, host: string, port: number): Promise<void> {
  const ip = isIP(host) === 4 ? host : (await lookup(host, { family: 4 })).address;
  socket.write(Buffer.from([4, 1, ...portBytes(port), ...ip.split('.').map(Number), 0]));
  const [, reply] = await bytesOf(socket, 8);
  if (reply !== 0x5a) throw noTunnel(`the SOCKS proxy refused, with ${reply ?? 'nothing'}`);
}

function portBytes(port: number): Buffer {
  return Buffer.from([port >> 8, port & 0xff]);
}

/** The groups of part of an IPv6 address, written with colons between them. */
function groupsOf(part: string): string[] {
  return part === '' ? [] : part.split(':');
}

/** An IPv6 address's 16 bytes. */
function ipv6(address: string): Buffer {
  const [head = '', tail] = address.split('::');
  const front = groupsOf(head);
  const back = tail === undefined ? [] : groupsOf(tail);
  const middle = Array.from({ length: 8 - front.length - back.length }, () => '0');
  const bytes = Buffer.alloc(16);
  [...front, ...middle, ...back].forEach((group, at) =>
    bytes.writeUInt16BE(parseInt(group, 16), at * 2),
  );
  return bytes;
}

/**
 * Sends the request over `socket`, once, and reads its whole answer. The socket is closed after,
 * or as soon as the request fails or is given up.
 */
function exchange(
  socket: Socket,
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: Buffer | undefined,
  signal: AbortSignal,
  uploadProgress: ((sent: number, total: number) => void) | undefined,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let sent = 0;
    let heard: number | undefined;
    const report = () => {
      if (!uploadProgress || body === undefined || heard === sent) return;
      heard = sent;
      try {
        uploadProgress(sent, body.length);
      } catch {
        // Whoever listens can't stop the request.
      }
    };
    const timer = uploadProgress ? setInterval(report, UPLOAD_PROGRESS_EVERY) : undefined;
    const finish = () => {
      settled = true;
      clearInterval(timer);
      signal.removeEventListener('abort', cancel);
      socket.destroy();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      finish();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const cancel = () => {
      sending.destroy();
      fail(signal.reason);
    };
    const sending = httpRequest({
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      setHost: false,
      createConnection: () => socket,
    });
    signal.addEventListener('abort', cancel, { once: true });
    sending.on('error', fail);
    sending.on('response', (answer: IncomingMessage) => {
      report();
      clearInterval(timer);
      const chunks: Buffer[] = [];
      answer.on('data', (chunk: Buffer) => chunks.push(chunk));
      answer.on('error', fail);
      answer.on('aborted', () =>
        fail(Object.assign(new Error('the connection closed mid-answer'), { code: 'ECONNRESET' })),
      );
      answer.on('end', () => {
        if (settled) return;
        const status = answer.statusCode ?? 0;
        const answered = new Headers();
        for (let at = 0; at + 1 < answer.rawHeaders.length; at += 2) {
          answered.append(answer.rawHeaders[at] ?? '', answer.rawHeaders[at + 1] ?? '');
        }
        finish();
        try {
          resolve(
            new Response(NO_BODY.has(status) ? null : Buffer.concat(chunks), {
              status,
              statusText: answer.statusMessage ?? '',
              headers: answered,
            }),
          );
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
    void (async () => {
      const whole = body ?? Buffer.alloc(0);
      for (let at = 0; at < whole.length; at += CHUNK) {
        if (settled) return;
        const chunk = whole.subarray(at, at + CHUNK);
        await new Promise<void>((done) => {
          if (!sending.write(chunk, () => done())) sending.once('drain', () => done());
        });
        sent += chunk.length;
      }
      if (!settled) sending.end();
    })().catch(fail);
  });
}
