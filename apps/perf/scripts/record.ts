// Records the manifests in `data/` from GitHub's API. Only the suite's maintainers need it: the
// manifests are committed, and the fetch script needs no token.
//
//   pnpm nx run perf:record                       every PR
//   pnpm nx run perf:record -- kubernetes-125488  one PR, by its manifest's name
//
// It records as the project's test account and refuses any other. The token comes from the file
// `LO_FIXTURE_TOKEN_FILE` names, else from the test account's files in ~/.config/rozed-dev. It
// never prints the token, and refuses to write anything shaped like one.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import * as prettier from 'prettier';
import { z } from 'zod';

import {
  type ChangedFile,
  countTokens,
  dataFolder,
  FileStatus,
  Manifest,
  manifestName,
  type Thread,
} from '../src/data/manifest.ts';

/** The pull requests the suite measures. */
export const pullRequests = [
  { repo: 'kubernetes/kubernetes', number: 125488 },
  { repo: 'microsoft/TypeScript', number: 51387 },
  { repo: 'microsoft/TypeScript', number: 54820 },
];

/** The one account recordings are made as: a test account, never a person's. */
const account = 'rozed-bot';

const tokenFormat = /^(?:gh[opsu]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)$/;

/** A place the test account's token is kept, and the token read from it. */
export interface TokenSource {
  file: string;
  token: string;
}

/**
 * The test account's tokens, in the order to try them: the file `LO_FIXTURE_TOKEN_FILE` names
 * alone when it's set, else `~/.config/rozed-dev/oauth-token`, then `ROZED_BOT_TOKEN` in
 * `~/.config/rozed-dev/bot.env`. Errors name the file, never what's in it.
 */
export function tokenSources(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): TokenSource[] {
  const folder = join(home, '.config', 'rozed-dev');
  if (env.LO_FIXTURE_TOKEN_FILE) return [readToken(env.LO_FIXTURE_TOKEN_FILE)];
  const sources = [
    { file: join(folder, 'oauth-token') },
    { file: join(folder, 'bot.env'), variable: 'ROZED_BOT_TOKEN' },
  ].filter(({ file }) => existsSync(file));
  if (sources.length === 0) {
    throw new Error('No token found: set LO_FIXTURE_TOKEN_FILE to a file holding one.');
  }
  return sources.map(({ file, variable }) => readToken(file, variable));
}

/** The token in `file`, or in the line that sets `variable` in it. */
function readToken(file: string, variable?: string): TokenSource {
  let token: string | undefined = readFileSync(file, 'utf8').trim();
  if (variable) {
    token = token
      .split('\n')
      .map((line) => line.trim().replace(/^export\s+/, ''))
      .find((line) => line.startsWith(`${variable}=`))
      ?.slice(variable.length + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
  if (!token || !tokenFormat.test(token)) throw new Error(`${file} doesn't hold a GitHub token.`);
  return { file, token };
}

const RestFile = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: FileStatus,
});

const FileCounts = z.object({ path: z.string(), additions: z.number(), deletions: z.number() });

/**
 * A changed file, from REST's listing (its path, previous path and status) and GraphQL's (its
 * line counts). REST stops counting lines past a budget and reports the rest as unchanged, while
 * GraphQL counts them all.
 */
export function toFile(
  file: z.infer<typeof RestFile>,
  { additions, deletions }: z.infer<typeof FileCounts>,
): ChangedFile {
  return {
    path: file.filename,
    ...(file.previous_filename !== undefined && { previousPath: file.previous_filename }),
    status: file.status,
    additions,
    deletions,
  };
}

const PageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

const Comments = z.object({
  pageInfo: PageInfo,
  nodes: z.array(z.object({ body: z.string() })),
});

const GraphThread = z.object({
  id: z.string(),
  path: z.string(),
  diffSide: z.enum(['LEFT', 'RIGHT']),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  isOutdated: z.boolean(),
  subjectType: z.enum(['LINE', 'FILE']),
  comments: Comments,
});

/**
 * A review thread as GitHub's GraphQL API returns it, with all its comments' bodies, reduced to
 * where it sits and how long each comment is.
 */
export function toThread(thread: z.infer<typeof GraphThread>, bodies: readonly string[]): Thread {
  const line = thread.isOutdated ? thread.originalLine : thread.line;
  return {
    path: thread.path,
    side: thread.diffSide === 'LEFT' ? 'left' : 'right',
    ...(thread.subjectType === 'LINE' && line !== null && { line }),
    ...(thread.isOutdated && { outdated: true as const }),
    comments: bodies.map((body) => body.length),
  };
}

/**
 * The manifest as committed: one line per file and thread, formatted by the repo's Prettier
 * settings. Refuses when the text holds anything shaped like a token, or `token` itself.
 */
export async function serialize(manifest: Manifest, token?: string): Promise<string> {
  const { files, threads, ...rest } = Manifest.parse(manifest);
  const fields = Object.entries(rest).map(([key, value]) => `  "${key}": ${JSON.stringify(value)}`);
  const text = `{\n${fields.join(',\n')},\n  "files": ${list(files)},\n  "threads": ${list(threads)}\n}\n`;
  const file = join(dataFolder, `${manifestName(manifest)}.json`);
  const formatted = await prettier.format(text, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
  if (countTokens(formatted) > 0 || (token !== undefined && formatted.includes(token))) {
    throw new Error(`Refusing to write ${file}: it holds something shaped like a token.`);
  }
  if (!isDeepStrictEqual(JSON.parse(formatted), manifest)) {
    throw new Error(`${file} doesn't read back as the manifest it was made from.`);
  }
  return formatted;
}

/** A list in the manifest, one item per line. */
function list(items: readonly unknown[]): string {
  if (items.length === 0) return '[]';
  return `[\n${items.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`;
}

/** A response GitHub refused, with its status. */
class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type Get = <T>(path: string, schema: z.ZodType<T>) => Promise<T>;
type Query = <T>(query: string, variables: object, schema: z.ZodType<T>) => Promise<T>;

function client(token: string): { get: Get; query: Query } {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'lo-perf',
    'x-github-api-version': '2022-11-28',
  };
  const send = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    // No redirects, so the token never goes anywhere but GitHub's API.
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers,
      redirect: 'error',
    });
    if (!response.ok) {
      const message = `${init.method ?? 'GET'} ${path}: ${response.status} ${response.statusText}`;
      throw new HttpError(message, response.status);
    }
    return response.json();
  };
  const GraphResponse = z.object({
    data: z.unknown(),
    errors: z.array(z.object({ message: z.string() })).optional(),
  });
  return {
    get: async (path, schema) => schema.parse(await send(path)),
    query: async (query, variables, schema) => {
      const body = { query, variables };
      const { data, errors } = GraphResponse.parse(
        await send('/graphql', { method: 'POST', body: JSON.stringify(body) }),
      );
      if (errors?.length) throw new Error(errors.map(({ message }) => message).join('\n'));
      return schema.parse(data);
    },
  };
}

/** Every node of one of a PR's GraphQL connections, a hundred at a time. */
async function listAll<T>(
  query: Query,
  { repo, number }: { repo: string; number: number },
  connection: string,
  fields: string,
  node: z.ZodType<T>,
): Promise<T[]> {
  const text = `query ($owner: String!, $name: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        ${connection}(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${fields} } }
      }
    }
  }`;
  const Page = z.object({
    repository: z.object({
      pullRequest: z.record(z.string(), z.object({ pageInfo: PageInfo, nodes: z.array(node) })),
    }),
  });
  const [owner, name] = repo.split('/');
  const nodes: T[] = [];
  for (let after: string | null = null; ;) {
    const page: z.infer<typeof Page> = await query(text, { owner, name, number, after }, Page);
    const found = page.repository.pullRequest[connection];
    if (!found) throw new Error(`GraphQL sent no ${connection} for ${repo}#${number}.`);
    const { pageInfo } = found;
    nodes.push(...found.nodes);
    if (!pageInfo.hasNextPage) return nodes;
    after = pageInfo.endCursor;
  }
}

const commentsQuery = `query ($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { body } }
    }
  }
}`;

async function record(
  { get, query }: ReturnType<typeof client>,
  pr: { repo: string; number: number },
): Promise<Manifest> {
  const { repo, number } = pr;
  const pull = await get(
    `/repos/${repo}/pulls/${number}`,
    z.object({
      base: z.object({ sha: z.string() }),
      head: z.object({ sha: z.string() }),
      changed_files: z.number(),
      additions: z.number(),
      deletions: z.number(),
    }),
  );
  // The PR's diff starts at the merge base, not at the base branch's commit.
  const compare = await get(
    `/repos/${repo}/compare/${pull.base.sha}...${pull.head.sha}?per_page=1`,
    z.object({ merge_base_commit: z.object({ sha: z.string() }) }),
  );

  const listed: z.infer<typeof RestFile>[] = [];
  for (let page = 1; ; page++) {
    const batch = await get(
      `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      z.array(RestFile),
    );
    listed.push(...batch);
    if (batch.length < 100) break;
  }
  const counts = new Map(
    (await listAll(query, pr, 'files', 'path additions deletions', FileCounts)).map((file) => [
      file.path,
      file,
    ]),
  );
  const files = listed.map((file) => {
    const count = counts.get(file.filename);
    if (!count) throw new Error(`GraphQL doesn't list ${repo}#${number}'s ${file.filename}.`);
    return toFile(file, count);
  });
  const sum = (key: 'additions' | 'deletions'): number =>
    files.reduce((total, file) => total + file[key], 0);
  if (
    files.length !== pull.changed_files ||
    counts.size !== files.length ||
    sum('additions') !== pull.additions ||
    sum('deletions') !== pull.deletions
  ) {
    throw new Error(`The files GitHub listed don't add up to ${repo}#${number}'s totals.`);
  }

  const threads: Thread[] = [];
  for (const thread of await listAll(
    query,
    pr,
    'reviewThreads',
    `id path diffSide line originalLine isOutdated subjectType
      comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { body } }`,
    GraphThread,
  )) {
    const bodies = thread.comments.nodes.map(({ body }) => body);
    for (let page = thread.comments.pageInfo; page.hasNextPage;) {
      const more = await query(
        commentsQuery,
        { id: thread.id, after: page.endCursor },
        z.object({ node: z.object({ comments: Comments }) }),
      );
      bodies.push(...more.node.comments.nodes.map(({ body }) => body));
      page = more.node.comments.pageInfo;
    }
    threads.push(toThread(thread, bodies));
  }

  return Manifest.parse({
    repo,
    number,
    base: compare.merge_base_commit.sha,
    head: pull.head.sha,
    files,
    threads,
  });
}

async function main(names: readonly string[]): Promise<void> {
  const unknown = names.filter((name) => !pullRequests.some((pr) => manifestName(pr) === name));
  if (unknown.length > 0) throw new Error(`No such PR: ${unknown.join(', ')}`);

  // Before anything else: whose token this is. One GitHub no longer accepts gives way to the next.
  let signedIn: { github: ReturnType<typeof client>; token: string } | undefined;
  for (const { file, token } of tokenSources()) {
    const github = client(token);
    let login: string;
    try {
      ({ login } = await github.get('/user', z.object({ login: z.string() })));
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) throw error;
      console.error(`GitHub doesn't accept the token in ${file}.`);
      continue;
    }
    if (login !== account) {
      throw new Error(
        `The token in ${file} is ${login}'s. Recordings are made only as ${account}.`,
      );
    }
    signedIn = { github, token };
    break;
  }
  if (!signedIn) throw new Error(`No token GitHub accepts for ${account}.`);

  for (const pr of pullRequests) {
    const name = manifestName(pr);
    if (names.length > 0 && !names.includes(name)) continue;
    const manifest = await record(signedIn.github, pr);
    writeFileSync(join(dataFolder, `${name}.json`), await serialize(manifest, signedIn.token));
    const comments = manifest.threads.reduce((total, thread) => total + thread.comments.length, 0);
    const left = manifest.threads.filter(({ side }) => side === 'left').length;
    console.log(
      `${name}: ${manifest.files.length} files, ${manifest.threads.length} threads ` +
        `(${left} on the left) with ${comments} comments`,
    );
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
