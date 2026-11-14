// Main's writes to GitHub, sent at most once, over Node's HTTP stack (undici).
//
// Chromium's network stack, which every read takes (`fetch.ts`), sends a request again by itself,
// whatever its method, when the kept-alive connection it reused drops before any of the answer
// comes: a comment would post twice. undici never sends a request again once it has gone, and says
// when its connection dropped. Each write gets a dispatcher of its own, for one HTTP/1.1 connection
// that's closed once the write is answered, so it never goes on a connection that may already be
// dead. It takes the way Chromium names first for the address (`session.resolveProxy`), so it
// follows the same proxy settings, PAC included, as reads, and never another: a proxy that fails
// stops the write.

import { Readable } from 'node:stream';
import { getCACertificates } from 'node:tls';

import type { FetchInit } from '@lo/github';
import { Agent, ProxyAgent, request, type Dispatcher } from 'undici';

import { UPLOAD_PROGRESS_EVERY } from './fetch.ts';

/** The first way Chromium names for an address: straight there, a proxy, or one Lo can't take. */
export type Route =
  | { readonly kind: 'direct' }
  | { readonly kind: 'proxy'; readonly uri: string; readonly shown: string }
  | { readonly kind: 'unsupported'; readonly shown: string };

/** The proxies Chromium names that a write can go through, as the URL scheme for each. */
const SCHEMES: Readonly<Record<string, string>> = {
  PROXY: 'http',
  HTTPS: 'https',
  SOCKS5: 'socks5',
};

/**
 * The first way Chromium's answer for an address, such as `PROXY proxy:3128; DIRECT`, names. Only
 * the first: when a proxy fails, a write stops rather than go another way. A SOCKS4 or QUIC proxy
 * is one Lo can't take.
 */
export function routeOf(answer: string): Route {
  const first = answer.split(';')[0]?.trim() ?? '';
  const [scheme = '', address = '', ...rest] = first.split(/\s+/);
  if (scheme === 'DIRECT' && address === '') return { kind: 'direct' };
  const shown = first === '' ? 'no way at all' : first;
  const protocol = Object.hasOwn(SCHEMES, scheme) ? SCHEMES[scheme] : undefined;
  const hostAndPort = /^(?:\[[0-9a-fA-F:.]+\]|[^\s/@:[\]]+):\d{1,5}$/.test(address);
  const uri = protocol && hostAndPort ? URL.parse(`${protocol}://${address}`) : null;
  if (uri === null || rest.length > 0) return { kind: 'unsupported', shown };
  return { kind: 'proxy', uri: uri.href, shown: address };
}

let trusted: readonly string[] | undefined;

/**
 * The certificate authorities a write trusts: those Node's `--use-system-ca` does, which are
 * Node's bundled roots, any `NODE_EXTRA_CA_CERTS` names, and the ones the system trusts that Node
 * reads (on macOS, those the keychain's trust settings mark trusted).
 */
export function authorities(): readonly string[] {
  trusted ??= [...new Set([...getCACertificates('default'), ...getCACertificates('system')])];
  return trusted;
}

export interface OnceOptions {
  /** Chromium's answer for the way a request to `address` goes, as `session.resolveProxy` says. */
  readonly proxy: (address: string) => Promise<string>;
  /** The certificate authorities to trust, as PEM. */
  readonly ca: () => readonly string[];
}

/** A write a proxy stopped before it went to GitHub, with a code GitHub's client classifies. */
export class ProxyStopped extends Error {
  override name = 'ProxyStopped';
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** Statuses whose answer has no body. */
const NO_BODY: ReadonlySet<number> = new Set([204, 205, 304]);

/** How much of a body goes to undici at a time, so an upload's progress can be told. */
const CHUNK = 64 * 1024;

/**
 * A `fetch` that sends each request once, never again by itself, and reads the whole answer before
 * resolving. It follows no redirect: one is the answer. A request given up through its signal is
 * cancelled, and fails with the signal's reason. When its connection drops after the request went,
 * it fails as undici says (`UND_ERR_SOCKET`), which GitHub's client counts as an answer lost. One
 * whose `init` has an `uploadProgress` hears how much of its body has gone every
 * {@link UPLOAD_PROGRESS_EVERY} ms while that changes, and once more as the answer starts, and one
 * with an `answerBegan` hears as the answer starts.
 */
export function onceFetch(options: OnceOptions): typeof globalThis.fetch {
  return async (input, init?: FetchInit) => {
    const asked = new Request(input, init);
    const { signal } = asked;
    signal.throwIfAborted();
    const body = asked.body === null ? undefined : Buffer.from(await asked.arrayBuffer());
    const route = routeOf(await options.proxy(asked.url));
    signal.throwIfAborted();
    if (route.kind === 'unsupported') {
      throw new ProxyStopped(
        `Your proxy settings name ${route.shown} for GitHub. Lo sends a change to GitHub only directly or through an HTTP, HTTPS or SOCKS5 proxy, so nothing was sent.`,
        'ERR_NO_SUPPORTED_PROXIES',
      );
    }
    const headers: Record<string, string> = {};
    asked.headers.forEach((value, name) => {
      headers[name] = value;
    });
    if (body !== undefined) headers['content-length'] = String(body.length);
    const tls = { ca: [...options.ca()], rejectUnauthorized: true };
    // One HTTP/1.1 connection, for this write alone.
    const dispatcher: Dispatcher =
      route.kind === 'direct'
        ? new Agent({ connect: tls, allowH2: false, connections: 1 })
        : new ProxyAgent({
            uri: route.uri,
            requestTls: tls,
            // Only for an HTTPS proxy: given it, undici would speak TLS to a SOCKS5 proxy too.
            ...(route.uri.startsWith('https:') ? { proxyTls: tls } : {}),
            allowH2: false,
            connections: 1,
          });
    const listener = init?.uploadProgress;
    const progress = listener && body ? reportProgress(body.length, listener) : undefined;
    try {
      const answer = await request(asked.url, {
        dispatcher,
        method: asked.method,
        headers,
        body: progress && body ? progress.chunks(body) : body,
        signal,
      }).catch((error: unknown) => {
        throw route.kind === 'proxy' ? stopped(error, route.shown) : error;
      });
      progress?.report();
      progress?.stop();
      try {
        init?.answerBegan?.();
      } catch {
        // Whoever listens can't stop the request.
      }
      const bytes = Buffer.from(await answer.body.arrayBuffer());
      const answered = new Headers();
      for (const [name, values] of Object.entries(answer.headers)) {
        for (const value of typeof values === 'string' ? [values] : (values ?? [])) {
          answered.append(name, value);
        }
      }
      return new Response(NO_BODY.has(answer.statusCode) ? null : bytes, {
        status: answer.statusCode,
        statusText: answer.statusText,
        headers: answered,
      });
    } finally {
      progress?.stop();
      void dispatcher.destroy().catch(() => undefined);
    }
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

/**
 * What `error`, from a write through the proxy `shown`, says when the proxy stopped the write
 * before it went: the proxy asked Lo to sign in, wouldn't connect to GitHub, or couldn't be
 * reached. Anything else is as undici said.
 */
function stopped(error: unknown, shown: string): unknown {
  const said = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  const code = typeof said === 'string' ? said : '';
  // A proxy's answer to `CONNECT`, or its refusal of a request for an `http` address it forwards.
  const answered = /^Proxy (?:response|Authentication Required) \((\d{3})\)/.exec(
    error instanceof Error ? error.message : '',
  );
  const status = answered?.[1];
  if (status === '407' || code.startsWith('UND_ERR_SOCKS5_AUTH')) {
    return new ProxyStopped(
      `The proxy ${shown} asks Lo to sign in, which Lo can't do, so nothing was sent to GitHub.`,
      'ERR_PROXY_AUTH_REQUESTED',
    );
  }
  if (status !== undefined || code === 'UND_ERR_PRX_CONN' || code.startsWith('UND_ERR_SOCKS5_')) {
    const why = status === undefined ? '' : ` (it answered ${status})`;
    return new ProxyStopped(
      `The proxy ${shown} didn't connect Lo to GitHub${why}, so nothing was sent.`,
      'ERR_TUNNEL_CONNECTION_FAILED',
    );
  }
  // A connection that never opened, through a proxy, is the proxy's.
  if (
    /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|E\w+UNREACH|ENETDOWN|UND_ERR_CONNECT_TIMEOUT)$/.test(code)
  ) {
    return new ProxyStopped(
      `Lo couldn't reach the proxy ${shown} (${code}), so nothing was sent to GitHub.`,
      code,
    );
  }
  return error;
}

/**
 * Hands a body to undici a chunk at a time, telling `listener` how much has gone every
 * {@link UPLOAD_PROGRESS_EVERY} ms while that changes, until stopped. `report` reports it now.
 */
function reportProgress(
  total: number,
  listener: (sent: number, total: number) => void,
): { chunks(body: Buffer): Readable; report(): void; stop(): void } {
  let sent = 0;
  let heard: number | undefined;
  const report = () => {
    if (heard === sent) return;
    heard = sent;
    try {
      listener(sent, total);
    } catch {
      // Whoever listens can't stop the request.
    }
  };
  const timer = setInterval(report, UPLOAD_PROGRESS_EVERY);
  return {
    chunks: (body) =>
      Readable.from(
        (function* () {
          for (let at = 0; at < body.length; at += CHUNK) {
            const chunk = body.subarray(at, at + CHUNK);
            yield chunk;
            sent += chunk.length;
          }
        })(),
        { objectMode: false },
      ),
    report,
    stop: () => clearInterval(timer),
  };
}
