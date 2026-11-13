// Images for the window, from GitHub's image hosts: a post's, by the address GitHub's rendering or
// the post's Markdown gives, and an account's avatar, by its login. The window asks for each on
// the image scheme (`ipc/images.ts`); main fetches it, checks that it's an image, and serves it.
//
// - **Where:** each request goes over `https` on the default port, with no user name, to one of
//   GitHub's image hosts (`imageAddress`), or for an avatar to `avatars.githubusercontent.com`,
//   following at most 5 redirects, each to the same list. GitHub's attachment store on S3 is
//   reached only as an attachment's redirect.
// - **Who asks:** a post's image is fetched as the account its view acts as, or as nobody, and
//   kept for that account alone: what one tab's account could see never reaches another's.
// - **The token** goes only to the first request for an attachment's address on github.com
//   (`/user-attachments/assets/<uuid>`), which answers with a redirect to its bytes at an address
//   signed for a few minutes. Every other request, each redirect's included, goes without it:
//   signed and proxied addresses need none.
// - **What's served:** a PNG, JPEG, GIF or WebP image, by its first bytes alone, whose header gives
//   a size no browser balks at: 16 MiB at most, fetched within 30 s. Anything else fails.
// - **What's kept:** the bytes served last, 64 MiB at most, each by the account it was fetched as
//   and its exact address, signature and all, so only the address that fetched it finds it.

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
   * The login of the account view `view` acts as, as the window asks for an image in it, or
   * nothing for a view acting as nobody, or no such view.
   */
  acting(view: string): string | undefined;
  /** Account `login`'s token, read as an attachment's request starts. */
  token(login: string): Promise<Token | undefined>;
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
  readonly #acting: (view: string) => string | undefined;
  readonly #token: (login: string) => Promise<Token | undefined>;
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
    this.#acting = (view) => options.acting(view);
    this.#token = (login) => options.token(login);
    this.#route = options.route ?? ((address) => address.href);
    this.#limits = { ...IMAGE_LIMITS, ...options.limits };
  }

  /**
   * The image `asked` asks for: kept, or fetched and checked, as the account its view acts as now.
   * Throws an {@link ImageError}.
   */
  async load(asked: ImageAsked): Promise<LoadedImage> {
    // An avatar is fetched as nobody, whoever asks.
    const as = asked.kind === 'post' ? this.#acting(asked.view) : undefined;
    const key = keyOf(asked, as);
    const kept = this.#kept.get(key);
    if (kept) {
      this.#kept.delete(key);
      this.#kept.set(key, kept);
      return kept;
    }
    let loading = this.#loading.get(key);
    if (!loading) {
      loading = this.#inTurn(() => this.#fetched(asked, as))
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

  /** Fetches `asked` as account `as`, or as nobody. */
  async #fetched(asked: ImageAsked, as: string | undefined): Promise<LoadedImage> {
    const deadline = AbortSignal.timeout(this.#limits.deadline);
    let address = firstAddress(asked);
    let from: URL | undefined;
    // Only the address the window asked for, when it's an attachment's, is asked with the token:
    // never one a redirect leads to, wherever it is.
    const token =
      as !== undefined && isAttachment(address) ? await this.#accountToken(as) : undefined;
    for (let redirects = 0; ; redirects++) {
      if (!mayFetch(asked, address, from)) {
        throw new ImageError(
          'refused',
          from === undefined
            ? `${address.host} isn't one of GitHub's image hosts`
            : `${from.host} redirected to ${address.host}, which isn't one of GitHub's image hosts for it`,
        );
      }
      const response = await this.#request(
        address,
        from === undefined ? token : undefined,
        deadline,
      );
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

  /** Asks for `address`, with `token` when it's given. */
  async #request(address: URL, token: Token | undefined, signal: AbortSignal): Promise<Response> {
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

  async #accountToken(login: string): Promise<Token | undefined> {
    try {
      return await this.#token(login);
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
 * image hosts. On github.com, only an attachment's address. A post's image may come from GitHub's
 * attachment store only as an attachment's redirect, and an avatar only from the avatars' host.
 */
export function mayFetch(asked: ImageAsked, address: URL, from?: URL): boolean {
  if (address.protocol !== 'https:' || address.port !== '') return false;
  if (address.username !== '' || address.password !== '') return false;
  switch (asked.kind) {
    case 'post':
      if (address.hostname === 'github.com') return isAttachment(address);
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

/**
 * An attachment's path on github.com: GitHub names each by a lowercase UUID. Nothing else under it
 * is one, an id that steps out of the path (`..%2F`) least of all.
 */
const ATTACHMENT_PATH =
  /^\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `address` is an attachment's on github.com, the one address that may get the token. */
export function isAttachment(address: URL): boolean {
  return (
    address.protocol === 'https:' &&
    address.hostname === 'github.com' &&
    address.port === '' &&
    address.username === '' &&
    address.password === '' &&
    ATTACHMENT_PATH.test(address.pathname)
  );
}

/**
 * What an image is kept by. A post's image: the account it's fetched as, or nobody, and its whole
 * address but the fragment, signature included, so an address signed otherwise, or not at all,
 * never finds a signed image. An avatar, fetched as nobody for everyone: its login and size.
 */
export function keyOf(asked: ImageAsked, as?: string): string {
  switch (asked.kind) {
    case 'post': {
      const address = new URL(asked.address);
      address.hash = '';
      return `post ${as === undefined ? 'nobody' : `@${as.toLowerCase()}`} ${address.href}`;
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
