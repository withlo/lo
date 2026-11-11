/**
 * Which links a reader can follow. Only web pages open, in the browser: `file:`, an app's scheme
 * or a path would hand a file or an app to the system, which may run it, and `javascript:` and
 * `data:` run in whatever opens them. Main checks every link again before it opens one.
 */

/**
 * `link` as a web page's address, normalized by `URL` (so a lookalike host reads as punycode), or
 * undefined when it isn't one: an `http:` or `https:` address with a host and no user name or
 * password, which can make `https://github.com@evil.example/` read as GitHub. A relative link
 * resolves against `base`, the page it's on, as a browser would read it there.
 */
export function webLink(link: string, base?: string): string | undefined {
  const url = parse(link, base);
  if (!url) return undefined;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.hostname === '' || url.username !== '' || url.password !== '') return undefined;
  return url.href;
}

/** Whether `link` is a web page's address ({@link webLink}), as it stands. */
export function isWebLink(link: string): boolean {
  return webLink(link) !== undefined;
}

/** `link` read as a URL against `base`, or undefined when it isn't one. */
export function parse(link: string, base?: string): URL | undefined {
  try {
    return base === undefined ? new URL(link) : new URL(link, base);
  } catch {
    return undefined;
  }
}

/**
 * The name a link to `#fragment` points at, when `link` is one: the fragment decoded, less the
 * `user-content-` prefix GitHub puts on the ids of a post's own anchors.
 */
export function fragmentName(link: string): string | undefined {
  if (!link.startsWith('#')) return undefined;
  let name = link.slice(1);
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not percent-encoded as a whole, so it's taken as written.
  }
  return name.startsWith('user-content-') ? name.slice('user-content-'.length) : name;
}
