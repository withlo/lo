/**
 * Records a cassette from the app itself: a server on `127.0.0.1` that stands in for GitHub as the
 * replay server does, and forwards each request to GitHub, recording it with the recorder's rules.
 * The app talks to it as to any GitHub (`LO_GITHUB`), so it holds no recording code. It signs in
 * with a stand-in token, which the proxy swaps for the bot's on the way out, so the app never holds
 * the bot's token either.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { Recorder } from './record.ts';
import { fromGitHub, isImagePath, PREFIXES, toGitHub, type GitHubUrls } from './server.ts';

/**
 * The one image address the bot's token goes to: an attachment's on github.com, which GitHub names
 * by a lowercase UUID.
 */
const ATTACHMENT =
  /^\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether `target`, as `toGitHub` gives it, is an attachment's address on github.com. */
function isAttachment(target: string): boolean {
  const url = URL.parse(target);
  return url?.href === target && url.host === 'github.com' && ATTACHMENT.test(url.pathname);
}

/** Request headers never forwarded: the connection's own, and what `fetch` sets itself. */
const DROPPED_REQUEST = new Set([
  'host',
  'connection',
  'keep-alive',
  'content-length',
  'transfer-encoding',
  'accept-encoding',
  'authorization',
]);

/** Response headers never passed back: `fetch` has already undone the encoding they describe. */
const DROPPED_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'content-length',
  'content-encoding',
  'transfer-encoding',
]);

export interface RecordingProxyOptions {
  /** The cassette's folder, emptied first. */
  readonly dir: string;
  /** The bot's token, which the proxy signs every request it forwards with. */
  readonly token: string;
  /** The `fetch` that reaches GitHub. */
  readonly fetch?: typeof globalThis.fetch | undefined;
  /**
   * Whether requests that write to GitHub are sent and recorded, as `LO_RECORD_WRITES=1` says for
   * a recording of what the app writes. Off unless set: they're refused.
   */
  readonly writes?: boolean | undefined;
}

export interface RecordingProxy {
  /** The proxy's stand-ins for GitHub's addresses, such as `http://127.0.0.1:53124/api`. */
  readonly urls: GitHubUrls;
  /** Requests that couldn't be forwarded or recorded, each answered with a 502. */
  readonly failures: readonly string[];
  /** Stops the proxy and writes `cassette.json`, after checking every file for the token. */
  finish(info: { description: string; repo: string }): Promise<void>;
}

/**
 * Starts a recording proxy on a free port. Every request it gets is sent to GitHub signed as the
 * bot, whatever token the app sent, and recorded; a request that would write to GitHub is refused,
 * unless `writes` says to send it. Redirects come back to the app as they are, for it to follow.
 */
export async function startRecordingProxy(options: RecordingProxyOptions): Promise<RecordingProxy> {
  const recorder = new Recorder({
    fetch: options.fetch ?? fetch,
    dir: options.dir,
    secrets: [options.token],
    writes: options.writes ?? false,
  });
  const failures: string[] = [];
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the proxy has no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const urls: GitHubUrls = {
    api: origin + PREFIXES.api,
    web: origin + PREFIXES.web,
    uploads: origin + PREFIXES.uploads,
  };

  const forward = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const body = await buffer(incoming);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined || DROPPED_REQUEST.has(name)) continue;
      for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each);
    }
    const path = incoming.url ?? '/';
    const image = isImagePath(path);
    const target = toGitHub(path);
    // Signed in as the bot only when the app signs in at all: an anonymous request stays one. Of
    // the image hosts, only an attachment's address on github.com ever gets the token.
    if (incoming.headers.authorization !== undefined && (!image || isAttachment(target))) {
      headers.set('authorization', `token ${options.token}`);
    }
    const method = incoming.method ?? 'GET';
    const response = await recorder.fetch(target, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      redirect: 'manual',
    });
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (DROPPED_RESPONSE.has(name)) return;
      // An image host's redirects go back as they are, for the app to read against the host.
      const moved = !image && (name === 'link' || name === 'location');
      out[name] = moved ? fromGitHub(value, urls) : value;
    });
    outgoing.writeHead(response.status, out);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  };

  server.on('request', (incoming: IncomingMessage, outgoing: ServerResponse) => {
    forward(incoming, outgoing).catch((error: unknown) => {
      const message = `${incoming.method} ${incoming.url}: ${error instanceof Error ? error.message : String(error)}`;
      failures.push(message);
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' });
      outgoing.end(message);
    });
  });

  return {
    urls,
    failures,
    async finish({ description, repo }) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      recorder.finish({
        description,
        recorded_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        repo,
      });
    },
  };
}
