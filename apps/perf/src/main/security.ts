// What the window may load and do. It runs as the app's window does: sandboxed, in its own
// JavaScript world, loading only the harness's own files from its own scheme, with a content
// security policy and nowhere to go.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

import { protocol, type Session, type WebContents } from 'electron';

/** The scheme the window's files are served from. */
export const scheme = 'lo-perf';

/** The window's page. */
export const pageUrl = `${scheme}://app/index.html`;

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Registers the scheme as a standard, secure origin. Must run before `ready`. */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

/**
 * The content security policy: the harness's own scripts, styles, fonts and images only, and
 * CodeMirror's style elements, which carry `nonce`.
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Serves `root`'s files on the scheme, refuses every other request and every permission. */
export function secureSession(session: Session, root: string, nonce: string): void {
  const policy = contentSecurityPolicy(nonce);
  session.protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    const path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (url.host !== 'app' || !path.startsWith(`${root}${sep}`)) {
      return new Response(null, { status: 404 });
    }
    try {
      const body = await readFile(path);
      return new Response(body, {
        headers: {
          'content-type': types[extname(path)] ?? 'application/octet-stream',
          'content-security-policy': policy,
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${scheme}://app/`) });
  });
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.on('will-download', (event) => event.preventDefault());
  session.setSpellCheckerEnabled(false);
}

/** Keeps a web contents on its page: no new windows, navigation or webviews. */
export function secureContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-frame-navigate', (event) => {
    if (event.url !== pageUrl) event.preventDefault();
  });
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
