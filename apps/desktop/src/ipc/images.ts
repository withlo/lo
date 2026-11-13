// The addresses the window loads images from, which main serves: its only way to show an image
// from outside Lo. The window builds them and main reads them, and main's request filter lets
// through only those this reads, so both sides hold the same rules.
//
//   lo-image://post/<view>/<address>   an image in a post, shown in a pull request's tab's view
//   lo-image://avatar/<login>?s=<px>   an account's avatar, `px` pixels a side
//
// A post's address is one of GitHub's image hosts' (`imageAddress`), checked again here and by
// main. The view says which account main fetches it as.

import { imageAddress } from '@lo/markdown';

/** The scheme main serves images on. */
export const imageScheme = 'lo-image';

/** What the window asks main for. */
export type ImageAsked =
  /** An image in a post, at an address `imageAddress` accepts, shown in view `view`. */
  | { kind: 'post'; view: string; address: string }
  /** An account's avatar, `size` pixels a side. */
  | { kind: 'avatar'; login: string; size: number };

/** A GitHub login: letters, digits and hyphens, 39 at most. */
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;

/**
 * A view of a pull request's tab, by its id: a tab's own, `<tab>:<number>` for another layer, or
 * `<tab>:<bottom>-<top>` for a run of layers.
 */
const VIEW = /^[A-Za-z0-9_:-]{1,100}$/;

/** The largest avatar the window asks for, in pixels a side: GitHub serves up to 460. */
export const MAX_AVATAR = 460;

/** Whether `login` is a GitHub login. */
export function isLogin(login: string): boolean {
  return LOGIN.test(login);
}

/**
 * The address the window loads a post's image from, for `address` in view `view`, or nothing for an
 * address that isn't on one of GitHub's image hosts or a view that isn't one.
 */
export function postImageAddress(view: string, address: string): string | undefined {
  const checked = imageAddress(address);
  if (checked === undefined || !VIEW.test(view)) return undefined;
  return `${imageScheme}://post/${encodeURIComponent(view)}/${encodeURIComponent(checked)}`;
}

/**
 * The address the window loads `login`'s avatar from, `size` pixels a side, or nothing for a login
 * that isn't one or a size GitHub doesn't serve.
 */
export function avatarImageAddress(login: string, size: number): string | undefined {
  if (!isLogin(login) || !isSize(size)) return undefined;
  return `${imageScheme}://avatar/${login}?s=${size}`;
}

function isSize(size: number): boolean {
  return Number.isSafeInteger(size) && size >= 1 && size <= MAX_AVATAR;
}

/**
 * What `address`, an address the window asked for, asks for, or nothing for one that isn't exactly
 * one of the two forms above: no user name, port, fragment or anything else in it.
 */
export function readImageAddress(address: string): ImageAsked | undefined {
  const url = URL.parse(address);
  if (!url || url.protocol !== `${imageScheme}:`) return undefined;
  if (url.username !== '' || url.password !== '' || url.port !== '' || url.hash !== '') {
    return undefined;
  }
  const parts = url.pathname.split('/').slice(1);
  switch (url.hostname) {
    case 'post': {
      const [view, image] = parts.map(decoded);
      if (parts.length !== 2 || url.search !== '' || view === undefined || image === undefined) {
        return undefined;
      }
      const checked = imageAddress(image);
      if (!VIEW.test(view) || checked === undefined) return undefined;
      return { kind: 'post', view, address: checked };
    }
    case 'avatar': {
      const [login] = parts;
      const params = [...url.searchParams];
      const [size] = params;
      if (parts.length !== 1 || login === undefined || !isLogin(login)) return undefined;
      if (params.length !== 1 || size?.[0] !== 's' || !/^[1-9]\d*$/.test(size[1])) {
        return undefined;
      }
      const pixels = Number(size[1]);
      return isSize(pixels) ? { kind: 'avatar', login, size: pixels } : undefined;
    }
    default:
      return undefined;
  }
}

/** A part of a path, decoded, or nothing when it isn't encoded right. */
function decoded(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}
