/**
 * The replayer behind a local HTTP server, standing in for GitHub where Lo's own `fetch` can't be
 * swapped out, as in the app's end-to-end tests. Lo takes GitHub's addresses as settings; give it
 * {@link ReplayServer.urls}.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { Replay, ReplayError } from './replay.ts';

/** Where GitHub's API, its website (for signing in) and its uploads are. */
export interface GitHubUrls {
  api: string;
  web: string;
  uploads: string;
}

/** GitHub's own addresses, which the cassettes were recorded from. */
export const GITHUB_URLS: GitHubUrls = {
  api: 'https://api.github.com',
  web: 'https://github.com',
  uploads: 'https://uploads.github.com',
};

/** The path each of GitHub's addresses is served under. */
const PREFIXES: Record<keyof GitHubUrls, string> = {
  api: '/api',
  web: '/web',
  uploads: '/uploads',
};
const NAMES: readonly (keyof GitHubUrls)[] = ['api', 'web', 'uploads'];

export interface ReplayServer {
  /** The server's stand-ins for GitHub's addresses, such as `http://127.0.0.1:53124/api`. */
  readonly urls: GitHubUrls;
  readonly replay: Replay;
  /** The requests the cassette couldn't answer, each answered with a 500. */
  readonly failures: readonly ReplayError[];
  /** Stops the server. Rejects if any request couldn't be answered, so the test fails. */
  close(): Promise<void>;
}

/**
 * Serves a cassette on `127.0.0.1`, on a free port. Each request is answered as GitHub answered it
 * when it was recorded, with the GitHub addresses in its `link` and `location` headers moved to the
 * server's.
 */
export async function serveReplay(cassette: string | Replay): Promise<ReplayServer> {
  const replay = typeof cassette === 'string' ? Replay.cassette(cassette) : cassette;
  const failures: ReplayError[] = [];

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const urls: GitHubUrls = {
    api: origin + PREFIXES.api,
    web: origin + PREFIXES.web,
    uploads: origin + PREFIXES.uploads,
  };

  const answer = async (incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> => {
    const body = await buffer(incoming);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      for (const each of Array.isArray(value) ? value : [value]) headers.append(name, each);
    }
    const response = replay.answer({
      method: incoming.method ?? 'GET',
      url: toGitHub(incoming.url ?? '/'),
      headers,
      body: new Uint8Array(body),
    });
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      out[name] = name === 'link' || name === 'location' ? fromGitHub(value, urls) : value;
    });
    outgoing.writeHead(response.status, out);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  };

  server.on('request', (incoming: IncomingMessage, outgoing: ServerResponse) => {
    answer(incoming, outgoing).catch((error: unknown) => {
      const failure =
        error instanceof ReplayError
          ? error
          : new ReplayError(`answering a request: ${String(error)}`);
      failures.push(failure);
      if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'text/plain' });
      outgoing.end(failure.message);
    });
  });

  return {
    urls,
    replay,
    failures,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      if (failures.length > 0) {
        throw new ReplayError(
          `the replay server couldn't answer ${failures.length} request(s):\n\n` +
            failures.map((failure) => failure.message).join('\n\n'),
        );
      }
    },
  };
}

/** The GitHub URL a request to the server stands for, from the prefix its path starts with. */
function toGitHub(path: string): string {
  for (const name of NAMES) {
    const prefix = PREFIXES[name];
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) {
      return GITHUB_URLS[name] + path.slice(prefix.length);
    }
  }
  throw new ReplayError(
    `the replay server got ${path}, which isn't under ${Object.values(PREFIXES).join(', ')}`,
  );
}

/** `text` with GitHub's addresses moved to the server's. */
function fromGitHub(text: string, urls: GitHubUrls): string {
  return text.replace(
    /https:\/\/(api\.|uploads\.)?github\.com(?=[/?#>;,\s]|$)/g,
    (_, host: string | undefined) =>
      host === 'api.' ? urls.api : host === 'uploads.' ? urls.uploads : urls.web,
  );
}
