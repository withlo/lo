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
  it("allows only Lo's own files, with no inline code but style elements with the nonce", () => {
    expect(contentSecurityPolicy('bm9uY2U=')).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self' 'nonce-bm9uY2U='; img-src 'self'; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; " +
        "form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("loosens only what Vite's dev server needs, with no nonce to turn inline styles off", () => {
    const policy = contentSecurityPolicy('bm9uY2U=', dev);
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).toContain("connect-src 'self' ws://localhost:5173;");
    expect(policy).toContain("default-src 'none';");
    expect(policy).toContain("img-src 'self';");
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

  it('allows the dev server and its WebSocket under electron-vite dev only', () => {
    expect(isAllowedRequest('http://localhost:5173/src/index.tsx', dev)).toBe(true);
    expect(isAllowedRequest('ws://localhost:5173/', dev)).toBe(true);
    expect(isAllowedRequest('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedRequest('https://example.com/', dev)).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  it.each(['https://example.com/', 'lo-app://app/index.html', 'file:///'])(
    'refuses %s',
    (address) => {
      expect(isAllowedNavigation(address)).toBe(false);
    },
  );

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
