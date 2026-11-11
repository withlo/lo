/**
 * A git server over HTTP on this machine: `git http-backend` serving the bare repositories in a
 * folder to one token at a time, as GitHub does once renewing an account's token revokes the one
 * before.
 */

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { gitProgram, testGitEnvironment } from './git.ts';

/** A `Basic` header's credentials, decoded: `user:password`. */
export function basicCredentials(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith('Basic ')) return undefined;
  return Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
}

/** The password in a request's `Basic` credentials, if it has any. */
export function basicPassword(header: string | undefined): string | undefined {
  const decoded = basicCredentials(header);
  const colon = decoded?.indexOf(':') ?? -1;
  return colon === -1 ? undefined : decoded?.slice(colon + 1);
}

/** Serves `<root>/<owner>/<repo>.git` at `<url>/<owner>/<repo>.git`, to the token it accepts. */
export class GitHttpServer {
  readonly url: string;
  readonly #server: ReturnType<typeof createServer>;
  #accepted: string;
  readonly #signedInWith: string[] = [];
  #onRefused: ((token: string) => void) | undefined;

  private constructor(server: ReturnType<typeof createServer>, url: string, token: string) {
    this.#server = server;
    this.url = url;
    this.#accepted = token;
  }

  /** Serves the repositories in `root`, letting in `token` alone. */
  static async start(root: string, token: string): Promise<GitHttpServer> {
    const program = gitProgram();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the server has no port');
    const git = new GitHttpServer(server, `http://127.0.0.1:${address.port}`, token);
    server.on('request', (request: IncomingMessage, response: ServerResponse) => {
      git.#answer(request, response, root, program).catch((error: unknown) => {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return git;
  }

  /** Lets in `token` from now on, and refuses the one before. */
  accept(token: string): void {
    this.#accepted = token;
  }

  /** Runs `onRefused` with each token the server refuses, before it answers. */
  onRefused(onRefused: (token: string) => void): void {
    this.#onRefused = onRefused;
  }

  /** The tokens git signed in with, in order, accepted or not. */
  signedInWith(): string[] {
    return [...this.#signedInWith];
  }

  async close(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  /** GitHub's 401 unless the request carries the token the server accepts, else `http-backend`'s answer. */
  async #answer(
    request: IncomingMessage,
    response: ServerResponse,
    root: string,
    program: string,
  ): Promise<void> {
    const body = await buffer(request);
    const token = basicPassword(request.headers.authorization);
    if (token !== undefined) this.#signedInWith.push(token);
    if (token !== this.#accepted) {
      if (token !== undefined) this.#onRefused?.(token);
      const message =
        'Invalid username or token. Password authentication is not supported for Git ' +
        'operations.\n';
      response.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="GitHub"',
        'Content-Type': 'text/plain',
      });
      response.end(message);
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const env: Record<string, string> = {
      ...testGitEnvironment(),
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      REQUEST_METHOD: request.method ?? 'GET',
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      CONTENT_LENGTH: String(body.length),
      REMOTE_ADDR: '127.0.0.1',
    };
    for (const [header, variable] of [
      ['content-type', 'CONTENT_TYPE'],
      ['content-encoding', 'HTTP_CONTENT_ENCODING'],
      ['git-protocol', 'HTTP_GIT_PROTOCOL'],
    ] as const) {
      const value = request.headers[header];
      if (typeof value === 'string') env[variable] = value;
    }
    const backend = spawn(program, ['http-backend'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    const output = buffer(backend.stdout);
    backend.stdin.end(body);
    const cgi = await output;
    await new Promise((resolve) => backend.once('close', resolve));

    // CGI: headers, an empty line, then the body.
    let end = cgi.indexOf('\r\n\r\n');
    let skip = 4;
    if (end === -1) {
      end = cgi.indexOf('\n\n');
      skip = 2;
    }
    const head = end === -1 ? '' : cgi.subarray(0, end).toString('utf8');
    const content = end === -1 ? cgi : cgi.subarray(end + skip);
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of head.split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const name = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
      else if (name.toLowerCase() !== 'content-length') headers[name] = value;
    }
    response.writeHead(status, { ...headers, 'Content-Length': String(content.length) });
    response.end(content);
  }
}
