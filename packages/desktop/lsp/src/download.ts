/**
 * Fetching one file of a download, to a new file of Lo's, hashing it as it comes.
 *
 * - Only `https`, on its usual port, to the entry's hosts by exact name. Lo follows redirects
 *   itself, at most {@link REDIRECTS}, and holds every hop to the same rules, so a redirect can't
 *   take a download elsewhere.
 * - Nothing of Lo's goes with it: no token, no cookie, no header of Lo's choosing. In the app the
 *   `fetch` is Chromium's (`net.request`), which takes the system's proxy and keeps nothing in its
 *   cache.
 * - It stops as soon as more comes than may: the size the manifest pinned, when it's known.
 * - What arrives is only written to the file, never run or unpacked here: the caller checks the
 *   size and hash this returns before anything else reads it.
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import { DownloadError } from './errors.ts';
import { isDownloadAddress } from './manifest.ts';

/** The most redirects a download follows. */
export const REDIRECTS = 5;

/** Statuses that send a request on to a `Location`. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Statuses worth asking again for: the server's trouble, or a wait it asked for. */
const TRY_AGAIN_STATUSES: ReadonlySet<number> = new Set([408, 425, 429]);

export interface FetchOptions {
  /** Sends one request and gives its answer, without following a redirect. */
  readonly fetch: typeof globalThis.fetch;
  /** The hosts the file and its redirects may come from. */
  readonly hosts: readonly string[];
  /** The most bytes the file may hold. */
  readonly limit: number;
  readonly signal?: AbortSignal | undefined;
  /** Hears how many bytes of the file have come so far, as they come. */
  readonly received?: ((bytes: number) => void) | undefined;
}

/** What came: its size, and its SHA-256 in lowercase hex. */
export interface Fetched {
  readonly size: number;
  readonly sha256: string;
}

/**
 * Fetches `url` into `file`, which this creates and must not exist, and says what came. It throws
 * a {@link DownloadError}: `refused` for an address or redirect Lo doesn't download from, or more
 * than `limit`; `unavailable` for an answer that isn't the file; `interrupted` when the
 * connection failed or the file came short, which is worth trying again. Once `signal` aborts,
 * it stops and throws the signal's reason. It leaves `file` as far as it got; the caller removes
 * it.
 */
export async function fetchFile(
  url: string,
  file: string,
  options: FetchOptions,
): Promise<Fetched> {
  const { signal } = options;
  signal?.throwIfAborted();
  const answer = await follow(url, options);
  const declared = declaredLength(answer);
  if (declared !== undefined && declared > options.limit) {
    await answer.body?.cancel().catch(() => undefined);
    throw tooLarge(options.limit);
  }
  const body = answer.body;
  if (body === null) throw new DownloadError('interrupted', 'The download came without a body.');
  const hash = createHash('sha256');
  const out = await open(file, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of readChunks(body, signal)) {
      size += chunk.byteLength;
      if (size > options.limit) throw tooLarge(options.limit);
      hash.update(chunk);
      await out.write(chunk);
      options.received?.(size);
    }
  } catch (error) {
    await body.cancel().catch(() => undefined);
    throw signal?.aborted ? signal.reason : asDownloadError(error);
  } finally {
    await out.close();
  }
  if (declared !== undefined && size !== declared) {
    throw new DownloadError('interrupted', `The download stopped at ${size} of ${declared} bytes.`);
  }
  return { size, sha256: hash.digest('hex') };
}

/**
 * Asks for `url`, and for each redirect's `Location` in turn, each held to the rules, until an
 * answer that isn't a redirect, which must be the file.
 */
async function follow(url: string, options: FetchOptions): Promise<Response> {
  const { signal } = options;
  let at = checked(url, options.hosts);
  for (let hops = 0; ; hops += 1) {
    let answer: Response;
    try {
      answer = await options.fetch(at.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal,
      });
    } catch (error) {
      throw signal?.aborted ? signal.reason : asDownloadError(error);
    }
    if (answer.status === 200) return answer;
    await answer.body?.cancel().catch(() => undefined);
    if (!REDIRECT_STATUSES.has(answer.status)) throw unavailable(answer.status);
    if (hops === REDIRECTS) {
      throw new DownloadError('refused', `The download redirected more than ${REDIRECTS} times.`);
    }
    const location = answer.headers.get('location');
    if (location === null) throw unavailable(answer.status);
    const next = URL.parse(location, at.href);
    if (next === null) {
      throw new DownloadError('refused', 'The download redirected to an address Lo can’t read.');
    }
    // A fragment never reaches the server.
    next.hash = '';
    at = checked(next.href, options.hosts);
  }
}

/** `href` as a URL, if Lo may download from it, else a refusal saying why. */
function checked(href: string, hosts: readonly string[]): URL {
  const url = URL.parse(href);
  if (url === null || !isDownloadAddress(href)) {
    const shown = url === null ? 'an address Lo can’t read' : `${url.protocol}//${url.host}`;
    throw new DownloadError(
      'refused',
      `The download went to ${shown}. Lo downloads only over https, on its usual port.`,
    );
  }
  if (!hosts.includes(url.hostname)) {
    throw new DownloadError(
      'refused',
      `The download went to ${url.hostname}, which isn’t one of the hosts Lo downloads it from.`,
    );
  }
  return url;
}

/** The length the answer says its body has, when it's of the bytes as sent. */
function declaredLength(answer: Response): number | undefined {
  const encoding = answer.headers.get('content-encoding');
  if (encoding !== null && encoding !== 'identity') return undefined;
  const length = answer.headers.get('content-length');
  if (length === null || !/^\d+$/.test(length)) return undefined;
  return Number(length);
}

/** The body's chunks, until it ends or `signal` aborts. */
async function* readChunks(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  const stop = () => {
    reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      // A cancelled body ends rather than fails.
      signal?.throwIfAborted();
      if (done) return;
      yield value;
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}

function tooLarge(limit: number): DownloadError {
  return new DownloadError(
    'refused',
    `The download was larger than the ${limit} bytes it should be.`,
  );
}

function unavailable(status: number): DownloadError {
  const again = status >= 500 || TRY_AGAIN_STATUSES.has(status);
  return new DownloadError(
    again ? 'interrupted' : 'unavailable',
    `The download’s server answered ${status}.`,
  );
}

/** A failure of the connection, as one worth trying again, unless it's already Lo's own. */
function asDownloadError(error: unknown): DownloadError {
  if (error instanceof DownloadError) return error;
  const why = error instanceof Error ? error.message : String(error);
  return new DownloadError('interrupted', `The download failed (${why}).`, { cause: error });
}
