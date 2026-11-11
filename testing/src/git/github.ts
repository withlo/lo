/**
 * A fake GitHub speaking git's smart HTTP, protocol v2, as far as a fetch needs: it advertises
 * `refs/heads/main` and `refs/pull/1/head`, and answers a fetch with keep-alives only, as GitHub
 * sends while it prepares a pack, or with a pack sent slowly, piece by piece, which may stop
 * halfway. Tests of a fetch's limits point git at it.
 */

import { mkdirSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { gunzipSync } from 'node:zlib';

import { gitBytes } from './git.ts';

/** How the fake GitHub answers a fetch, once it has said a pack follows. */
export type Answer =
  /**
   * Keep-alives only, ten a second, until the client hangs up or a minute passes: after saying
   * it's counting objects, with `counting`, or after saying nothing at all.
   */
  | { readonly kind: 'keepAlive'; readonly counting: boolean }
  /**
   * `pack`, in `pieces` pieces, one every `every` milliseconds, then the end. With `stopAfter`,
   * only that many pieces, then keep-alives only, as GitHub sends when it stalls halfway through.
   */
  | {
      readonly kind: 'pack';
      readonly pack: Buffer;
      readonly pieces: number;
      readonly every: number;
      readonly stopAfter?: number | undefined;
    };

/** A commit ID the fake GitHub advertises for every ref when it never sends a pack. */
export const FAKE_OID = '1111111111111111111111111111111111111111';

/** A pkt-line holding `data`. */
export function pkt(data: Buffer | string): Buffer {
  const bytes = Buffer.from(data);
  return Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, '0')), bytes]);
}

/** The most a pkt-line on a sideband holds: 65520 bytes, less its length and its band. */
const BAND_MAX = 65_515;

/** `data` on sideband `band`, 1 for the pack and 2 for progress, in as many pkt-lines as it needs. */
function band(number: number, data: Buffer | string): Buffer {
  const bytes = Buffer.from(data);
  const lines: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += BAND_MAX) {
    lines.push(pkt(Buffer.concat([Buffer.from([number]), bytes.subarray(at, at + BAND_MAX)])));
  }
  return Buffer.concat(lines);
}

export class FakeGitHub {
  readonly port: number;
  readonly #server: Server;
  readonly #commands: string[] = [];
  readonly #sockets = new Set<Socket>();

  private constructor(server: Server, port: number) {
    this.#server = server;
    this.port = port;
  }

  /** Advertises `refs/heads/main` and `refs/pull/1/head`, at `main` and `head`. */
  static async start(main: string, head: string, answer: Answer): Promise<FakeGitHub> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the server has no port');
    const github = new FakeGitHub(server, address.port);
    const refs = [`${main} refs/heads/main\n`, `${head} refs/pull/1/head\n`];
    server.on('connection', (socket) => {
      github.#sockets.add(socket);
      socket.on('close', () => github.#sockets.delete(socket));
      socket.on('error', () => undefined);
      void github.#serve(socket, refs, answer);
    });
    return github;
  }

  /** One that never sends a pack, with the same made-up commit at both refs. */
  static keepingAlive(counting: boolean): Promise<FakeGitHub> {
    return FakeGitHub.start(FAKE_OID, FAKE_OID, { kind: 'keepAlive', counting });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The `command=` of each request git posted. */
  commands(): string[] {
    return [...this.#commands];
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #serve(socket: Socket, refs: readonly string[], answer: Answer): Promise<void> {
    const request = await readRequest(socket);
    if (request === undefined) return;
    const respond = (kind: string, body: Buffer) => {
      const head =
        `HTTP/1.1 200 OK\r\nContent-Type: application/x-git-upload-pack-${kind}\r\n` +
        `Cache-Control: no-cache\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`;
      socket.end(Buffer.concat([Buffer.from(head), body]));
    };
    if (request.path.includes('/info/refs')) {
      const capabilities = ['version 2\n', 'agent=lo-test\n', 'ls-refs\n', 'fetch=filter\n'];
      respond('advertisement', Buffer.concat([...capabilities.map(pkt), Buffer.from('0000')]));
      return;
    }
    // The first pkt-line: "command=ls-refs\n", or "command=fetch".
    const length = Number.parseInt(request.body.subarray(0, 4).toString('latin1'), 16);
    const first = request.body.subarray(4, length).toString('utf8');
    const command = first.startsWith('command=') ? first.slice('command='.length).trimEnd() : '';
    this.#commands.push(command);
    if (command === 'ls-refs') {
      respond('result', Buffer.concat([...refs.map(pkt), Buffer.from('0000')]));
      return;
    }
    if (command !== 'fetch') {
      socket.end();
      return;
    }
    // No length: the pack ends when the connection does.
    const head =
      'HTTP/1.1 200 OK\r\nContent-Type: application/x-git-upload-pack-result\r\n' +
      'Cache-Control: no-cache\r\nConnection: close\r\n\r\n';
    socket.write(Buffer.concat([Buffer.from(head), pkt('packfile\n')]));
    if (answer.kind === 'keepAlive') {
      if (answer.counting) {
        socket.write(
          Buffer.concat([
            band(2, 'Enumerating objects: 2, done.\n'),
            band(2, 'Counting objects:  50% (1/2)\r'),
          ]),
        );
      }
      await keepAlive(socket);
      return;
    }
    const size = Math.ceil(answer.pack.length / answer.pieces);
    for (let sent = 0; sent * size < answer.pack.length; sent++) {
      if (answer.stopAfter === sent) {
        await keepAlive(socket);
        return;
      }
      if (socket.destroyed) return;
      socket.write(band(1, answer.pack.subarray(sent * size, (sent + 1) * size)));
      await sleep(answer.every);
    }
    socket.end(Buffer.from('0000'));
  }
}

/** Reads one request: its path and its body, decompressed. */
async function readRequest(socket: Socket): Promise<{ path: string; body: Buffer } | undefined> {
  let data = Buffer.alloc(0);
  for (;;) {
    const request = parseRequest(data);
    if (request !== undefined) return request;
    const chunk = await new Promise<Buffer | undefined>((resolve) => {
      const onData = (piece: Buffer) => {
        cleanup();
        resolve(piece);
      };
      const onEnd = () => {
        cleanup();
        resolve(undefined);
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('end', onEnd);
        socket.off('close', onEnd);
      };
      socket.on('data', onData);
      socket.once('end', onEnd);
      socket.once('close', onEnd);
    });
    if (chunk === undefined) return undefined;
    data = Buffer.concat([data, chunk]);
  }
}

/** The request in `data`, or `undefined` while it isn't all there. */
function parseRequest(data: Buffer): { path: string; body: Buffer } | undefined {
  const end = data.indexOf('\r\n\r\n');
  if (end === -1) return undefined;
  const head = data.subarray(0, end).toString('latin1');
  const header = (name: string) =>
    head
      .split('\r\n')
      .map((line) => line.split(/:\s*/, 2))
      .find(([key]) => key?.toLowerCase() === name)?.[1];
  let rest = data.subarray(end + 4);
  let body: Buffer;
  if (header('transfer-encoding')?.toLowerCase() === 'chunked') {
    const pieces: Buffer[] = [];
    for (;;) {
      const line = rest.indexOf('\r\n');
      if (line === -1) return undefined;
      const size = Number.parseInt(rest.subarray(0, line).toString('latin1'), 16);
      if (rest.length < line + 2 + size + 2) return undefined;
      if (size === 0) break;
      pieces.push(rest.subarray(line + 2, line + 2 + size));
      rest = rest.subarray(line + 2 + size + 2);
    }
    body = Buffer.concat(pieces);
  } else {
    const length = Number(header('content-length') ?? 0);
    if (rest.length < length) return undefined;
    body = rest.subarray(0, length);
  }
  // git compresses a request of more than a kilobyte, such as a fetch of hundreds of files by ID.
  if (header('content-encoding')?.toLowerCase() === 'gzip') body = gunzipSync(body);
  return { path: head.split(' ')[1] ?? '', body };
}

/** Sends upload-pack's keep-alive ten times a second until the client hangs up or a minute passes. */
async function keepAlive(socket: Socket): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 60_000 && !socket.destroyed) {
    await sleep(100);
    if (!socket.destroyed) socket.write(Buffer.from('0005\x01', 'latin1'));
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * A history of `commits` commits on `main`, each adding a file, made by real git in the bare
 * repository `gitDir`: its first commit, its last, and a pack of all of it, as GitHub would send
 * for a first fetch of its last.
 */
export function history(
  gitDir: string,
  commits: number,
): { first: string; last: string; pack: Buffer } {
  mkdirSync(gitDir, { recursive: true });
  const git = (args: string[], input?: string | Buffer) =>
    gitBytes(gitDir, [`--git-dir=${gitDir}`, ...args], input);
  git(['init', '--quiet', '--bare']);
  let stream = '';
  for (let commit = 1; commit <= commits; commit++) {
    const message = `commit ${commit}\n`;
    const text = `file ${commit}\n`.repeat(20);
    stream +=
      `commit refs/heads/main\ncommitter Test <test@example.com> ${1_700_000_000 + commit} +0000\n` +
      `data ${message.length}\n${message}M 100644 inline file-${commit}.txt\ndata ${text.length}\n${text}\n`;
  }
  git(['fast-import', '--quiet'], stream);
  const [first = '', last = ''] = git(['rev-parse', `main~${commits - 1}`, 'main'])
    .toString('utf8')
    .trim()
    .split('\n');
  const pack = git(['pack-objects', '--stdout', '--revs', '--quiet'], 'main\n');
  return { first, last, pack };
}
