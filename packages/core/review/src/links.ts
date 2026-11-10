/**
 * Pull request links, such as `https://github.com/sharkdp/fd/pull/2212`, as the open box, the
 * `lo` command and link routers hand them to Lo (`docs/design.md`, "Opening links").
 */

/** A pull request on github.com, named by a link to it. Owner and repository are as written. */
export interface PullLink {
  owner: string;
  repo: string;
  number: number;
}

/** Why a string isn't a pull request link. */
export type PullLinkProblem =
  /** Not a link to github.com. */
  | 'notGithub'
  /** A github.com link, but not to a pull request. */
  | 'notAPullRequest'
  /** The owner isn't a valid GitHub user or organization name. */
  | 'invalidOwner'
  /** The repository isn't a valid GitHub repository name. */
  | 'invalidRepo'
  /** The pull request number isn't a positive whole number GitHub can hold. */
  | 'invalidNumber';

const PROBLEMS: Record<PullLinkProblem, string> = {
  notGithub: "it isn't a link to github.com",
  notAPullRequest: "it isn't a link to a pull request",
  invalidOwner: "its owner isn't a valid GitHub user or organization name",
  invalidRepo: "its repository isn't a valid GitHub repository name",
  invalidNumber: "its pull request number isn't a positive whole number",
};

/** A string that isn't a pull request link. Its message says why. */
export class PullLinkError extends Error {
  override name = 'PullLinkError';
  readonly problem: PullLinkProblem;

  constructor(problem: PullLinkProblem) {
    super(PROBLEMS[problem]);
    this.problem = problem;
  }
}

/** The schemes a link may have. `lo` is Lo's own, which the operating system hands to Lo. */
const SCHEMES = ['https', 'http', 'lo'];

/** The hosts a link may name. */
const HOSTS = ['github.com', 'www.github.com'];

/** The pull request tabs a link can point at. They all name the same pull request. */
const TABS = ['files', 'commits', 'checks'];

/** The largest pull request number: GitHub's GraphQL takes one as an `Int`, which is 32 bits. */
const MAX_NUMBER = 2 ** 31 - 1;

// Owner and repository also name a folder in Lo's cache, so `.`, `..` and anything outside
// GitHub's characters must never get through.

/** GitHub user and organization names: up to 39 ASCII letters, digits and hyphens, not starting with a hyphen. */
const OWNER = /^(?!-)[A-Za-z0-9-]{1,39}$/;

/** GitHub repository names: up to 100 ASCII letters, digits, `.`, `-` and `_`, other than `.` and `..`. */
const REPO = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/**
 * Reads `https://github.com/<owner>/<repo>/pull/<number>`, with or without the scheme, over
 * `http`, as a `lo://` link, with a trailing slash, or pointing at the files, commits or checks
 * tab. Surrounding whitespace, a query and a fragment are ignored. Throws a {@link PullLinkError}
 * for anything else.
 */
export function parsePullLink(text: string): PullLink {
  const link = text.trim().split(/[?#]/, 1)[0] ?? '';
  const schemeEnd = link.indexOf('://');
  let rest = link;
  if (schemeEnd >= 0) {
    const scheme = link.slice(0, schemeEnd).toLowerCase();
    if (!SCHEMES.includes(scheme)) throw new PullLinkError('notGithub');
    rest = link.slice(schemeEnd + 3);
  }
  const slash = rest.indexOf('/');
  const host = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? '' : rest.slice(slash + 1);
  if (!HOSTS.includes(host.toLowerCase())) throw new PullLinkError('notGithub');

  const [owner, repo, pull, number, ...tail] = path.split('/');
  if (
    owner === undefined ||
    repo === undefined ||
    pull !== 'pull' ||
    number === undefined ||
    number === '' ||
    !isTab(tail)
  ) {
    throw new PullLinkError('notAPullRequest');
  }
  if (!OWNER.test(owner)) throw new PullLinkError('invalidOwner');
  if (!REPO.test(repo)) throw new PullLinkError('invalidRepo');
  const parsed = /^[0-9]+$/.test(number) ? Number(number) : 0;
  if (parsed < 1 || parsed > MAX_NUMBER) throw new PullLinkError('invalidNumber');
  return { owner, repo, number: parsed };
}

/** Whether what follows the number names the pull request itself or one of its tabs, with an optional trailing slash. */
function isTab(tail: string[]): boolean {
  const [tab, end, ...more] = tail;
  if (more.length > 0 || (end !== undefined && end !== '')) return false;
  return tab === undefined || tab === '' ? end === undefined : TABS.includes(tab);
}

/** How a pull request link shows: `owner/repo#number`. */
export function displayPullLink(link: PullLink): string {
  return `${link.owner}/${link.repo}#${link.number}`;
}
