import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, isAllowedNavigation, isAllowedRequest } from './policy.ts';

const dev = new URL('http://localhost:5173');

describe('contentSecurityPolicy', () => {
  it("allows only Lo's own files, with no inline code", () => {
    expect(contentSecurityPolicy()).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
        "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
        "frame-ancestors 'none'",
    );
  });

  it("loosens only what Vite's dev server needs", () => {
    const policy = contentSecurityPolicy(dev);
    expect(policy).toContain("script-src 'self' 'unsafe-inline';");
    expect(policy).toContain("style-src 'self' 'unsafe-inline';");
    expect(policy).toContain("connect-src 'self' ws://localhost:5173;");
    expect(policy).toContain("default-src 'none';");
    expect(policy).toContain("img-src 'self';");
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
