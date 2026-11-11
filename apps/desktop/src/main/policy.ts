// What the window may load and where it may go. Lo's window shows untrusted content (code,
// Markdown, images from pull requests), so it loads only Lo's own files, from Lo's own scheme, and
// never leaves its page.

import { randomBytes } from 'node:crypto';

/** The scheme the window's files are served from. Never `file:`. */
export const appScheme = 'lo-app';

/** The host every `lo-app:` address uses. */
export const appHost = 'app';

/** The window's page. */
export const windowUrl = `${appScheme}://${appHost}/index.html`;

/**
 * The content security policy, sent as a header with every file the window loads. Scripts, styles,
 * fonts, images and requests come from Lo's own files only, with no inline code but the style
 * elements that carry the page's nonce, which its code views make. Anything a directive doesn't
 * name falls back to `default-src 'none'`: no frames, workers from elsewhere, media or manifests.
 */
const directives = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'"],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
} as const;

/**
 * The policy for the window's page, whose style elements may carry `nonce`. With Vite's dev server
 * (`electron-vite dev` only) it also allows inline scripts and styles, which the server injects for
 * hot reloading, and the server's WebSocket; it names no nonce there, since a nonce would turn the
 * inline styles off.
 */
export function contentSecurityPolicy(nonce: string, dev?: URL): string {
  const policy: Record<string, readonly string[]> = {
    ...directives,
    'style-src': [...directives['style-src'], `'nonce-${nonce}'`],
  };
  if (dev) {
    policy['script-src'] = [...directives['script-src'], "'unsafe-inline'"];
    policy['style-src'] = [...directives['style-src'], "'unsafe-inline'"];
    policy['connect-src'] = [...directives['connect-src'], `ws://${dev.host}`];
  }
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
}

/** A nonce for the page's policy: 18 random bytes, past the 16 the standard asks for, in base64. */
export function newNonce(): string {
  return randomBytes(18).toString('base64');
}

/**
 * Whether the window's session may make a request: only for Lo's own files, plus the dev server
 * and its WebSocket under `electron-vite dev`. Everything else is cancelled before it leaves.
 */
export function isAllowedRequest(address: string, dev?: URL): boolean {
  const url = URL.parse(address);
  if (!url) return false;
  if (url.protocol === `${appScheme}:`) return url.host === appHost;
  return dev !== undefined && ['http:', 'ws:'].includes(url.protocol) && url.host === dev.host;
}

/**
 * The proxy for everything the window's session sends that isn't a request it can cancel, such as
 * WebRTC: port 0 on this machine, where nothing can ever listen, so every connection through it
 * fails. Nothing the window loads should use the network. Even this machine's addresses go to it,
 * except the dev server's under `electron-vite dev`.
 */
export function deadProxy(dev?: URL): { proxyRules: string; proxyBypassRules: string } {
  return {
    proxyRules: '127.0.0.1:0',
    proxyBypassRules: dev ? `<-loopback>;${dev.host}` : '<-loopback>',
  };
}

/**
 * Whether a page is Lo's own, so it may send requests to main: the window's page on Lo's scheme, or
 * the dev server's under `electron-vite dev`.
 */
export function isAppPage(address: string, dev?: URL): boolean {
  const url = URL.parse(address);
  if (!url) return false;
  if (url.protocol === `${appScheme}:`) return url.host === appHost;
  return dev !== undefined && url.origin === dev.origin;
}

/**
 * Whether the window may navigate to an address. It never may: Lo loads its page itself, which
 * isn't a navigation the page asks for. Under `electron-vite dev`, Vite reloads the page after
 * some edits, so the dev server's own pages are allowed there.
 */
export function isAllowedNavigation(address: string, dev?: URL): boolean {
  return dev !== undefined && URL.parse(address)?.origin === dev.origin;
}
