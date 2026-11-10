// What the window may load and where it may go. Lo's window shows untrusted content (code,
// Markdown, images from pull requests), so it loads only Lo's own files, from Lo's own scheme, and
// never leaves its page.

/** The scheme the window's files are served from. Never `file:`. */
export const appScheme = 'lo-app';

/** The host every `lo-app:` address uses. */
export const appHost = 'app';

/** The window's page. */
export const windowUrl = `${appScheme}://${appHost}/index.html`;

/**
 * The content security policy, sent as a header with every file the window loads. Scripts, styles,
 * fonts, images and requests come from Lo's own files only, with no inline code. Anything a
 * directive doesn't name falls back to `default-src 'none'`: no frames, workers from elsewhere,
 * media or manifests.
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
 * The policy for the window. With Vite's dev server (`electron-vite dev` only) it also allows inline
 * scripts and styles, which the server injects for hot reloading, and the server's WebSocket.
 */
export function contentSecurityPolicy(dev?: URL): string {
  const policy: Record<string, readonly string[]> = { ...directives };
  if (dev) {
    policy['script-src'] = [...directives['script-src'], "'unsafe-inline'"];
    policy['style-src'] = [...directives['style-src'], "'unsafe-inline'"];
    policy['connect-src'] = [...directives['connect-src'], `ws://${dev.host}`];
  }
  return Object.entries(policy)
    .map(([directive, sources]) => `${directive} ${sources.join(' ')}`)
    .join('; ');
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
 * WebRTC: one that leads nowhere, on a port nothing listens on (9, which Chromium refuses as unsafe
 * besides). Nothing the window loads should use the network. Even this machine's addresses go to
 * it, except the dev server's under `electron-vite dev`.
 */
export function deadProxy(dev?: URL): { proxyRules: string; proxyBypassRules: string } {
  return {
    proxyRules: '127.0.0.1:9',
    proxyBypassRules: dev ? `<-loopback>;${dev.host}` : '<-loopback>',
  };
}

/**
 * Whether the window may navigate to an address. It never may: Lo loads its page itself, which
 * isn't a navigation the page asks for. Under `electron-vite dev`, Vite reloads the page after
 * some edits, so the dev server's own pages are allowed there.
 */
export function isAllowedNavigation(address: string, dev?: URL): boolean {
  return dev !== undefined && URL.parse(address)?.origin === dev.origin;
}
