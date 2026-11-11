/**
 * Servers on `127.0.0.1` that answer every request the same way and keep each request's head: a
 * proxy that asks for a password, a server that asks for one, one that redirects, and one that
 * never answers. Tests point git at them to see what it sends where.
 */

import { createServer, type Server, type Socket } from 'node:net';

import { basicCredentials } from './http.ts';

export class FakeServer {
  readonly port: number;
  readonly #server: Server;
  readonly #requests: string[] = [];
  readonly #sockets = new Set<Socket>();
  #connections = 0;

  private constructor(server: Server, port: number) {
    this.#server = server;
    this.port = port;
  }

  /**
   * A server that answers each request with what `respond` returns for its head, then closes the
   * connection, or never answers when it returns `undefined`.
   */
  static async start(respond: (head: string) => string | undefined): Promise<FakeServer> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the server has no port');
    const fake = new FakeServer(server, address.port);
    server.on('connection', (socket) => {
      fake.#connections += 1;
      fake.#sockets.add(socket);
      socket.on('close', () => fake.#sockets.delete(socket));
      socket.on('error', () => undefined);
      let head = '';
      socket.setEncoding('latin1');
      socket.on('data', (text: string) => {
        if (head.includes('\r\n\r\n')) return;
        head += text;
        const end = head.indexOf('\r\n\r\n');
        if (end === -1) return;
        head = head.slice(0, end + 2);
        fake.#requests.push(head);
        const response = respond(head);
        if (response !== undefined) socket.end(response, 'latin1');
      });
    });
    return fake;
  }

  /** A proxy that wants a password for everything. */
  static proxy(): Promise<FakeServer> {
    return FakeServer.start(
      () =>
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
        'Proxy-Authenticate: Basic realm="proxy"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
    );
  }

  /** A server that wants a password for everything. */
  static asksForAPassword(): Promise<FakeServer> {
    return FakeServer.start(
      () =>
        'HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="server"\r\n' +
        'Content-Length: 0\r\nConnection: close\r\n\r\n',
    );
  }

  /** A server that redirects every request to the same path on `localhost:<port>`. */
  static redirectsTo(port: number): Promise<FakeServer> {
    return FakeServer.start((head) => {
      const path = head.split(' ')[1] ?? '/';
      return (
        `HTTP/1.1 302 Found\r\nLocation: http://localhost:${port}${path}\r\n` +
        'Content-Length: 0\r\nConnection: close\r\n\r\n'
      );
    });
  }

  /** A server that takes every request and never answers. */
  static silent(): Promise<FakeServer> {
    return FakeServer.start(() => undefined);
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** How many connections it has taken, whether or not they sent a request. */
  connections(): number {
    return this.#connections;
  }

  /** Each request's head, in order. */
  requests(): string[] {
    return [...this.#requests];
  }

  /** Whether any request carried `secret`, in any header or in a header's `Basic` credentials. */
  saw(secret: string): boolean {
    return this.#requests.some(
      (head) =>
        head.includes(secret) ||
        head.split('\r\n').some((line) => {
          const at = line.indexOf(': Basic ');
          return at !== -1 && (basicCredentials(line.slice(at + 2))?.includes(secret) ?? false);
        }),
    );
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}
