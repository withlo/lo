/**
 * The replayer behind a local HTTP server, standing in for GitHub where Lo's own `fetch` can't be
 * swapped out, as in the app's end-to-end tests. Lo takes GitHub's addresses as settings; give it
 * {@link ReplayServer.urls}. It stands in for GitHub's image hosts too, each under
 * `/images/<host>/`.
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
export const PREFIXES: Readonly<Record<keyof GitHubUrls, string>> = {
  api: '/api',
  web: '/web',
  uploads: '/uploads',
};
const NAMES: readonly (keyof GitHubUrls)[] = ['api', 'web', 'uploads'];

/** The path GitHub's image hosts are served under, each as `/images/<host>/`. */
export const IMAGES_PREFIX = '/images';

/**
 * The hosts the server stands in for under {@link IMAGES_PREFIX}: GitHub's image hosts, its
 * avatars, the address of an attachment on github.com, and where that redirects to.
 */
export const IMAGE_HOSTS: readonly string[] = [
  'camo.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'user-images.githubusercontent.com',
  'avatars.githubusercontent.com',
  'github.com',
  'github-production-user-asset-6210df.s3.amazonaws.com',
];

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
    const path = incoming.url ?? '/';
    const response = replay.answer({
      method: incoming.method ?? 'GET',
      url: toGitHub(path),
      headers,
      body: new Uint8Array(body),
    });
    // An image host's redirects stay as they were: Lo reads them against the host's own address.
    const moved = !isImagePath(path);
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      out[name] =
        moved && (name === 'link' || name === 'location') ? fromGitHub(value, urls) : value;
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

/** Whether a request to the server is for an image, under {@link IMAGES_PREFIX}. */
export function isImagePath(path: string): boolean {
  return path.startsWith(`${IMAGES_PREFIX}/`);
}

/** The GitHub URL a request to the server stands for, from the prefix its path starts with. */
export function toGitHub(path: string): string {
  if (isImagePath(path)) {
    const rest = path.slice(IMAGES_PREFIX.length + 1);
    const slash = rest.indexOf('/');
    const host = slash === -1 ? rest : rest.slice(0, slash);
    if (slash === -1 || !IMAGE_HOSTS.includes(host)) {
      throw new ReplayError(
        `the replay server got ${path}, which isn't on one of GitHub's image hosts`,
      );
    }
    // Only an address that's already as `URL` writes it: none with a `..` or `%2e` that would
    // step out of where it seems to be.
    const target = `https://${host}${rest.slice(slash)}`;
    if (URL.parse(target)?.href !== target) {
      throw new ReplayError(
        `the replay server got ${path}, which isn't an image's address as it stands`,
      );
    }
    return target;
  }
  for (const name of NAMES) {
    const prefix = PREFIXES[name];
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) {
      return GITHUB_URLS[name] + path.slice(prefix.length);
    }
  }
  throw new ReplayError(
    `the replay server got ${path}, which isn't under ${[...Object.values(PREFIXES), IMAGES_PREFIX].join(', ')}`,
  );
}

/** `text` with GitHub's addresses moved to the server's. */
export function fromGitHub(text: string, urls: GitHubUrls): string {
  return text.replace(
    /https:\/\/(api\.|uploads\.)?github\.com(?=[/?#>;,\s]|$)/g,
    (_, host: string | undefined) =>
      host === 'api.' ? urls.api : host === 'uploads.' ? urls.uploads : urls.web,
  );
}
