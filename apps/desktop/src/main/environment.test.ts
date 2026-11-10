import { describe, expect, it } from 'vitest';

import { dataFolder, devServer } from './environment.ts';

describe('dataFolder', () => {
  const appData = '/home/me/.config';

  it("keeps Electron's default in a packaged build, whatever the environment says", () => {
    expect(dataFolder({ packaged: true, appData, env: { LO_USER_DATA_DIR: '/tmp/lo' } })).toBe(
      undefined,
    );
  });

  it('gives an unpackaged build its own folder', () => {
    expect(dataFolder({ packaged: false, appData, env: {} })).toBe('/home/me/.config/Lo Dev');
  });

  it('takes LO_USER_DATA_DIR in an unpackaged build', () => {
    expect(dataFolder({ packaged: false, appData, env: { LO_USER_DATA_DIR: '/tmp/lo' } })).toBe(
      '/tmp/lo',
    );
  });

  it('refuses a relative LO_USER_DATA_DIR', () => {
    expect(() => dataFolder({ packaged: false, appData, env: { LO_USER_DATA_DIR: 'lo' } })).toThrow(
      'absolute path',
    );
  });
});

describe('devServer', () => {
  const env = { ELECTRON_RENDERER_URL: 'http://localhost:5173' };

  it('reads the dev server in an unpackaged build', () => {
    expect(devServer({ packaged: false, env })?.origin).toBe('http://localhost:5173');
  });

  it('ignores it in a packaged build', () => {
    expect(devServer({ packaged: true, env })).toBe(undefined);
  });

  it('is absent when nothing sets it', () => {
    expect(devServer({ packaged: false, env: {} })).toBe(undefined);
  });

  it('refuses a server on another machine or another scheme', () => {
    for (const address of ['http://example.com:5173', 'https://localhost:5173', 'file:///tmp']) {
      expect(() => devServer({ packaged: false, env: { ELECTRON_RENDERER_URL: address } })).toThrow(
        'on this machine',
      );
    }
  });
});
