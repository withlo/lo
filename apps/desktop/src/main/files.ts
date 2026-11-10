import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';

import { appHost, appScheme } from './policy.ts';

/** The types of file the window loads. Anything else isn't served. */
const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Answers a request on Lo's scheme with a file from `root`, the window's build folder, adding
 * `headers` to the response. Only a GET or HEAD for a file inside `root`, on Lo's own host and of a
 * type the window loads, is answered; anything else gets a 404 (or a 405 for another method). A path
 * that leaves `root`, written plainly, percent-encoded or through a symlink, never resolves.
 */
export async function serveFile(
  request: { method: string; url: string },
  root: string,
  headers: Readonly<Record<string, string>>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const file = await locate(request.url, root);
  const type = file && contentTypes[extname(file)];
  if (!file || !type) return new Response(null, { status: 404 });

  let body: Buffer | null = null;
  try {
    if (request.method === 'GET') body = await readFile(file);
  } catch {
    return new Response(null, { status: 404 });
  }
  return new Response(body, {
    headers: { ...headers, 'content-type': type, 'x-content-type-options': 'nosniff' },
  });
}

/** The real path of the file an address names inside `root`, or undefined. */
async function locate(address: string, root: string): Promise<string | undefined> {
  const url = URL.parse(address);
  if (!url || url.protocol !== `${appScheme}:` || url.host !== appHost) return undefined;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (path.includes('\0')) return undefined;
  if (path.endsWith('/')) path += 'index.html';

  try {
    const realRoot = await realpath(root);
    const file = await realpath(resolve(realRoot, `.${path}`));
    return inside(realRoot, file) ? file : undefined;
  } catch {
    return undefined;
  }
}

function inside(folder: string, path: string): boolean {
  const rest = relative(folder, path);
  return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
}
