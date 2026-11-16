// What the download tests serve: archives built by the test, byte by byte, so each can hold what a
// hostile one would, and a server on this machine that stands in for every download host. Nothing
// reaches the network.

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { crc32, gzipSync } from 'node:zlib';

import { Header } from 'tar';
import { onTestFinished } from 'vitest';

import type { Pinned } from '../src/index.ts';

/** An entry of a tar built by {@link tarGz}. */
export interface TarEntry {
  readonly path: string;
  readonly type?:
    'File' | 'Directory' | 'SymbolicLink' | 'Link' | 'CharacterDevice' | 'FIFO' | undefined;
  readonly data?: string | Buffer | undefined;
  readonly mode?: number | undefined;
  readonly linkpath?: string | undefined;
  /** The size its header claims, when it isn't its data's. */
  readonly size?: number | undefined;
}

/** A gzipped tar of `entries`, in order, with their headers as given. */
export function tarGz(entries: readonly TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? '');
    const type = entry.type ?? 'File';
    const header = new Header({
      path: entry.path,
      type,
      mode: entry.mode ?? (type === 'Directory' ? 0o755 : 0o644),
      uid: 0,
      gid: 0,
      mtime: new Date(0),
      size: entry.size ?? data.length,
      ...(entry.linkpath === undefined ? {} : { linkpath: entry.linkpath }),
    });
    const block = Buffer.alloc(512);
    header.encode(block, 0);
    blocks.push(block);
    if (data.length > 0) {
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** An entry of a zip built by {@link zip}: a file unless its `mode` says otherwise. */
export interface ZipEntry {
  readonly path: string;
  readonly data?: string | Buffer | undefined;
  /** Its Unix mode, type bits included. */
  readonly mode?: number | undefined;
}

/** A zip of `entries`, stored without compression, as one made on Unix. */
export function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const data = Buffer.from(entry.data ?? '');
    const mode = entry.mode ?? (entry.path.endsWith('/') ? 0o040755 : 0o100644);
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** How the test server answers one request for a path. */
export type Answer =
  | {
      readonly body: Buffer;
      readonly status?: number | undefined;
      /** How much of the body to send before dropping the connection, or holding it open. */
      readonly cut?: number | undefined;
      readonly hold?: boolean | undefined;
      /** Whether to send it without saying its length. */
      readonly chunked?: boolean | undefined;
      /** Sends the body a byte at a time, this many milliseconds apart. */
      readonly trickle?: number | undefined;
    }
  | { readonly redirect: string; readonly status?: number | undefined }
  | { readonly status: number }
  /** No answer at all, the connection held open. */
  | { readonly silent: true };

/** What the test server serves, by address: an answer, or one per request in turn. */
export type Routes = Record<string, Answer | readonly Answer[]>;

export interface Served {
  /** A `fetch` that sends each `https://<host>/<path>` to the test server. */
  readonly fetch: typeof globalThis.fetch;
  /** The addresses asked for, in order. */
  readonly asked: string[];
}

/** Serves `routes` on this machine, as their hosts would, until the test ends. */
export async function serve(routes: Routes): Promise<Served> {
  const asked: string[] = [];
  const counts = new Map<string, number>();
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const address = `https://${(request.url ?? '/').slice(1)}`;
    asked.push(address);
    const route = routes[address];
    const count = counts.get(address) ?? 0;
    counts.set(address, count + 1);
    const answer = isList(route) ? (route[count] ?? route.at(-1)) : route;
    if (answer === undefined) {
      response.writeHead(404).end();
    } else if ('silent' in answer) {
      // It never answers.
    } else if ('redirect' in answer) {
      response.writeHead(answer.status ?? 302, { location: answer.redirect }).end();
    } else if ('body' in answer) {
      const length = answer.chunked === true ? {} : { 'content-length': answer.body.length };
      response.writeHead(answer.status ?? 200, length);
      if (answer.trickle !== undefined) {
        const { body } = answer;
        let sent = 0;
        const timer = setInterval(() => {
          if (sent < body.length) response.write(body.subarray(sent, sent + 1));
          else response.end();
          sent += 1;
        }, answer.trickle);
        response.on('close', () => clearInterval(timer));
      } else if (answer.cut === undefined) {
        response.end(answer.body);
      } else {
        response.write(answer.body.subarray(0, answer.cut), () => {
          if (answer.hold !== true) response.destroy();
        });
      }
    } else {
      response.writeHead(answer.status).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const listening = server.address();
  if (listening === null || typeof listening === 'string') {
    throw new Error('the server isn’t listening');
  }
  const { port } = listening;
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    // The test server is the only one, whatever the scheme or port asked for.
    return globalThis.fetch(
      `http://127.0.0.1:${port}/${url.host}${url.pathname}${url.search}`,
      init,
    );
  };
  return { fetch, asked };
}

function isList(route: Answer | readonly Answer[] | undefined): route is readonly Answer[] {
  return Array.isArray(route);
}

/** A pin of `data` at `url`, for every platform, as `kind` with `entry` inside. */
export function pinned(
  url: string,
  data: Buffer,
  kind: 'tar.gz' | 'zip' | 'gz' | 'file',
  entry: string,
  options: { version?: string; hosts?: string[] } = {},
): Pinned {
  return {
    version: options.version ?? '1.0.0',
    hosts: options.hosts ?? [new URL(url).hostname],
    platforms: { any: { kind, url, size: data.length, sha256: sha256(data), entry } },
  };
}
