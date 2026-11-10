/** Which repository or pull request something is about. */

/**
 * A repository on GitHub. Owners and names match ignoring (ASCII) case, as on GitHub, and show as
 * written.
 */
export class RepoRef {
  readonly owner: string;
  readonly name: string;

  constructor(owner: string, name: string) {
    this.owner = owner;
    this.name = name;
  }

  /**
   * The repository GitHub's `owner/name` names, or nothing when it isn't one: an owner and a name,
   * neither empty, and no other slash.
   */
  static parse(fullName: string): RepoRef | undefined {
    const slash = fullName.indexOf('/');
    if (slash < 0) return undefined;
    const [owner, name] = [fullName.slice(0, slash), fullName.slice(slash + 1)];
    if (owner === '' || name === '' || name.includes('/')) return undefined;
    return new RepoRef(owner, name);
  }

  /** The key two references to the same repository share, whatever their case. */
  get key(): string {
    return `${this.owner.toLowerCase()}/${this.name.toLowerCase()}`;
  }

  equals(other: RepoRef): boolean {
    return this.key === other.key;
  }

  /** Orders repositories by owner, then name, ignoring case. */
  static compare(a: RepoRef, b: RepoRef): number {
    const [x, y] = [a.key.split('/'), b.key.split('/')];
    for (let index = 0; index < 2; index++) {
      if (x[index]! < y[index]!) return -1;
      if (x[index]! > y[index]!) return 1;
    }
    return 0;
  }

  /**
   * The REST path of a page (from 1) of the repository's open pull requests, 100 a page in
   * GitHub's default order, newest first. Keeping the order and parameters fixed keeps each
   * page's ETag stable.
   */
  openPullsPath(page = 1): string {
    const path = `/repos/${this.owner}/${this.name}/pulls?state=open&per_page=100`;
    return page > 1 ? `${path}&page=${page}` : path;
  }

  toString(): string {
    return `${this.owner}/${this.name}`;
  }
}

/** A pull request on GitHub. */
export class PullRef {
  readonly repo: RepoRef;
  readonly number: number;

  constructor(owner: string, name: string, number: number) {
    this.repo = new RepoRef(owner, name);
    this.number = number;
  }

  static of(repo: RepoRef, number: number): PullRef {
    return new PullRef(repo.owner, repo.name, number);
  }

  get key(): string {
    return `${this.repo.key}#${this.number}`;
  }

  equals(other: PullRef): boolean {
    return this.key === other.key;
  }

  /** Orders pull requests by repository, then number. */
  static compare(a: PullRef, b: PullRef): number {
    return RepoRef.compare(a.repo, b.repo) || a.number - b.number;
  }

  /** The pull request's REST path. */
  restPath(): string {
    return `/repos/${this.repo.owner}/${this.repo.name}/pulls/${this.number}`;
  }

  toString(): string {
    return `${this.repo.toString()}#${this.number}`;
  }
}

/**
 * What a poll or a cache entry is about: one pull request, or a repository as a whole. Two targets
 * are the same when their `key`s are: a pull request's and its repository's never are.
 */
export type Target = PullRef | RepoRef;

/** The repository `target` is, or is in. */
export function targetRepo(target: Target): RepoRef {
  return target instanceof PullRef ? target.repo : target;
}

/** The pull request's number, or 0 for a repository. */
export function targetNumber(target: Target): number {
  return target instanceof PullRef ? target.number : 0;
}
