// What a stack's tree and its overview's Layers section read of the stack's layers: each layer's
// own overview, `artifact.md` at the commit its ref holds, for the stack's overview it names and
// its tl;dr; and the first line of a layer's description, for one whose overview says none.
//
// - Only the tab's own repository's pull requests are a stack's layers, so everything is read
//   there, as the tab's account, behind what the reader waits on.
// - Every overview's ref is read in one request, kept for a minute for every view of the
//   repository's stacks, then read again with an ETag, so reading them again while none changed
//   costs nothing; and each description with its own.
// - A commit's listing is kept by its ID, which names the same files for good, and `artifact.md`
//   with the rest of the overviews' files, so a layer's overview is read once while it's the same.
//
// Nothing here calls Electron.

import {
  overviewRefCommits,
  pullBody,
  PullRef,
  type GithubClient,
  type OverviewRefCommits,
  type PullBody,
  type ReadPriorityNow,
  type RepoRef,
} from '@lo/github';

import type { Acting } from '../../tab/contract.ts';
import type { LayerOverview, OverviewCommit } from '../contract.ts';
import type { Blobs } from './blobs.ts';
import { fetchBlob, readOverview, type Github } from './fetch.ts';
import { entryAt } from './listing.ts';

/** The most commits' listings kept, the oldest let go first. */
export const LISTINGS = 100;

/** The most descriptions kept, the oldest let go first. */
export const BODIES = 200;

/** The most characters of a description's first line that Layers is sent. */
export const LINE_LIMIT = 300;

/** How long a read of a repository's overviews' refs is used before it's read again, in ms. */
export const REFS_FRESH = 60_000;

export interface LayerReadsOptions {
  /** Where the overviews' files are kept. */
  blobs: Blobs;
  /** Runs `request` as `acting`, in its account's queue as `priority` says. */
  github: <T>(
    acting: Acting,
    request: (client: GithubClient) => Promise<T>,
    priority?: ReadPriorityNow,
  ) => Promise<T>;
  log?: ((line: string) => void) | undefined;
  /** The time now, in milliseconds. */
  now?: (() => number) | undefined;
}

/** What every overview's ref in a repository held, and when that was read. */
interface ReadRefs {
  readonly refs: OverviewRefCommits;
  readonly at: number;
}

const UNREAD: LayerOverview = { kind: 'unread' };

/** The stacks' layers' overviews and descriptions, read as their tabs ask. */
export class LayerReads {
  readonly #options: LayerReadsOptions;
  /** What every overview's ref held when each repository's were last read, by who and its key. */
  readonly #refs = new Map<string, ReadRefs>();
  /** Each repository's overviews' refs being read now, by who and its key, which views wait on. */
  readonly #reading = new Map<string, Promise<OverviewRefCommits>>();
  /** Each commit's listing, by its repository's key and its ID. */
  readonly #listings = new Map<string, OverviewCommit>();
  /** Each pull request's description, as last read. */
  readonly #bodies = new Map<string, PullBody>();

  constructor(options: LayerReadsOptions) {
    this.#options = options;
  }

  /**
   * The overviews of pull requests `numbers` in `repo`, in that order, read as `acting`: what each
   * one's ref holds, `artifact.md` at that commit, read whole; none for a pull request whose ref
   * holds no commit; or unread, when it couldn't be read now or the overview is past what's read
   * of one.
   */
  async overviews(
    acting: Acting,
    repo: RepoRef,
    numbers: readonly number[],
  ): Promise<LayerOverview[]> {
    const github: Github = (request) => this.#options.github(acting, request, 'background');
    let refs: OverviewRefCommits;
    try {
      refs = await this.#refsOf(github, acting, repo);
    } catch (error) {
      this.#log(`reading ${repo.toString()}'s overviews' refs: ${describe(error)}`);
      return numbers.map(() => UNREAD);
    }
    return Promise.all(
      numbers.map((number) => this.#overview(github, acting, repo, refs.commits.get(number))),
    );
  }

  /**
   * What every overview's ref in `repo` holds, as `acting` reads it: as last read, within
   * {@link REFS_FRESH} of it, else read again, with the ETag of the read before.
   */
  #refsOf(github: Github, acting: Acting, repo: RepoRef): Promise<OverviewRefCommits> {
    const now = this.#options.now?.() ?? Date.now();
    const key = `${acting.kind === 'account' ? acting.login : ''} ${repo.key}`;
    const kept = this.#refs.get(key);
    if (kept && now - kept.at < REFS_FRESH) return Promise.resolve(kept.refs);
    const reading = this.#reading.get(key);
    if (reading) return reading;
    const read = github((client) => overviewRefCommits(client, repo, kept?.refs))
      .then((refs) => {
        this.#refs.set(key, { refs, at: now });
        return refs;
      })
      .finally(() => this.#reading.delete(key));
    this.#reading.set(key, read);
    return read;
  }

  /**
   * The first line of the descriptions of pull requests `numbers` in `repo`, in that order, read
   * as `acting`: none for one with no words, or that couldn't be read now.
   */
  async lines(
    acting: Acting,
    repo: RepoRef,
    numbers: readonly number[],
  ): Promise<(string | null)[]> {
    return Promise.all(
      numbers.map(async (number) => {
        const pull = new PullRef(repo.owner, repo.name, number);
        const key = pull.toString();
        try {
          const body = await this.#options.github(
            acting,
            (client) => pullBody(client, pull, this.#bodies.get(key)),
            'background',
          );
          keep(this.#bodies, key, body, BODIES);
          return firstLine(body.body);
        } catch (error) {
          this.#log(`reading ${key}'s description: ${describe(error)}`);
          return null;
        }
      }),
    );
  }

  /** Forgets what was read, as the cache is cleared. */
  clear(): void {
    this.#refs.clear();
    this.#listings.clear();
    this.#bodies.clear();
  }

  async #overview(
    github: Github,
    acting: Acting,
    repo: RepoRef,
    commit: string | undefined,
  ): Promise<LayerOverview> {
    if (commit === undefined) return { kind: 'none' };
    const key = `${repo.key} ${commit}`;
    try {
      let listing = this.#listings.get(key);
      if (!listing) {
        listing = await readOverview(github, acting, this.#options.blobs, repo, commit, 'base');
        keep(this.#listings, key, listing, LISTINGS);
      }
      const text = entryAt(listing.entries, 'artifact.md');
      // Past an overview's limits, or with no `artifact.md`, there's nothing to read.
      if (!listing.read || text?.kind !== 'file') return UNREAD;
      const artifact = await fetchBlob(github, acting, this.#options.blobs, repo, text.id);
      return { kind: 'read', commit, artifact };
    } catch (error) {
      this.#log(`reading the overview at ${commit} in ${repo.toString()}: ${describe(error)}`);
      return UNREAD;
    }
  }

  #log(line: string): void {
    this.#options.log?.(line);
  }
}

/** Keeps `value` in `map` as the newest, letting the oldest go past `limit`. */
function keep<T>(map: Map<string, T>, key: string, value: T, limit: number): void {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= limit) break;
    map.delete(oldest);
  }
}

/** What leads a line of Markdown without being its words: a heading's, a quote's or a list's mark. */
const LEAD = /^(?:\s*(?:#{1,6}(?=\s)|>|[-*+](?=\s)|\d{1,9}[.)](?=\s)|\[[ xX]\](?=\s)))+/;

/**
 * The first line of description `body` that has words, as text on one line: its Markdown's marks
 * left out, a link and an image as their words, an HTML comment, such as a template's, as nothing.
 * At most {@link LINE_LIMIT} characters. None when no line has words.
 */
export function firstLine(body: string): string | null {
  const text = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(LEAD, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\*\*|__|~~|`/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    // A rule, or a table's line under its head, says nothing.
    if (line === '' || /^[-*_=|:\s]+$/.test(line)) continue;
    return clip(line, LINE_LIMIT);
  }
  return null;
}

/** The start of `text`, at most `limit` UTF-16 units of it, never splitting a character. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let clipped = '';
  for (const character of text) {
    if (clipped.length + character.length > limit) break;
    clipped += character;
  }
  return clipped;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
