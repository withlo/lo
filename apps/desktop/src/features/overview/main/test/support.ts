// What the overview feature's main tests share: a database with the feature's tables, and a GitHub
// that answers for overviews made up in the test, keeping what it was asked.

import { createHash } from 'node:crypto';

import { GithubClient, Token } from '@lo/github';

import { openDatabase, type Database } from '../../../../main/database.ts';
import { migrate } from '../../../../main/migrations.ts';

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\/\.\.\//, '/src/features/overview/'), sql]),
);

/** A database in memory with the feature's tables. */
export function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

/** The ID git gives a blob of `bytes`. */
export function idOf(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

/** An ID made from `seed`, for a commit or tree a test names. */
export function fakeId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex');
}

/** A tree item as GitHub lists one. */
export interface Item {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

/** An overview made up in a test: its commit, the tree's items, and the files' bytes by ID. */
export interface MadeOverview {
  commit: string;
  tree: string;
  items: Item[];
  files: Map<string, Uint8Array>;
}

/** The text of an overview of pull request `pr`, with `body` after its header. */
export function artifactText(pr: number, body = '## tl;dr\n\nIt reads.\n'): string {
  return `---\nformat: 1\npr: ${pr}\ncommit: ${'c'.repeat(40)}\n---\n\n${body}`;
}

/**
 * An overview of `files`, by path: folders listed before what's in them, as GitHub lists them.
 * `extra` adds items as they are, such as a submodule or a link.
 */
export function overview(
  seed: string,
  files: Record<string, string | Uint8Array>,
  extra: Item[] = [],
): MadeOverview {
  const items: Item[] = [];
  const blobs = new Map<string, Uint8Array>();
  const folders = new Set<string>();
  for (const [path, contents] of Object.entries(files)) {
    const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      if (folders.has(folder)) continue;
      folders.add(folder);
      items.push({ path: folder, mode: '040000', type: 'tree', sha: fakeId(`${seed}:${folder}`) });
    }
    const sha = idOf(bytes);
    blobs.set(sha, bytes);
    items.push({ path, mode: '100644', type: 'blob', sha, size: bytes.length });
  }
  items.push(...extra);
  return { commit: fakeId(`${seed}:commit`), tree: fakeId(`${seed}:tree`), items, files: blobs };
}

/** A request the fake GitHub was sent: its method and path, and the ETag it sent. */
export interface Asked {
  path: string;
  etag: string | null;
  accept: string | null;
}

/**
 * A GitHub that answers for the overviews put in it: each repository's refs, by `owner/name`,
 * with an ETag of what they hold, and the commits, trees and files of the overviews it holds.
 * `answer` can stand in for any request's answer, by its path.
 */
export class FakeGithub {
  /** What each repository's refs hold, by `owner/name`: a commit's ID, or another object. */
  readonly refs = new Map<string, { number: number; sha: string; type: string }[]>();
  readonly commits = new Map<
    string,
    { tree: string; login: string | null; name: string; date: string }
  >();
  readonly trees = new Map<string, { items: Item[]; truncated: boolean }>();
  readonly blobs = new Map<string, Uint8Array>();
  /** Answers that stand in for GitHub's, by the request's path. */
  readonly answer = new Map<string, () => Response>();
  /** The `x-poll-interval` new answers about refs carry, if any: GitHub's is 300. */
  pollInterval: string | undefined;
  readonly asked: Asked[] = [];
  readonly client: GithubClient;

  constructor() {
    this.client = new GithubClient({
      fetch: (input, init) => this.#respond(new Request(input, init)),
      token: new Token('gho_FAKE_OVERVIEW'),
    });
  }

  /** Puts `made` on pull request `number`'s ref in `repository`, with its commit and files. */
  push(
    repository: string,
    number: number,
    made: MadeOverview,
    options: { login?: string | null; name?: string; date?: string; truncated?: boolean } = {},
  ): void {
    this.point(repository, number, made.commit, 'commit');
    this.commits.set(made.commit, {
      tree: made.tree,
      login: options.login === undefined ? 'rozed-bot' : options.login,
      name: options.name ?? 'rozed-bot',
      date: options.date ?? '2026-11-11T09:30:00Z',
    });
    this.trees.set(made.tree, { items: made.items, truncated: options.truncated ?? false });
    for (const [sha, bytes] of made.files) this.blobs.set(sha, bytes);
  }

  /** Points pull request `number`'s ref in `repository` at `sha`, an object of `type`. */
  point(repository: string, number: number, sha: string, type: string): void {
    const refs = (this.refs.get(repository) ?? []).filter((ref) => ref.number !== number);
    this.refs.set(repository, [...refs, { number, sha, type }]);
  }

  /** Takes pull request `number`'s ref away in `repository`. */
  remove(repository: string, number: number): void {
    this.refs.set(
      repository,
      (this.refs.get(repository) ?? []).filter((ref) => ref.number !== number),
    );
  }

  /** The paths asked for, in order, with the API's prefix left out. */
  paths(): string[] {
    return this.asked.map(({ path }) => path);
  }

  async #respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/repos\//, '') + url.search;
    const etag = request.headers.get('if-none-match');
    this.asked.push({ path, etag, accept: request.headers.get('accept') });
    const standIn = this.answer.get(path);
    if (standIn) return standIn();
    let match = /^([^/]+\/[^/]+)\/git\/matching-refs\/lo\/pr\/(\d+)$/.exec(path);
    if (match) {
      const [, repository = '', prefix = ''] = match;
      const listed = (this.refs.get(repository) ?? [])
        .filter(({ number }) => `refs/lo/pr/${number}`.startsWith(`refs/lo/pr/${prefix}`))
        .map(({ number, sha, type }) => ({ ref: `refs/lo/pr/${number}`, object: { sha, type } }));
      const tag = `"${createHash('sha256').update(JSON.stringify(listed)).digest('hex')}"`;
      if (etag === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      const headers: Record<string, string> = { etag: tag };
      if (this.pollInterval !== undefined) headers['x-poll-interval'] = this.pollInterval;
      return Response.json(listed, { headers });
    }
    match = /^[^/]+\/[^/]+\/commits\/([0-9a-f]+)$/.exec(path);
    if (match) {
      const sha = match[1] ?? '';
      const commit = this.commits.get(sha);
      if (!commit) return notFound();
      return Response.json({
        sha,
        author: commit.login === null ? null : { login: commit.login },
        commit: {
          author: { name: commit.name, date: commit.date },
          committer: { name: commit.name, date: commit.date },
          tree: { sha: commit.tree },
        },
      });
    }
    match = /^[^/]+\/[^/]+\/git\/trees\/([0-9a-f]+)\?recursive=1$/.exec(path);
    if (match) {
      const sha = match[1] ?? '';
      const tree = this.trees.get(sha);
      if (!tree) return notFound();
      return Response.json({ sha, tree: tree.items, truncated: tree.truncated });
    }
    match = /^[^/]+\/[^/]+\/git\/blobs\/([0-9a-f]+)$/.exec(path);
    if (match) {
      const bytes = this.blobs.get(match[1] ?? '');
      if (!bytes) return notFound();
      return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'text/plain' } });
    }
    return notFound();
  }
}

/** GitHub's answer for what isn't there. */
export function notFound(): Response {
  return Response.json({ message: 'Not Found' }, { status: 404 });
}
