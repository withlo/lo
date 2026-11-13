import { protocol, type Session, type WebContents } from 'electron';

import { imageScheme } from '../ipc/images.ts';
import { serveFile } from './files.ts';
import {
  appScheme,
  contentSecurityPolicy,
  deadProxy,
  isAllowedNavigation,
  isAllowedRequest,
  newNonce,
} from './policy.ts';

/**
 * The nonce in the policy of the page in Lo's window, which `app.info` hands to the page for its
 * code views' style elements. Each load of the page, a reload included, gets a new one as its
 * request goes out, before its response is made, so the policy sent with the page and what
 * `app.info` answers while it's loaded are the same. The window's session shows one page at a
 * time: Lo's one window.
 */
let nonce = newNonce();

/**
 * The nonce in the policy of the page Lo's window loaded last. It's one for every window, since Lo
 * has one. A second would need a nonce of its own, kept for the page that asks for it once IPC
 * says which page asks; until then, loading a second renews the nonce under the first, whose code
 * views are then refused their styles: it fails closed.
 */
export function pageNonce(): string {
  return nonce;
}

/**
 * Registers Lo's scheme as a standard, secure origin, so the window's page gets the web platform's
 * same-origin rules, `fetch` and a code cache, as it would over https; and the image scheme as a
 * standard, secure origin of its own, which the page's `fetch` can't reach, so an image from it is
 * only ever drawn, never read. Must run before `ready`.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
    { scheme: imageScheme, privileges: { standard: true, secure: true } },
  ]);
}

/** An image main serves the window: its bytes, and the type they were checked to be. */
export interface ServedImage {
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/**
 * What every answer on the image scheme says: never to read it as anything but the type it's
 * served as, never to keep it, and, were it ever shown as a page, to run and load nothing.
 */
const IMAGE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'",
};

/**
 * Serves the image scheme in the window's session: each address the window asks for goes to
 * `image`, which answers with the image, or nothing for one it won't or can't serve, which the
 * window gets as a 404 with no body. The request filter has already let through only addresses
 * the scheme serves, and only as images. Returns a function that stops serving.
 */
export function serveImages(
  session: Session,
  image: (address: string) => Promise<ServedImage | undefined>,
): () => void {
  session.protocol.handle(imageScheme, async (request) => {
    const served = request.method === 'GET' ? await image(request.url) : undefined;
    if (!served) return new Response(null, { status: 404, headers: IMAGE_HEADERS });
    return new Response(served.bytes, {
      headers: { ...IMAGE_HEADERS, 'content-type': served.contentType },
    });
  });
  return () => session.protocol.unhandle(imageScheme);
}

/**
 * Locks down the session the window runs in. Its files come from `root` over Lo's scheme, with the
 * content security policy as a header, which carries the page's nonce. Every request outside them
 * is cancelled, and whatever could still reach the network without a request, such as WebRTC,
 * goes through a proxy that leads nowhere. Every permission and every download is refused, and
 * spellcheck is off, so Linux never downloads dictionaries.
 */
export async function secureSession(session: Session, root: string, dev?: URL): Promise<void> {
  session.protocol.handle(appScheme, (request) =>
    serveFile(request, root, { 'content-security-policy': contentSecurityPolicy(nonce) }),
  );

  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequest(details.url, dev, details.resourceType);
    if (allowed && details.resourceType === 'mainFrame') nonce = newNonce();
    callback({ cancel: !allowed });
  });
  if (dev) {
    // The dev server's pages get the development policy as a header too.
    session.webRequest.onHeadersReceived({ urls: [`${dev.origin}/*`] }, (details, callback) => {
      const policy = contentSecurityPolicy(nonce, dev);
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
      });
    });
  }
  await session.setProxy({ mode: 'fixed_servers', ...deadProxy(dev) });

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.on('will-download', (event) => event.preventDefault());
  session.setSpellCheckerEnabled(false);
}

/**
 * Keeps every web contents where it is: no new windows, no navigation or redirect away from the
 * page Lo loaded, no webviews, and WebRTC only through the session's proxy. Run for every web
 * contents as it's created.
 */
export function secureContents(contents: WebContents, dev?: URL): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Announced for every frame's navigation, the page's included, before anything else is.
  contents.on('will-frame-navigate', (event) => {
    if (!isAllowedNavigation(event.url, dev)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (!isAllowedNavigation(event.url, dev)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}
