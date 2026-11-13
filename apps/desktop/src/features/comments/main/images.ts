// Images for the window, from GitHub's image hosts: a post's, by the address GitHub's rendering or
// the post's Markdown gives, and an account's avatar, by its login. The window asks for each on
// the image scheme (`ipc/images.ts`); main fetches it, checks that it's an image, and serves it.
//
// - **Where:** each request goes over `https` on the default port, with no user name, to one of
//   GitHub's image hosts (`imageAddress`), or for an avatar to `avatars.githubusercontent.com`,
//   following at most 5 redirects, each to the same list. GitHub's attachment store on S3 is
//   reached only as an attachment's redirect.
// - **The token** goes only to an attachment's address on github.com, which answers with a
//   redirect to its bytes at an address signed for a few minutes. Every other request, the
//   redirect's included, goes without it: signed and proxied addresses need none.
// - **What's served:** a PNG, JPEG, GIF or WebP image, by its first bytes alone, whose header gives
//   a size no browser balks at: 16 MiB at most, fetched within 30 s. Anything else fails.
// - **What's kept:** the bytes served last, 64 MiB at most, keyed by address without the signature
//   GitHub adds to a private image's, which changes with every read.

import { imageHeader, imageType, LIMITS, type ImageType } from '@lo/artifact';
import type { Token } from '@lo/github';
import { imageAddress } from '@lo/markdown';

import type { ImageAsked } from '../../../ipc/images.ts';

/** What a post's image or an avatar may be, and how much of them is kept. */
export interface ImageLimits {
  /** The most bytes an image may be. */
  bytes: number;
  /** The most pixels a side, as an overview's image figures. */
  side: number;
  /** The most pixels in all, width times height. */
  pixels: number;
  /** How long an image may take, its redirects and all, in milliseconds. */
  deadline: number;
  /** The most redirects an image may follow. */
  redirects: number;
  /** The most bytes of images kept to serve again. */
  kept: number;
  /** The most images fetched at once: the rest wait their turn, so no more is ever held. */
  fetching: number;
}

export const IMAGE_LIMITS: ImageLimits = {
  bytes: 16 * 1024 * 1024,
  side: LIMITS.side,
  pixels: LIMITS.pixels,
  deadline: 30_000,
  redirects: 5,
  kept: 64 * 1024 * 1024,
  fetching: 6,
};

/** Where avatars are, by login. */
export const AVATAR_HOST = 'avatars.githubusercontent.com';

/** Where an attachment's address on github.com redirects to: its bytes, at a signed address. */
export const ATTACHMENT_STORE = 'github-production-user-asset-6210df.s3.amazonaws.com';

/** An image checked and ready to serve. */
export interface LoadedImage {
  readonly type: ImageType;
  readonly contentType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

const CONTENT_TYPES: Readonly<Record<ImageType, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

/** What's asked for of an image host: only the types Lo serves. */
const ACCEPT = 'image/png, image/jpeg, image/gif, image/webp';

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Why an image wasn't served: `refused` for somewhere it may not come from, `failed` for a host
 * that couldn't be reached or didn't serve it, and `unsafe` for bytes that aren't an image Lo
 * serves. Its message names the host at most, never an address's query or a header.
 */
export class ImageError extends Error {
  override name = 'ImageError';
  readonly reason: 'refused' | 'failed' | 'unsafe';

  constructor(reason: 'refused' | 'failed' | 'unsafe', message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface ImagesOptions {
  /** The `fetch` images come through: main's, which keeps no cookie and nothing on disk. */
  fetch: typeof globalThis.fetch;
  /**
   * The token of the account view `view` acts as, read as each attachment's request starts, or
   * nothing for a view acting as nobody, or no such view.
   */
  token(view: string): Promise<Token | undefined>;
  /**
   * Where to send a request for `address`, on one of GitHub's image hosts: the address itself, or
   * in a test run, a stand-in for the host. Redirects are read against the host's own address.
   */
  route?: ((address: URL) => string) | undefined;
  limits?: Partial<ImageLimits> | undefined;
}

/** Fetches, checks and keeps the images the window asks for. */
export class Images {
  readonly #fetch: typeof globalThis.fetch;
  readonly #token: (view: string) => Promise<Token | undefined>;
  readonly #route: (address: URL) => string;
  readonly #limits: ImageLimits;
  /** The images kept, the one served last at the end. */
  readonly #kept = new Map<string, LoadedImage>();
  #keptBytes = 0;
  /** The images being fetched, or waiting their turn, so two asks at once fetch once. */
  readonly #loading = new Map<string, Promise<LoadedImage>>();
  /** How many images are being fetched now, and those waiting their turn, oldest first. */
  #fetching = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(options: ImagesOptions) {
    this.#fetch = options.fetch;
    this.#token = (view) => options.token(view);
    this.#route = options.route ?? ((address) => address.href);
    this.#limits = { ...IMAGE_LIMITS, ...options.limits };
  }

  /** The image `asked` asks for: kept, or fetched and checked. Throws an {@link ImageError}. */
  async load(asked: ImageAsked): Promise<LoadedImage> {
    const key = keyOf(asked);
    const kept = this.#kept.get(key);
    if (kept) {
      this.#kept.delete(key);
      this.#kept.set(key, kept);
      return kept;
    }
    let loading = this.#loading.get(key);
    if (!loading) {
      loading = this.#inTurn(() => this.#fetched(asked))
        .then((image) => {
          this.#keep(key, image);
          return image;
        })
        .finally(() => this.#loading.delete(key));
      this.#loading.set(key, loading);
    }
    return loading;
  }

  /** Runs `fetch` once fewer than the most images are being fetched. */
  async #inTurn<T>(fetch: () => Promise<T>): Promise<T> {
    // A turn that ends goes to the next waiting, so none starts out of turn meanwhile.
    if (this.#fetching < this.#limits.fetching) this.#fetching += 1;
    else await new Promise<void>((resolve) => this.#waiting.push(resolve));
    try {
      return await fetch();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#fetching -= 1;
    }
  }

  #keep(key: string, image: LoadedImage): void {
    if (image.bytes.length > this.#limits.kept) return;
    this.#kept.set(key, image);
    this.#keptBytes += image.bytes.length;
    for (const [oldest, { bytes }] of this.#kept) {
      if (this.#keptBytes <= this.#limits.kept) break;
      this.#kept.delete(oldest);
      this.#keptBytes -= bytes.length;
    }
  }

  async #fetched(asked: ImageAsked): Promise<LoadedImage> {
    const deadline = AbortSignal.timeout(this.#limits.deadline);
    let address = firstAddress(asked);
    let from: URL | undefined;
    for (let redirects = 0; ; redirects++) {
      if (!mayFetch(asked, address, from)) {
        throw new ImageError(
          'refused',
          from === undefined
            ? `${address.host} isn't one of GitHub's image hosts`
            : `${from.host} redirected to ${address.host}, which isn't one of GitHub's image hosts for it`,
        );
      }
      const response = await this.#request(asked, address, deadline);
      if (response.status !== 200) await response.body?.cancel();
      if (REDIRECTS.has(response.status)) {
        const location = response.headers.get('location');
        const next = location === null ? null : URL.parse(location, address.href);
        if (next === null) {
          throw new ImageError('failed', `${address.host} redirected nowhere Lo can read`);
        }
        if (redirects === this.#limits.redirects) {
          throw new ImageError(
            'refused',
            `${address.host} redirected more than ${redirects} times`,
          );
        }
        from = address;
        address = next;
        continue;
      }
      if (response.status !== 200) {
        throw new ImageError('failed', `${address.host} answered ${response.status}`);
      }
      return this.#checked(address, await this.#body(address, response, deadline));
    }
  }

  /** Asks for `address`, with the view's token only when it's an attachment's address. */
  async #request(asked: ImageAsked, address: URL, signal: AbortSignal): Promise<Response> {
    const token =
      asked.kind === 'post' && isAttachment(address) ? await this.#viewToken(asked) : undefined;
    let headers: Headers;
    try {
      headers = new Headers({ accept: ACCEPT });
      if (token !== undefined) headers.set('authorization', `token ${token.expose()}`);
    } catch {
      // What the header said would be in the error, and it may be the token, so the error is left
      // behind.
      throw new ImageError('failed', `Lo couldn't ask ${address.host} for it`);
    }
    try {
      return await this.#fetch(this.#route(address), {
        headers,
        redirect: 'manual',
        signal,
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      // Only what kind of failure it was: an error's message may say what was sent.
      throw new ImageError(
        'failed',
        isTimeout(error, signal)
          ? `it took longer than ${this.#limits.deadline / 1000} s`
          : `Lo couldn't reach ${address.host}`,
      );
    }
  }

  async #viewToken(asked: Extract<ImageAsked, { kind: 'post' }>): Promise<Token | undefined> {
    try {
      return await this.#token(asked.view);
    } catch {
      // An account that's signed out, or whose token can't be read just now, fetches as nobody,
      // which GitHub refuses for an attachment it hides.
      return undefined;
    }
  }

  /** The response's body, up to the most bytes an image may be. */
  async #body(
    address: URL,
    response: Response,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const limit = this.#limits.bytes;
    const tooLarge = () =>
      new ImageError('unsafe', `${address.host} served more than ${limit} bytes`);
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      const reader = response.body?.getReader();
      for (let read = await reader?.read(); read && !read.done; read = await reader?.read()) {
        length += read.value.length;
        if (length > limit) {
          await reader?.cancel();
          throw tooLarge();
        }
        chunks.push(read.value);
      }
    } catch (error) {
      if (error instanceof ImageError) throw error;
      throw new ImageError(
        'failed',
        isTimeout(error, signal)
          ? `it took longer than ${this.#limits.deadline / 1000} s`
          : `${address.host} stopped partway`,
      );
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return bytes;
  }

  /** `bytes` as an image Lo serves, by their header alone, or an error saying why not. */
  #checked(address: URL, bytes: Uint8Array<ArrayBuffer>): LoadedImage {
    const type = imageType(bytes);
    if (type === undefined) {
      throw new ImageError(
        'unsafe',
        `${address.host} served something other than a PNG, JPEG, GIF or WebP image`,
      );
    }
    const header = imageHeader(type, bytes, true);
    if (header.kind !== 'size') {
      throw new ImageError('unsafe', `${address.host} served an image whose header is damaged`);
    }
    const { width, height } = header;
    const { side, pixels } = this.#limits;
    if (width > side || height > side || width * height > pixels) {
      throw new ImageError(
        'unsafe',
        `${address.host} served an image of ${width} by ${height} pixels, past ${side} a side or ${pixels / 1_000_000} megapixels`,
      );
    }
    return { type, contentType: CONTENT_TYPES[type], bytes };
  }
}

/** The address an image is first asked for at. */
function firstAddress(asked: ImageAsked): URL {
  switch (asked.kind) {
    case 'post':
      return new URL(asked.address);
    case 'avatar':
      return new URL(`https://${AVATAR_HOST}/${asked.login}?s=${asked.size}`);
    default:
      asked satisfies never;
      throw new Error(`An image Lo doesn't know: ${JSON.stringify(asked)}.`);
  }
}

/**
 * Whether `asked` may be fetched from `address`, reached by a redirect from `from` unless it's the
 * first: over `https` on the default port, with no user name or password, from one of GitHub's
 * image hosts. A post's image may come from GitHub's attachment store only as an attachment's
 * redirect, and an avatar only from the avatars' host.
 */
export function mayFetch(asked: ImageAsked, address: URL, from?: URL): boolean {
  if (address.protocol !== 'https:' || address.port !== '') return false;
  if (address.username !== '' || address.password !== '') return false;
  switch (asked.kind) {
    case 'post':
      return (
        imageAddress(address.href) !== undefined ||
        (address.hostname === ATTACHMENT_STORE && from !== undefined && isAttachment(from))
      );
    case 'avatar':
      return address.hostname === AVATAR_HOST;
    default:
      asked satisfies never;
      return false;
  }
}

/** Whether `address` is an attachment's on github.com, the one address that gets the token. */
export function isAttachment(address: URL): boolean {
  return (
    address.protocol === 'https:' &&
    address.hostname === 'github.com' &&
    address.port === '' &&
    address.username === '' &&
    address.password === '' &&
    /^\/user-attachments\/assets\/[^/]+$/.test(address.pathname)
  );
}

/**
 * The parameter GitHub signs a private image's address with, new on each read of the post: an
 * image is kept without it, so the same image read again is the one kept.
 */
const SIGNATURE = 'jwt';

/** What an image is kept by: its address without its signature, or the avatar's login and size. */
export function keyOf(asked: ImageAsked): string {
  switch (asked.kind) {
    case 'post': {
      const address = new URL(asked.address);
      address.searchParams.delete(SIGNATURE);
      address.hash = '';
      return `post ${address.href}`;
    }
    case 'avatar':
      return `avatar ${asked.login.toLowerCase()} ${asked.size}`;
    default:
      asked satisfies never;
      throw new Error(`An image Lo doesn't know: ${JSON.stringify(asked)}.`);
  }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'TimeoutError');
}
