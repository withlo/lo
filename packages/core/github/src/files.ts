/**
 * The files a pull request changes, as GitHub's REST API lists them
 * (`GET /repos/{owner}/{repo}/pulls/{number}/files`), each with its patch. The PR tab shows these
 * patches until the local copy is ready (`docs/design.md`, "Before the copy is ready").
 */

import { GITHUB_URLS, type GithubClient } from './client.ts';
import { GithubError } from './errors.ts';
import { isRecord } from './graphql.ts';
import { parsePatch, type Patch } from './patch.ts';
import { resetTime, type RateLimits } from './rate-limit.ts';
import type { PullRef } from './refs.ts';

/** GitHub lists at most 100 files a page. */
export const FILES_PER_PAGE = 100;

/** GitHub lists at most 3,000 of a pull request's files; the rest only the local copy shows. */
export const MAX_FILES = 3_000;

/** The most pages GitHub lists: {@link MAX_FILES} at {@link FILES_PER_PAGE} a page. */
export const MAX_PAGES = MAX_FILES / FILES_PER_PAGE;

/** The statuses GitHub gives a file, in its words. */
const STATUSES = [
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  // The file's type or mode changed.
  'changed',
  'unchanged',
] as const;

/** How the pull request changes a file, in GitHub's words, or `other` for one Lo doesn't know. */
export type FileStatus = (typeof STATUSES)[number] | 'other';

/** One changed file. */
export interface PullFile {
  /** The file's path in the head. For a deleted file, its path in the base. */
  filename: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Additions plus deletions. */
  changes: number;
  /**
   * The file's unified diff: its hunks, without the `diff --git`, `---` and `+++` lines. GitHub
   * leaves it out for binary files, for diffs too large to show, and for changes with no changed
   * lines, such as a pure rename or a change of mode.
   */
  patch?: string | undefined;
  /** The file's path in the base, when the pull request renames or copies it. */
  previous_filename?: string | undefined;
  /**
   * The file on github.com, at the commit GitHub listed it at: the head, or for a removed file the
   * base.
   */
  blob_url?: string | undefined;
  /** The file in the API's contents, with the same commit as its `ref`. */
  contents_url?: string | undefined;
}

/** The file's patch, read; nothing when GitHub left it out. Throws a `PatchError` when it doesn't add up. */
export function parsedPatch(file: PullFile): Patch | undefined {
  return file.patch === undefined ? undefined : parsePatch(file.patch);
}

/**
 * The head commit GitHub listed the file at, from its links. Nothing for a removed file, whose
 * links name the base, or when the links don't say.
 */
export function fileHead(file: PullFile): string | undefined {
  if (file.status === 'removed') return undefined;
  const sha = refIn(file.contents_url) ?? commitIn(file.blob_url);
  return sha === '' ? undefined : sha;
}

/** The `ref` in a contents URL's query. */
function refIn(url: string | undefined): string | undefined {
  const query = url?.indexOf('?') ?? -1;
  if (url === undefined || query < 0) return undefined;
  const pair = url
    .slice(query + 1)
    .split('&')
    .find((part) => part.startsWith('ref='));
  return pair?.slice('ref='.length);
}

/** The commit in a blob URL, `…/blob/<commit>/<path>`. */
function commitIn(url: string | undefined): string | undefined {
  const blob = url?.indexOf('/blob/') ?? -1;
  if (url === undefined || blob < 0) return undefined;
  return url.slice(blob + '/blob/'.length).split('/')[0];
}

/**
 * The head commit `files` were listed at, or nothing when none says. Files that name different
 * heads were read from pages either side of a push, which is an error: reading them again gives
 * one head.
 */
export function filesHead(files: readonly PullFile[]): string | undefined {
  let head: string | undefined;
  for (const file of files) {
    const at = fileHead(file);
    if (at === undefined) continue;
    if (head === undefined) {
      head = at;
    } else if (at !== head) {
      throw new GithubError({
        kind: 'inconsistent',
        message: `the pull request moved from ${head} to ${at} while its files were read`,
      });
    }
  }
  return head;
}

/** GitHub's list of a pull request's files, read. */
export function readDiffEntries(json: unknown): PullFile[] {
  if (!Array.isArray(json)) throw unexpected("the pull request's files aren't a list");
  return json.map(readDiffEntry);
}

function readDiffEntry(json: unknown): PullFile {
  if (!isRecord(json)) throw unexpected("a file isn't an object");
  const { filename, status, additions, deletions, changes } = json;
  if (typeof filename !== 'string') throw unexpected("a file's filename isn't a string");
  if (typeof status !== 'string') throw unexpected(`${filename}'s status isn't a string`);
  if (!isCount(additions) || !isCount(deletions) || !isCount(changes)) {
    throw unexpected(`${filename}'s counts of changed lines aren't counts`);
  }
  const text = (key: string): string | undefined => {
    const value = json[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') throw unexpected(`${filename}'s ${key} isn't a string`);
    return value;
  };
  return {
    filename,
    status: STATUSES.find((known) => known === status) ?? 'other',
    additions,
    deletions,
    changes,
    patch: text('patch'),
    previous_filename: text('previous_filename'),
    blob_url: text('blob_url'),
    contents_url: text('contents_url'),
  };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function unexpected(message: string): GithubError {
  return new GithubError({ kind: 'decode', message });
}

/** One page of a pull request's files, and where the next one is. */
export interface FilesPage {
  files: PullFile[];
  /** The next page's URL, from the `Link` header, or nothing on the last page. */
  next: string | undefined;
}

/**
 * The REST path of the first page of the pull request's files, 100 a page. Later pages are at
 * each page's {@link FilesPage.next}.
 */
export function filesPath(pull: PullRef): string {
  return `${pull.restPath()}/files?per_page=${FILES_PER_PAGE}`;
}

/** A pull request's files, as far as they were read. */
export interface PullFiles {
  files: PullFile[];
  /** The head commit GitHub listed them at, when their links say ({@link filesHead}). */
  head: string | undefined;
  /**
   * Why reading stopped with pages left, if it did. GitHub's own limit of {@link MAX_FILES} can
   * also end the pages without a link to more; the pull request's `changed_files` tells.
   */
  cutShort: CutShort | undefined;
}

/**
 * Why reading a pull request's files stopped with pages left: `pages`, when
 * {@link ReadFiles.maxPages} were read, or `rateLimit`, when no more than
 * {@link ReadFiles.keepRequests} of the rate limit's requests were left.
 */
export type CutShort = 'pages' | 'rateLimit';

/** How much of a pull request's file list to read. */
export interface ReadFiles {
  /** Read no more pages than this. */
  maxPages: number;
  /**
   * Read no page while no more than this many of the REST API's requests are left, as far as the
   * client last heard.
   */
  keepRequests: number;
}

/** Every page GitHub lists. */
export const ALL_PAGES: ReadFiles = { maxPages: MAX_PAGES, keepRequests: 0 };

/**
 * One page of a pull request's files: `path` is {@link filesPath}, or the previous page's
 * {@link FilesPage.next}.
 */
export async function pullFilesPage(client: GithubClient, path: string): Promise<FilesPage> {
  const response = await client.send('GET', path);
  // A response may carry several `Link` headers; `Headers` joins them into the one list they are.
  return {
    files: response.json(readDiffEntries),
    next: nextLink(response.header('link') ?? ''),
  };
}

/** Every file of the pull request GitHub lists, up to its 3,000, page by page. */
export async function pullFiles(client: GithubClient, pull: PullRef): Promise<PullFile[]> {
  return (await readPullFiles(client, pull, ALL_PAGES)).files;
}

/**
 * The pull request's files, page by page, as far as `limits` allow. To read each page in its turn
 * in a request queue, pass a client gated by the queue ({@link GithubClient.gated}).
 */
export async function readPullFiles(
  client: GithubClient,
  pull: PullRef,
  limits: ReadFiles,
): Promise<PullFiles> {
  const files: PullFile[] = [];
  const pages = new Pages(pull, { maxPages: limits.maxPages, api: client.urls.api });
  for (let path = pages.nextPath(); path !== undefined; path = pages.nextPath()) {
    if (fewLeft(client.rateLimits(), limits.keepRequests, new Date())) {
      pages.stop('rateLimit');
      break;
    }
    const page = await pullFilesPage(client, path);
    files.push(...page.files);
    pages.read(page.next);
  }
  return { files, head: filesHead(files), cutShort: pages.cutShort };
}

/**
 * Whether no more than `keep` of the REST API's requests are left, as `limits` last heard, unless
 * the window has reset since.
 */
function fewLeft(limits: RateLimits, keep: number, now: Date): boolean {
  const core = limits.core();
  return core !== undefined && core.remaining <= keep && resetTime(core).getTime() > now.getTime();
}

/**
 * Where the next page of a pull request's files is, for a caller that reads them one page at a
 * time.
 */
export class Pages {
  #next: string | undefined;
  #read = 0;
  readonly #maxPages: number;
  readonly #api: string;
  #cutShort: CutShort | undefined;

  /**
   * Reads no more than `maxPages`, and never more than GitHub lists. `api` is GitHub's API
   * address, where a link's full URL and the path alone name the same page.
   */
  constructor(pull: PullRef, options: { maxPages?: number; api?: string } = {}) {
    this.#next = filesPath(pull);
    this.#maxPages = Math.min(options.maxPages ?? MAX_PAGES, MAX_PAGES);
    this.#api = options.api ?? GITHUB_URLS.api;
  }

  /** The path or URL of the next page to read, or nothing once every page is read. */
  nextPath(): string | undefined {
    return this.#next;
  }

  /**
   * Takes the {@link FilesPage.next} of the page just read. A link past the last page to read is
   * ignored, and one back to the same page is an error rather than a loop.
   */
  read(next: string | undefined): void {
    this.#read++;
    if (
      next !== undefined &&
      this.#next !== undefined &&
      this.#onTheApi(next) === this.#onTheApi(this.#next)
    ) {
      throw new GithubError({
        kind: 'inconsistent',
        message: `page ${this.#read} of the files links to itself`,
      });
    }
    this.#next = next;
    if (this.#read >= this.#maxPages) {
      // GitHub lists no more than its 30 pages, whatever a link says.
      this.#stopWith(this.#maxPages < MAX_PAGES ? 'pages' : undefined);
    }
  }

  /** Stops reading, with pages left if there are any. */
  stop(why: CutShort): void {
    this.#stopWith(why);
  }

  #stopWith(why: CutShort | undefined): void {
    if (this.#next === undefined) return;
    this.#next = undefined;
    this.#cutShort ??= why;
  }

  /** Why reading stopped with pages left, if it did. */
  get cutShort(): CutShort | undefined {
    return this.#cutShort;
  }

  /** `path` as a path on GitHub's API: a full URL there and the path alone name the same page. */
  #onTheApi(path: string): string {
    return path.startsWith(this.#api) ? path.slice(this.#api.length) : path;
  }
}

/**
 * The `rel="next"` URL in a `Link` header, such as
 * `<https://api.github.com/repositories/1/pulls/2/files?page=2>; rel="next", <…>; rel="last"`.
 */
export function nextLink(header: string): string | undefined {
  for (const link of header.split(',')) {
    const [target = '', ...params] = link.trim().split(';');
    if (params.length === 0) continue;
    const url = target.trim();
    if (url.length < 2 || !url.startsWith('<') || !url.endsWith('>')) continue;
    const isNext = params.some((param) => {
      const equals = param.indexOf('=');
      if (equals < 0) return false;
      const [name, value] = [param.slice(0, equals).trim(), param.slice(equals + 1).trim()];
      return (
        name === 'rel' &&
        value
          .replace(/^"+|"+$/g, '')
          .split(' ')
          .includes('next')
      );
    });
    if (isNext) return url.slice(1, -1);
  }
  return undefined;
}
