import { describe, expect, it } from 'vitest';

import {
  contentSecurityPolicy,
  deadProxy,
  isAllowedNavigation,
  isAllowedRequest,
  isAppPage,
  newNonce,
} from './policy.ts';

const dev = new URL('http://localhost:5173');

describe('contentSecurityPolicy', () => {
  it("allows only Lo's own files, and images main serves, with no inline code but style elements with the nonce", () => {
    expect(contentSecurityPolicy('bm9uY2U=')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-bm9uY2U='; " +
        "img-src 'self' lo-image:; font-src 'self'; connect-src 'self'; object-src 'none'; " +
        "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it('lets nothing load by an address but its own files and images from main: no blob:, data: or other scheme', () => {
    // Overviews' figures are drawn from their bytes, on canvases and as SVG elements, so they
    // need no source of their own.
    const policy = contentSecurityPolicy('bm9uY2U=');
    const sources = policy.split('; ').flatMap((directive) =>
      directive
        .split(' ')
        .slice(1)
        .map((source) => [directive, source]),
    );
    expect(
      sources.filter(
        ([, source]) => !["'self'", "'none'", "'nonce-bm9uY2U='"].includes(source ?? ''),
      ),
    ).toEqual([["img-src 'self' lo-image:", 'lo-image:']]);
    expect(policy).not.toMatch(/blob:|data:|filesystem:|lo-app:|https?:|\*/);
  });

  it("loosens only what Vite's dev server needs, with no nonce to turn inline styles off", () => {
    const policy = contentSecurityPolicy('bm9uY2U=', dev);
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).toContain("connect-src 'self' ws://localhost:5173;");
    expect(policy).toContain("default-src 'none';");
    expect(policy).toContain("img-src 'self' lo-image:;");
    expect(policy).not.toContain('nonce');
  });
});

describe('newNonce', () => {
  it('is 18 random bytes in base64, new each time', () => {
    const nonces = Array.from({ length: 100 }, () => newNonce());
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
      expect(Buffer.from(nonce, 'base64')).toHaveLength(18);
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });
});

describe('isAllowedRequest', () => {
  it("allows Lo's own files", () => {
    expect(isAllowedRequest('lo-app://app/index.html')).toBe(true);
    expect(isAllowedRequest('lo-app://app/assets/index.js')).toBe(true);
  });

  it.each([
    'lo-app://elsewhere/index.html',
    'https://example.com/',
    'http://localhost:5173/',
    'file:///etc/hosts',
    'wss://example.com/',
    'not a url',
  ])('refuses %s', (address) => {
    expect(isAllowedRequest(address)).toBe(false);
  });

  it('allows an image main serves, as an image only', () => {
    const view = '5b2a0f6e-0d4c-4d8e-9f3c-1d2e3f4a5b6c';
    const attachment = encodeURIComponent('https://github.com/user-attachments/assets/a1');
    for (const address of [
      'lo-image://avatar/octocat?s=56',
      `lo-image://post/${view}/${attachment}`,
    ]) {
      expect(isAllowedRequest(address, undefined, 'image')).toBe(true);
      expect(isAllowedRequest(address, dev, 'image')).toBe(true);
      for (const kind of ['xhr', 'mainFrame', 'subFrame', 'script', 'media', 'other', undefined]) {
        expect(isAllowedRequest(address, undefined, kind)).toBe(false);
      }
    }
  });

  it.each([
    'lo-image://elsewhere/octocat?s=56',
    'lo-image://avatar/octocat',
    'lo-image://avatar/dependabot%5Bbot%5D?s=56',
    `lo-image://post/tab/${encodeURIComponent('https://example.com/a.png')}`,
    `lo-image://post/tab/${encodeURIComponent('http://camo.githubusercontent.com/a')}`,
    'lo-image:avatar',
    'https://avatars.githubusercontent.com/octocat?s=56',
    'https://camo.githubusercontent.com/a',
  ])('refuses %s, even as an image', (address) => {
    expect(isAllowedRequest(address, undefined, 'image')).toBe(false);
  });

  it('allows the dev server and its WebSocket under electron-vite dev only', () => {
    expect(isAllowedRequest('http://localhost:5173/src/index.tsx', dev)).toBe(true);
    expect(isAllowedRequest('ws://localhost:5173/', dev)).toBe(true);
    expect(isAllowedRequest('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedRequest('https://example.com/', dev)).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  it.each([
    'https://example.com/',
    'lo-app://app/index.html',
    'lo-image://avatar/octocat?s=56',
    'file:///',
  ])('refuses %s', (address) => {
    expect(isAllowedNavigation(address)).toBe(false);
  });

  it("allows the dev server's own pages under electron-vite dev", () => {
    expect(isAllowedNavigation('http://localhost:5173/', dev)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', dev)).toBe(false);
  });
});

describe('deadProxy', () => {
  it('sends everything to a port nothing can listen on, this machine included', () => {
    expect(deadProxy()).toEqual({ proxyRules: '127.0.0.1:0', proxyBypassRules: '<-loopback>' });
  });

  it('lets the dev server through under electron-vite dev', () => {
    expect(deadProxy(dev).proxyBypassRules).toBe('<-loopback>;localhost:5173');
  });
});

describe('isAppPage', () => {
  it("accepts Lo's own page", () => {
    expect(isAppPage('lo-app://app/index.html')).toBe(true);
  });

  it.each(['lo-app://elsewhere/index.html', 'https://example.com/', 'about:blank', 'file:///', ''])(
    'refuses %s',
    (address) => {
      expect(isAppPage(address)).toBe(false);
    },
  );

  it("accepts the dev server's pages under electron-vite dev only", () => {
    expect(isAppPage('http://localhost:5173/', dev)).toBe(true);
    expect(isAppPage('http://localhost:5173/')).toBe(false);
    expect(isAppPage('http://localhost:5174/', dev)).toBe(false);
  });
});
