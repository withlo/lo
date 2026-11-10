import { protocol, type Session, type WebContents } from 'electron';

import { serveFile } from './files.ts';
import {
  appScheme,
  contentSecurityPolicy,
  isAllowedNavigation,
  isAllowedRequest,
} from './policy.ts';

/**
 * Registers Lo's scheme as a standard, secure origin, so the window's page gets the web platform's
 * same-origin rules, `fetch` and a code cache, as it would over https. Must run before `ready`.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: appScheme,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

/**
 * Locks down the session the window runs in: its files come from `root` over Lo's scheme with the
 * content security policy as a header, every request outside them is cancelled, every permission
 * is refused, and spellcheck is off, so Linux never downloads dictionaries.
 */
export function secureSession(session: Session, root: string, dev?: URL): void {
  const headers = { 'content-security-policy': contentSecurityPolicy() };
  session.protocol.handle(appScheme, (request) => serveFile(request, root, headers));

  session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedRequest(details.url, dev) });
  });
  if (dev) {
    // The dev server's pages get the development policy as a header too.
    const policy = contentSecurityPolicy(dev);
    session.webRequest.onHeadersReceived({ urls: [`${dev.origin}/*`] }, (details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
      });
    });
  }

  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setSpellCheckerEnabled(false);
}

/**
 * Keeps every web contents where it is: no new windows, no navigation or redirect away from the
 * page Lo loaded, and no webviews. Run for every web contents as it's created.
 */
export function secureContents(contents: WebContents, dev?: URL): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const stay = (event: { url: string; preventDefault(): void }) => {
    if (!isAllowedNavigation(event.url, dev)) event.preventDefault();
  };
  contents.on('will-navigate', stay);
  contents.on('will-frame-navigate', stay);
  contents.on('will-redirect', stay);
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
