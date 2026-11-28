// What the overview feature's main tests share: a database with the feature's tables, and a GitHub
// that answers for overviews made up in the test, keeping what it was asked; and that takes the
// writes of the definitions, as GitHub's API does: trees, commits, and their ref moved only from
// the commit it holds and only forward, by whoever has push access.

import { createHash } from 'node:crypto';

import { GithubClient, Token } from '@lo/github';
import { z } from 'zod';

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

/** A GraphQL request, as the client sends one. */
const GRAPHQL = z.object({
  query: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
});

/** A tree made through the API, as Lo makes one: files given whole. */
const TREE = z.object({
  tree: z.array(
    z.object({ path: z.string(), mode: z.string(), type: z.literal('blob'), content: z.string() }),
  ),
});

/** A commit made through the API. */
const COMMIT = z.object({ message: z.string(), tree: z.string(), parents: z.array(z.string()) });

/** What GitHub's `updateRefs` says of a move from a commit the ref no longer holds, and more. */
export const WENT_WRONG =
  'Something went wrong while executing your query. Please include `F00D:1234` when reporting this issue.';

/** A request the fake GitHub was sent: its method and path, and the ETag it sent. */
export interface Asked {
  path: string;
  etag: string | null;
  accept: string | null;
}

/** A ref under `refs/lo/`: a pull request's overview's, by its number, or any, by its full name. */
export type RefName = number | string;

function refName(ref: RefName): string {
  return typeof ref === 'number' ? `refs/lo/pr/${ref}` : ref;
}

/**
 * A GitHub that answers for the overviews put in it: each repository's refs, by `owner/name`,
 * with an ETag of what they hold, and the commits, trees and files of the overviews it holds.
 * `answer` can stand in for any request's answer, by its path.
 */
export class FakeGithub {
  /** What each repository's refs hold, by `owner/name`: a commit's ID, or another object. */
  readonly refs = new Map<string, { ref: string; sha: string; type: string }[]>();
  readonly commits = new Map<
    string,
    { tree: string; login: string | null; name: string; date: string; parents?: string[] }
  >();
  /**
   * Each repository's account's permission, by `owner/name`, as GitHub's `viewerPermission` says
   * it: `WRITE` where none is set; `hidden` for one the account can't see.
   */
  readonly permissions = new Map<string, string>();
  /** The commits written through the API, in order, with their messages. */
  readonly written: { sha: string; message: string; parents: string[] }[] = [];
  readonly trees = new Map<string, { items: Item[]; truncated: boolean }>();
  readonly blobs = new Map<string, Uint8Array>();
  /**
   * Answers that stand in for GitHub's, by the request's path, or for GraphQL, `graphql` and the
   * operation's name. One that throws is no answer, as a connection lost.
   */
  readonly answer = new Map<string, () => Response | Promise<Response>>();
  /** What's done as a request comes, by its path, before it's answered: as another writer would. */
  readonly before = new Map<string, () => void | Promise<void>>();
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

  /**
   * Puts `made` on pull request `ref`'s overview's ref in `repository`, or on the ref `ref` names,
   * with its commit and files.
   */
  push(
    repository: string,
    ref: RefName,
    made: MadeOverview,
    options: { login?: string | null; name?: string; date?: string; truncated?: boolean } = {},
  ): void {
    this.point(repository, ref, made.commit, 'commit');
    this.commits.set(made.commit, {
      tree: made.tree,
      login: options.login === undefined ? 'rozed-bot' : options.login,
      name: options.name ?? 'rozed-bot',
      date: options.date ?? '2026-11-11T09:30:00Z',
    });
    this.trees.set(made.tree, { items: made.items, truncated: options.truncated ?? false });
    for (const [sha, bytes] of made.files) this.blobs.set(sha, bytes);
  }

  /** Points `ref` in `repository` at `sha`, an object of `type`. */
  point(repository: string, ref: RefName, sha: string, type: string): void {
    const name = refName(ref);
    const refs = (this.refs.get(repository) ?? []).filter((each) => each.ref !== name);
    this.refs.set(repository, [...refs, { ref: name, sha, type }]);
  }

  /** Takes `ref` away in `repository`. */
  remove(repository: string, ref: RefName): void {
    const name = refName(ref);
    this.refs.set(
      repository,
      (this.refs.get(repository) ?? []).filter((each) => each.ref !== name),
    );
  }

  /** The paths asked for, in order, with the API's prefix left out. */
  paths(): string[] {
    return this.asked.map(({ path }) => path);
  }

  /** Whether `ancestor` is `commit` or a commit it comes after. */
  descends(commit: string, ancestor: string): boolean {
    const seen = new Set<string>();
    const left = [commit];
    while (left.length > 0) {
      const each = left.pop() ?? '';
      if (each === ancestor) return true;
      if (seen.has(each)) continue;
      seen.add(each);
      left.push(...(this.commits.get(each)?.parents ?? []));
    }
    return false;
  }

  /** The commit `ref` holds in `repository`, if it holds one. */
  held(repository: string, ref: RefName): string | undefined {
    const name = refName(ref);
    return this.refs.get(repository)?.find((each) => each.ref === name)?.sha;
  }

  async #respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let path = url.pathname.replace(/^\/repos\//, '') + url.search;
    const body = request.method === 'GET' ? undefined : await request.text();
    if (path === '/graphql') {
      const { query = '' } = GRAPHQL.parse(JSON.parse(body ?? '{}'));
      path = `graphql ${/(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? '?'}`;
    }
    const etag = request.headers.get('if-none-match');
    this.asked.push({ path, etag, accept: request.headers.get('accept') });
    await this.before.get(path)?.();
    const standIn = this.answer.get(path);
    if (standIn) return standIn();
    if (path.startsWith('graphql ')) return this.#graphql(path, body ?? '{}');
    if (request.method === 'POST') return this.#write(path, body ?? '{}');
    const compared = /^([^/]+\/[^/]+)\/compare\/([0-9a-f]+)\.\.\.([0-9a-f]+)\?per_page=1$/.exec(
      path,
    );
    if (compared) {
      const [, , base = '', head = ''] = compared;
      const status =
        base === head
          ? 'identical'
          : this.descends(head, base)
            ? 'ahead'
            : this.descends(base, head)
              ? 'behind'
              : 'diverged';
      return Response.json({ status });
    }
    let match = /^([^/]+\/[^/]+)\/git\/matching-refs\/(lo\/[a-z0-9/]+)$/.exec(path);
    if (match) {
      const [, repository = '', prefix = ''] = match;
      const listed = (this.refs.get(repository) ?? [])
        .filter(({ ref }) => ref.startsWith(`refs/${prefix}`))
        .map(({ ref, sha, type }) => ({ ref, object: { sha, type } }));
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
    match = /^[^/]+\/[^/]+\/git\/trees\/([0-9a-f]+)(\?recursive=1)?$/.exec(path);
    if (match) {
      // A commit's ID names its tree too, and GitHub names the answer by what was asked for.
      const sha = match[1] ?? '';
      const tree = this.trees.get(this.commits.get(sha)?.tree ?? sha);
      if (!tree) return notFound();
      // Without `recursive`, the top of the tree alone.
      const items = match[2] ? tree.items : tree.items.filter((item) => !item.path.includes('/'));
      return Response.json({ sha, tree: items, truncated: tree.truncated });
    }
    match = /^[^/]+\/[^/]+\/git\/blobs\/([0-9a-f]+)$/.exec(path);
    if (match) {
      const bytes = this.blobs.get(match[1] ?? '');
      if (!bytes) return notFound();
      return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'text/plain' } });
    }
    return notFound();
  }

  #permission(repository: string): string {
    return this.permissions.get(repository) ?? 'WRITE';
  }

  #pushes(repository: string): boolean {
    return ['WRITE', 'MAINTAIN', 'ADMIN'].includes(this.#permission(repository));
  }

  /** The writes of the definitions: a tree holding `terms.json`, and a commit of it. */
  #write(path: string, body: string): Response {
    const match = /^([^/]+\/[^/]+)\/git\/(trees|commits)$/.exec(path);
    if (!match) return notFound();
    const [, repository = '', what] = match;
    // Without push access, GitHub won't say there's anywhere to write.
    if (!this.#pushes(repository)) return notFound();
    if (what === 'trees') {
      const { tree } = TREE.parse(JSON.parse(body));
      const items = tree.map((each) => {
        const bytes = new TextEncoder().encode(each.content);
        const sha = idOf(bytes);
        this.blobs.set(sha, bytes);
        return { path: each.path, mode: each.mode, type: each.type, sha, size: bytes.length };
      });
      const sha = fakeId(`tree:${JSON.stringify(items)}`);
      this.trees.set(sha, { items, truncated: false });
      return Response.json({ sha, tree: items, truncated: false }, { status: 201 });
    }
    const commit = COMMIT.parse(JSON.parse(body));
    const sha = fakeId(`commit:${this.written.length}:${JSON.stringify(commit)}`);
    this.commits.set(sha, {
      tree: commit.tree,
      login: 'rozed-bot',
      name: 'rozed-bot',
      date: '2026-11-28T12:00:00Z',
      parents: commit.parents,
    });
    this.written.push({ sha, message: commit.message, parents: commit.parents });
    return Response.json({ sha }, { status: 201 });
  }

  /** GraphQL: whether the account may write a repository, and its definitions' ref moved. */
  #graphql(path: string, body: string): Response {
    const { variables = {} } = GRAPHQL.parse(JSON.parse(body));
    if (path === 'graphql TermsAccess') {
      const repository = `${variables.owner}/${variables.name}`;
      const permission = this.#permission(repository);
      if (permission === 'hidden') {
        return Response.json({
          data: { repository: null },
          errors: [{ type: 'NOT_FOUND', path: ['repository'], message: 'Could not resolve.' }],
        });
      }
      return Response.json({
        data: { repository: { id: `R_${repository}`, viewerPermission: permission } },
      });
    }
    if (path === 'graphql MoveTerms') {
      const repository = (variables.repositoryId ?? '').replace(/^R_/, '');
      if (!this.#pushes(repository)) {
        return Response.json({
          data: { updateRefs: null },
          errors: [{ type: 'FORBIDDEN', path: ['updateRefs'], message: 'No push access.' }],
        });
      }
      const now = this.held(repository, 'refs/lo/terms');
      const before = variables.before ?? '';
      const after = variables.after ?? '';
      // A ref that no longer holds `before`, or is there when it was to be made.
      if (/^0+$/.test(before) ? now !== undefined : now !== before) {
        return Response.json({ data: { updateRefs: null }, errors: [{ message: WENT_WRONG }] });
      }
      if (now !== undefined && !this.descends(after, now)) {
        return Response.json({
          data: { updateRefs: null },
          errors: [
            {
              type: 'UNPROCESSABLE',
              path: ['updateRefs'],
              message: 'refs/lo/terms: rejecting non-fast forward update',
            },
          ],
        });
      }
      this.point(repository, 'refs/lo/terms', after, 'commit');
      return Response.json({ data: { updateRefs: { clientMutationId: null } } });
    }
    return Response.json({ errors: [{ message: `No such operation: ${path}` }] });
  }
}

/** GitHub's answer for what isn't there. */
export function notFound(): Response {
  return Response.json({ message: 'Not Found' }, { status: 404 });
}
