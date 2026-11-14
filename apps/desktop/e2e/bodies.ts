// A server in front of the replay server, for tests that show posts: it answers each read of posts'
// HTML (`RenderedBodies`) itself, from what the cassette recorded, and passes every other request
// on. Which posts the window asks for at once depends on which are near the screen, and so on the
// window's size and how fast it draws, so a read can't be matched to a recorded one as it was
// asked. Each post is answered as it was recorded, and one that wasn't as GitHub answers an ID it
// has no post for. It can also cut the connection of a write once its request has come, as a proxy
// that drops it would, and says which GraphQL operations came.

import { createServer, type ServerResponse } from 'node:http';
import { buffer } from 'node:stream/consumers';

import { cassetteDir, parseJson, readCassette, type Json } from '@lo/testing';

/** An object of JSON, or nothing for any other value. */
function objectOf(value: Json | undefined): { [key: string]: Json } | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

/**
 * Every read of posts' HTML `cassette` recorded, as one: the first answer's description and
 * rate limit, and the posts of them all.
 */
function recordedBodies(cassette: string): {
  data: { [key: string]: Json };
  posts: Map<Json, Json>;
} {
  const answers = readCassette(cassetteDir(cassette))
    .interactions.filter(({ interaction }) => interaction.request.operation === 'RenderedBodies')
    .map(({ interaction }) => objectOf(objectOf(interaction.response.body)?.['data']))
    .filter((data) => data !== undefined);
  const [data] = answers;
  if (!data) throw new Error(`${cassette} has no read of posts' HTML`);
  const posts = new Map<Json, Json>();
  for (const answer of answers) {
    const nodes = Array.isArray(answer['nodes']) ? answer['nodes'] : [];
    for (const node of nodes) {
      const id = objectOf(node)?.['id'];
      if (id !== undefined) posts.set(id, node);
    }
  }
  return { data, posts };
}

function json(outgoing: ServerResponse, body: Json): void {
  outgoing.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  outgoing.end(JSON.stringify(body));
}

export interface BodiesServer {
  /** Where Lo finds GitHub: this server's origin. */
  readonly origin: string;
  /** The name of each GraphQL operation that came, in order. */
  readonly operations: string[];
  close(): Promise<void>;
}

export interface BodiesOptions {
  /**
   * The GraphQL operation whose connection is cut once its whole request has come, with no answer,
   * as a proxy that drops the connection then would.
   */
  readonly cut?: string | undefined;
}

/**
 * Serves, on `127.0.0.1`, reads of posts' HTML from what `cassette` recorded, and passes every
 * other request on to the replay server at `behind`, its origin.
 */
export async function serveBodies(
  cassette: string,
  behind: string,
  options: BodiesOptions = {},
): Promise<BodiesServer> {
  const { data, posts } = recordedBodies(cassette);
  const operations: string[] = [];
  const front = createServer((incoming, outgoing) => {
    void (async () => {
      const body = await buffer(incoming);
      if (incoming.url?.endsWith('/graphql')) {
        const asked = objectOf(parseJson(body.toString('utf8')));
        const name = asked?.['operationName'];
        if (typeof name === 'string') operations.push(name);
        if (name !== undefined && name === options.cut) {
          incoming.socket.destroy();
          return undefined;
        }
        if (asked?.['operationName'] === 'RenderedBodies') {
          const ids = objectOf(asked['variables'])?.['ids'];
          const strings = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
          return json(outgoing, {
            data: { ...data, nodes: strings.map((id) => posts.get(id) ?? null) },
          });
        }
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string' && name !== 'host') headers.set(name, value);
      }
      const method = incoming.method ?? 'GET';
      const response = await fetch(`${behind}${incoming.url ?? '/'}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
        redirect: 'manual',
      });
      const out: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        if (!['content-length', 'content-encoding', 'transfer-encoding'].includes(name)) {
          out[name] = value;
        }
      });
      outgoing.writeHead(response.status, out);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
      return undefined;
    })().catch(() => {
      // The test has ended, and the replay server with it: the request goes unanswered.
      outgoing.destroy();
    });
  });
  // Cutting a write's connection, the connections stay open between requests, as GitHub's do, so
  // a network stack that sends a request again when its reused connection drops has one to reuse.
  if (options.cut !== undefined) front.keepAliveTimeout = 60_000;
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  const address = front.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    operations,
    async close() {
      front.closeAllConnections();
      await new Promise((resolve) => front.close(resolve));
    },
  };
}
