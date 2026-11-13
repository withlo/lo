// Main's own requests, such as every request to GitHub, as a `fetch` over Chromium's network stack
// (Electron's `net.request`), so they take the system's proxy as a browser would.
//
// Electron's `net.fetch` won't do for GitHub: given `redirect: 'manual'`, it fails a redirect
// ("Redirect was cancelled") instead of answering with it, and GitHub's client follows redirects
// itself, only to where the token may go. So a redirect asked for that way is the answer here.
// Nothing is kept in Chromium's HTTP cache, where GitHub's answers about private repositories
// would sit on disk, and no cookie is sent or kept.

import type { ClientRequestConstructorOptions } from 'electron';

/** What Lo uses of an answer Electron's `net.request` gets: its `IncomingMessage`. */
export interface NetAnswer {
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: Record<string, string | string[]>;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'aborted', listener: () => void): unknown;
}

/** What Lo uses of a request Electron's `net.request` makes: its `ClientRequest`. */
export interface NetRequest {
  on(event: 'response', listener: (answer: NetAnswer) => void): unknown;
  on(
    event: 'redirect',
    listener: (
      status: number,
      method: string,
      location: string,
      headers: Record<string, string[]>,
    ) => void,
  ): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  write(chunk: Buffer): unknown;
  end(): unknown;
  abort(): void;
}

/** Statuses whose answer has no body. */
const NO_BODY: ReadonlySet<number> = new Set([101, 103, 204, 205, 304]);

/** Thrown when an answer's body is longer than the `limit` a `netFetch` reads. */
export class AnswerTooLarge extends Error {
  override name = 'AnswerTooLarge';
}

/**
 * A `fetch` that sends each request through `request` (Electron's `net.request`) and reads the
 * whole answer before resolving. A request given up through its signal is cancelled, and fails
 * with the signal's reason. With a `limit`, an answer whose body says it's longer, or turns out to
 * be, is cancelled as soon as it does, and fails with {@link AnswerTooLarge}, so no more than that
 * is ever kept.
 */
export function netFetch(
  request: (options: ClientRequestConstructorOptions) => NetRequest,
  options: { limit?: number | undefined } = {},
): typeof globalThis.fetch {
  const { limit = Infinity } = options;
  return async (input, init) => {
    const asked = new Request(input, init);
    const { signal } = asked;
    signal.throwIfAborted();
    const body = asked.body === null ? undefined : Buffer.from(await asked.arrayBuffer());
    const headers: Record<string, string> = {};
    asked.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const sent = request({
        method: asked.method,
        url: asked.url,
        headers,
        redirect: asked.redirect,
        cache: 'no-store',
        credentials: 'omit',
        useSessionCookies: false,
      });
      const settle = (answer: () => Response) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        try {
          resolve(answer());
        } catch (error) {
          reject(asError(error));
        }
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        reject(asError(error));
      };
      const cancel = () => {
        fail(signal.reason);
        sent.abort();
      };
      signal.addEventListener('abort', cancel, { once: true });

      // Asked for manually, the redirect is the answer, and goes no further. Otherwise Electron
      // only says it's following one.
      sent.on('redirect', (status, _method, location, redirectHeaders) => {
        if (asked.redirect !== 'manual') return;
        settle(() => {
          const answered = headersOf(redirectHeaders);
          answered.set('location', location);
          return new Response(null, { status, headers: answered });
        });
        sent.abort();
      });
      const tooLarge = () => {
        fail(new AnswerTooLarge(`The answer is longer than ${limit} bytes.`));
        sent.abort();
      };
      sent.on('response', (answer) => {
        const chunks: Buffer[] = [];
        let received = 0;
        if (Number(headersOf(answer.headers).get('content-length') ?? 0) > limit) {
          tooLarge();
          return;
        }
        answer.on('data', (chunk) => {
          if (settled) return;
          received += chunk.length;
          if (received > limit) tooLarge();
          else chunks.push(chunk);
        });
        answer.on('error', fail);
        answer.on('aborted', () => fail(new Error('net::ERR_CONNECTION_CLOSED')));
        answer.on('end', () =>
          settle(
            () =>
              new Response(NO_BODY.has(answer.statusCode) ? null : Buffer.concat(chunks), {
                status: answer.statusCode,
                statusText: answer.statusMessage,
                headers: headersOf(answer.headers),
              }),
          ),
        );
      });
      sent.on('error', fail);
      if (body !== undefined) sent.write(body);
      sent.end();
    });
  };
}

/** What was thrown, as an `Error`: a signal's reason, such as a `TimeoutError`, already is one. */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

function headersOf(given: Readonly<Record<string, string | readonly string[]>>): Headers {
  const headers = new Headers();
  for (const [name, values] of Object.entries(given)) {
    for (const value of typeof values === 'string' ? [values] : values) {
      headers.append(name, value);
    }
  }
  return headers;
}
