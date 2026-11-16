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
 * - It gives up, as a try that was cut short, once nothing at all has come for 30 s, or less than
 *   16 KB in any 5 minutes, of the time Lo waits for the network ({@link STALL}). So a host that
 *   stops sending, or sends a byte now and then, can't hold up the tries after it, while a proxy
 *   that sends a byte every few seconds as it scans the file has 5 minutes to finish. An answer's
 *   headers come whole, so each answer must begin within 30 s of being asked for, and both counts
 *   start again from it. There's no deadline for the whole file, which can be hundreds of
 *   megabytes on a slow connection.
 * - What arrives is only written to the file, never run or unpacked here: the caller checks the
 *   size and hash this returns before anything else reads it.
 */

import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import { DownloadError } from './errors.ts';
import { isDownloadAddress } from './manifest.ts';

/** The most redirects a download follows. */
export const REDIRECTS = 5;

/** What counts as a download that has stalled, by the time it spends waiting for the network. */
export interface StallLimits {
  /** How long it may wait with nothing at all coming, in milliseconds. */
  readonly quiet: number;
  /** The time its rate is counted over, in milliseconds. */
  readonly window: number;
  /** The least it must bring in any {@link StallLimits.window}, in bytes. */
  readonly least: number;
}

/**
 * Nothing for 30 s, or less than 16 KB in any 5 minutes. 16 KB in 5 minutes is so slow that only a
 * connection that has all but stopped falls below it, and 5 minutes lets a proxy that holds a file
 * back while it scans it, sending a byte every few seconds meanwhile, finish.
 */
export const STALL: StallLimits = { quiet: 30_000, window: 5 * 60_000, least: 16 * 1024 };

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
  /** What counts as a stall: {@link STALL} unless given. */
  readonly stall?: StallLimits | undefined;
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
 * connection failed, stalled or the file came short, which is worth trying again. Once `signal`
 * aborts, it stops and throws the signal's reason. It leaves `file` as far as it got; the caller
 * removes it.
 */
export async function fetchFile(
  url: string,
  file: string,
  options: FetchOptions,
): Promise<Fetched> {
  options.signal?.throwIfAborted();
  const stall = new Stall(options.stall ?? STALL, options.signal);
  try {
    return await fetchWatched(url, file, { ...options, signal: stall.signal }, stall);
  } finally {
    stall.end();
  }
}

/** {@link fetchFile}, with `stall` watching each wait for the network. */
async function fetchWatched(
  url: string,
  file: string,
  options: FetchOptions,
  stall: Stall,
): Promise<Fetched> {
  const { signal } = options;
  const answer = await follow(url, options, stall);
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
    for await (const chunk of readChunks(body, signal, stall)) {
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
async function follow(url: string, options: FetchOptions, stall: Stall): Promise<Response> {
  const { signal } = options;
  let at = checked(url, options.hosts);
  for (let hops = 0; ; hops += 1) {
    let answer: Response;
    try {
      answer = await stall.watch(
        options.fetch(at.href, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal,
        }),
      );
    } catch (error) {
      throw signal?.aborted ? signal.reason : asDownloadError(error);
    }
    stall.answered();
    // A `fetch` that followed a redirect itself, whatever it was asked, went where Lo didn't
    // check.
    if (answer.redirected) {
      await answer.body?.cancel().catch(() => undefined);
      throw new DownloadError(
        'refused',
        'The download was redirected without Lo seeing where, so Lo didn’t use it.',
      );
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
  stall: Stall,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  const stop = () => {
    reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await stall.watch(reader.read());
      // A cancelled body ends rather than fails.
      signal?.throwIfAborted();
      if (done) return;
      stall.came(value.byteLength);
      yield value;
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    reader.releaseLock();
  }
}

/**
 * A watch on a download's waits for the network: once nothing at all has come for
 * {@link StallLimits.quiet}, or less than {@link StallLimits.least} in any
 * {@link StallLimits.window}, it aborts its {@link Stall.signal} with an `interrupted` error. Only
 * the time spent waiting counts, so Lo's own work between waits, such as writing what came, never
 * does. An answer's headers, which come whole, start both counts again.
 */
class Stall {
  /** Aborts once the caller's signal does, or once a wait has stalled. */
  readonly signal: AbortSignal;
  readonly #limits: StallLimits;
  readonly #controller = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** How long it has waited, in milliseconds, up to the end of the last wait. */
  #waited = 0;
  /** When the counts last started, in time waited. */
  #from = 0;
  /** When something last came, or the counts started, in time waited. */
  #last = 0;
  /**
   * What came, oldest first, each when its wait ended, in time waited: only the newest that
   * together reach `least`, since nothing older can be what keeps the download going.
   */
  #came: { readonly at: number; readonly bytes: number }[] = [];
  /** The bytes in {@link Stall.#came}. */
  #recent = 0;

  constructor(limits: StallLimits, signal: AbortSignal | undefined) {
    this.#limits = limits;
    this.signal =
      signal === undefined
        ? this.#controller.signal
        : AbortSignal.any([signal, this.#controller.signal]);
  }

  /** Counts `bytes` that the last wait brought. */
  came(bytes: number): void {
    if (bytes === 0) return;
    this.#last = this.#waited;
    this.#came.push({ at: this.#waited, bytes });
    this.#recent += bytes;
    // What's older than the newest that reach `least` no longer counts.
    let oldest = this.#came[0];
    while (
      oldest !== undefined &&
      this.#came.length > 1 &&
      this.#recent - oldest.bytes >= this.#limits.least
    ) {
      this.#came.shift();
      this.#recent -= oldest.bytes;
      oldest = this.#came[0];
    }
  }

  /** An answer has come, its headers whole: both counts start again. */
  answered(): void {
    this.#came = [];
    this.#recent = 0;
    this.#from = this.#waited;
    this.#last = this.#waited;
  }

  /**
   * Waits for `promise`, a wait for the network, under the watch: once it stalls, it throws, even
   * if whatever `promise` waits on never heard the signal.
   */
  async watch<T>(promise: Promise<T>): Promise<T> {
    const { promise: given, reject: stalled } = Promise.withResolvers<never>();
    const began = performance.now();
    const { quiet, slow } = this.#due();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => {
        const { quiet: ms, window, least } = this.#limits;
        const error = new DownloadError(
          'interrupted',
          quiet <= slow
            ? `The download stalled: nothing came for ${duration(ms)}.`
            : `The download stalled: less than ${least / 1024} KB came in ${duration(window)}.`,
        );
        this.#controller.abort(error);
        stalled(error);
      },
      Math.max(0, Math.min(quiet, slow) - this.#waited),
    );
    try {
      return await Promise.race([promise, given]);
    } finally {
      clearTimeout(this.#timer);
      this.#waited += performance.now() - began;
    }
  }

  /**
   * When, in time waited, the download stalls unless more comes: `quiet` after anything last came,
   * or, for its rate, once the oldest of what reaches `least` is `window` old, or `window` after the
   * counts started while nothing reaches it.
   */
  #due(): { readonly quiet: number; readonly slow: number } {
    const { quiet, window, least } = this.#limits;
    const oldest = this.#came[0];
    const slow =
      oldest === undefined || this.#recent < least ? this.#from + window : oldest.at + window;
    return { quiet: this.#last + quiet, slow };
  }

  /** Stops watching. */
  end(): void {
    clearTimeout(this.#timer);
  }
}

/** `ms` in words: minutes when it's whole minutes, else seconds. */
function duration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return `${(ms / 1000).toLocaleString('en-US')} s`;
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
