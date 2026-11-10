import { GithubError } from './errors.ts';

/** How many items a page asks for: GitHub's maximum. */
export const PAGE_SIZE = 100;

/** Follows a GraphQL connection's pages, refusing a cursor that doesn't move the paging on. */
export class Pager {
  readonly #what: string;
  readonly #cursors = new Set<string>();
  /** Pages read so far, and the most there can be. */
  #pages = 1;
  readonly #maxPages: number;

  /**
   * For `total` items read `pageSize` a page. A page more than the count needs is allowed, since
   * the count can grow while paging.
   */
  constructor(what: string, total: number, pageSize: number) {
    this.#what = what;
    this.#maxPages = Math.ceil(Math.max(total, 0) / Math.max(pageSize, 1)) + 1;
  }

  /** The cursor to read the next page after, or nothing when the last page has been read. */
  next(hasNextPage: boolean, endCursor: string | null | undefined): string | undefined {
    if (!hasNextPage) return undefined;
    const what = this.#what;
    if (endCursor == null) {
      throw inconsistent(`more ${what} were left, but no cursor for them`);
    }
    if (this.#cursors.has(endCursor)) throw inconsistent(`a page of ${what} came back again`);
    this.#cursors.add(endCursor);
    this.#pages += 1;
    if (this.#pages > this.#maxPages) {
      throw inconsistent(`more pages of ${what} than their count allows`);
    }
    return endCursor;
  }
}

function inconsistent(message: string): GithubError {
  return new GithubError({ kind: 'inconsistent', message });
}

/** GitHub couldn't find `what`. */
export function notFound(what: string): GithubError {
  return new GithubError({ kind: 'notFound', message: `Could not find ${what}` });
}
