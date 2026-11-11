/**
 * Where images may load from: GitHub's own image hosts. Loading an image from anywhere else would
 * tell whoever runs that server the reader's address and when they read the post, which is what
 * GitHub's image proxy prevents on its own pages. Main's image handler, the window's only way to
 * load an image, checks every address against the same list again.
 */

import { parse } from './links.ts';

export interface ImageSource {
  /** The host, exactly: no other subdomain or port. */
  readonly host: string;
  /** The start of the path, when only part of the host serves images. */
  readonly path?: string;
}

export const imageSources: readonly ImageSource[] = Object.freeze([
  // GitHub's image proxy, which serves every other host's images in GitHub's rendering of a post.
  Object.freeze({ host: 'camo.githubusercontent.com' }),
  // Attachments, at addresses signed for a few minutes.
  Object.freeze({ host: 'private-user-images.githubusercontent.com' }),
  // Attachments from before signed addresses.
  Object.freeze({ host: 'user-images.githubusercontent.com' }),
  // An attachment's address in a post's Markdown, which redirects to its signed address.
  Object.freeze({ host: 'github.com', path: '/user-attachments/assets/' }),
]);

/**
 * `src` as an address an image may load from, normalized by `URL`, or undefined when it isn't
 * one: `https:` on the default port, with no user name or password, on one of `imageSources`'
 * hosts and under its path, with something after the path. A relative `src` resolves against
 * `base`. Nothing else about an image is read: GitHub's `data-canonical-src`, say, is whatever a
 * post says it is.
 */
export function imageAddress(src: string, base?: string): string | undefined {
  const url = parse(src, base);
  if (!url) return undefined;
  if (url.protocol !== 'https:' || url.port !== '') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  const allowed = imageSources.some(
    (source) =>
      url.hostname === source.host &&
      (source.path === undefined ||
        (url.pathname.startsWith(source.path) && url.pathname.length > source.path.length)),
  );
  return allowed ? url.href : undefined;
}

/** Whether `src` is an address an image may load from ({@link imageAddress}), as it stands. */
export function isImageAddress(src: string): boolean {
  return imageAddress(src) !== undefined;
}
