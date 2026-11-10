import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { serveFile } from './files.ts';

describe('serveFile', () => {
  let folder: string;
  let root: string;
  const headers = { 'content-security-policy': "default-src 'none'" };

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'lo-files-'));
    root = join(folder, 'window');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<!doctype html>');
    await writeFile(join(root, 'assets', 'index.js'), 'export {};');
    await writeFile(join(root, 'notes.txt'), 'not served');
    await mkdir(join(root, 'folder.js'));
    await writeFile(join(folder, 'secret.js'), 'outside the window');
    await symlink(join(folder, 'secret.js'), join(root, 'assets', 'link.js'));
  });

  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const get = (url: string, method = 'GET') => serveFile({ method, url }, root, headers);

  it('serves a file with its type, the given headers and nosniff', async () => {
    const response = await get('lo-app://app/assets/index.js');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('export {};');
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it.each(['lo-app://app/', 'lo-app://app/index.html'])('serves index.html for %s', async (url) => {
    const response = await get(url);
    expect(await response.text()).toBe('<!doctype html>');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });

  it('answers HEAD without a body', async () => {
    const response = await get('lo-app://app/index.html', 'HEAD');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('refuses other methods', async () => {
    const response = await get('lo-app://app/index.html', 'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
  });

  // Out of the folder, written plainly, percent-encoded and through a symlink.
  it.each([
    'lo-app://app/..%2fsecret.js',
    'lo-app://app/%2e%2e%2fsecret.js',
    'lo-app://app/assets/..%2f..%2fsecret.js',
    'lo-app://app/%2fetc%2fhosts.js',
    'lo-app://app/assets/link.js',
  ])('never leaves the folder for %s', async (url) => {
    expect((await get(url)).status).toBe(404);
  });

  it.each(['lo-app://elsewhere/index.html', 'file:///index.html', 'not a url'])(
    'serves only its own host and scheme, not %s',
    async (url) => {
      expect((await get(url)).status).toBe(404);
    },
  );

  // A missing file, an unknown type, a folder, a bad encoding and a NUL byte.
  it.each([
    'lo-app://app/missing.js',
    'lo-app://app/notes.txt',
    'lo-app://app/folder.js',
    'lo-app://app/%E0%A4%A.js',
    'lo-app://app/index.html%00.js',
  ])('refuses %s', async (url) => {
    const response = await get(url);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
  });
});
