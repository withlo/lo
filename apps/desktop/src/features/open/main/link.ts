// Links, as Lo opens them: the open box's text, a row of the Recent list, a link another app hands
// Lo. Each is read the same way, as untrusted text: a pull request opens in a tab, as the account
// that can see it, or read only without signing in when it's public; any other web link goes to
// the browser; anything else opens nothing. Nothing here calls Electron.

import {
  decideAccount,
  GithubError,
  pullMerged,
  PullRef,
  readPullSummary,
  sameLogin,
  type AccountRefusal,
  type Acting,
  type GithubClient,
  type PullSummary,
  type RepoAccount,
} from '@lo/github';
import { parsePullLink, type PullLink } from '@lo/review';

import type { GithubAccess } from '../../accounts/service.ts';
import type { PullState } from '../../tab/contract.ts';
import type { TabService } from '../../tab/service.ts';
import {
  TEXT_LIMIT,
  type Blocked,
  type Cause,
  type GithubPage,
  type NotPull,
  type Opened,
  type Preview,
  type Refusal,
} from '../contract.ts';

/** What reading a link needs of GitHub. */
export type LinkGithub = Pick<GithubAccess, 'anonymous' | 'accounts' | 'client' | 'accountForRepo'>;

/** What some text is, as a link. */
export type ReadLink =
  | { kind: 'empty' }
  | { kind: 'pull'; pull: PullLink }
  /**
   * A web link Lo doesn't show: whether it's GitHub's, and which of its pages where the link says,
   * and whether it's over `https`.
   */
  | { kind: 'web'; url: string; github: boolean; page: GithubPage | null; secure: boolean }
  | { kind: 'invalid'; why: NotPull };

/** A pull request's page, or one under it, on GitHub: its files, a commit, its checks. */
const UNDER_A_PULL =
  /^(?:(?:https?|lo):\/\/)?((?:www\.)?github\.com)\/([^/?#]+)\/([^/?#]+)\/pull\/([0-9]+)(?:[/?#].*)?$/i;

/**
 * Reads `text` as a link: a pull request on github.com, by its page or one under it, over
 * `https`, `http` or `lo://`, or without a scheme; another web link, which Lo leaves to the
 * browser; or nothing Lo can do anything with. A `lo://` link is a pull request's or nothing.
 */
export function readLink(text: string): ReadLink {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (trimmed.length > TEXT_LIMIT) return { kind: 'invalid', why: 'long' };
  const pull = readPull(trimmed);
  if (pull) return { kind: 'pull', pull };
  if (/^lo:/i.test(trimmed)) return { kind: 'invalid', why: 'loLink' };
  const url = webUrl(trimmed);
  if (!url) return { kind: 'invalid', why: 'link' };
  return { kind: 'web', url: url.href, ...describeWeb(url), secure: url.protocol === 'https:' };
}

/** The pull request `text` links to, by its page or one under it, if it's one. */
function readPull(text: string): PullLink | undefined {
  try {
    return parsePullLink(text);
  } catch {
    // A page under the pull request's, such as a commit or a file: the pull request it's in, as
    // its own link names it, read and checked as one.
    const under = UNDER_A_PULL.exec(text);
    if (!under) return undefined;
    const [, host, owner, repo, number] = under;
    try {
      return parsePullLink(`https://${host}/${owner}/${repo}/pull/${number}`);
    } catch {
      return undefined;
    }
  }
}

/** `text` as a web address, if it is one: `http` or `https`, or github.com without its scheme. */
function webUrl(text: string): URL | undefined {
  const written = /^(?:www\.)?github\.com\//i.test(text) ? `https://${text}` : text;
  const url = URL.parse(written);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname === '') {
    return undefined;
  }
  return url;
}

/** The pages of a repository on GitHub that a link names, by the part of its path that does. */
const PAGES: Readonly<Record<string, GithubPage>> = {
  issues: 'issue',
  commit: 'commit',
  pulls: 'pulls',
  tree: 'folder',
  blob: 'file',
  discussions: 'discussion',
  actions: 'workflow',
};

/** What a web link that isn't a pull request is: one of GitHub's pages, which where it says, or not. */
function describeWeb(url: URL): { github: boolean; page: GithubPage | null } {
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return { github: false, page: null };
  const [, , kind] = url.pathname.split('/').filter(Boolean);
  const page = kind === undefined || !Object.hasOwn(PAGES, kind) ? undefined : PAGES[kind];
  return { github: true, page: page ?? null };
}

/** A pull request's link as Lo writes one. */
export function pullLink({ owner, repo, number }: PullLink): string {
  return `https://github.com/${owner}/${repo}/pull/${number}`;
}

/**
 * The pull request link in `text`, as Lo writes one, when `text` is one and nothing else: what Lo
 * hands the window from the clipboard. Anything else on the clipboard is never handed on, and nor
 * is anything of the link's beyond the pull request, such as a query or a fragment.
 */
export function pullLinkIn(text: string): string | null {
  if (text.length > TEXT_LIMIT) return null;
  const read = readLink(text);
  return read.kind === 'pull' ? pullLink(read.pull) : null;
}

/** Whom a pull request opens as, as far as Lo could find out before opening it. */
type Choice =
  | { kind: 'open'; acting: Acting; found: RepoAccount | undefined }
  | { kind: 'ask'; logins: string[]; found: RepoAccount }
  | { kind: 'refuse'; refusal: AccountRefusal; found: RepoAccount };

/**
 * Whom `pull` opens as: `wanted`, when it's an account that can see the repository; otherwise the
 * one that can, the one remembered for it, nobody when none can, or a question. Without an
 * account, nobody, without asking GitHub. Throws when GitHub can't be asked.
 */
async function choose(pull: PullRef, github: LinkGithub, wanted?: string): Promise<Choice> {
  const accounts = await github.accounts();
  if (accounts.length === 0) {
    return { kind: 'open', acting: { kind: 'anonymous' }, found: undefined };
  }
  const found = await github.accountForRepo(pull.repo);
  const asked = wanted === undefined ? undefined : found.visible.find((l) => sameLogin(l, wanted));
  if (asked !== undefined)
    return { kind: 'open', acting: { kind: 'account', login: asked }, found };
  const decision = decideAccount(found);
  switch (decision.kind) {
    case 'open':
      return { kind: 'open', acting: decision.acting, found };
    case 'ask':
      return { kind: 'ask', logins: decision.logins, found };
    case 'refuse':
      return { kind: 'refuse', refusal: decision.refusal, found };
    default:
      decision satisfies never;
      throw new Error(`A decision Lo doesn't know: ${JSON.stringify(decision)}.`);
  }
}

/** What opening a link needs: GitHub, the tabs, and the browser. */
export interface LinkOptions {
  readonly github: LinkGithub;
  readonly tabs: Pick<TabService, 'open'>;
  /**
   * Hands a web link to the browser, or says why it didn't: as when Lo handed the same link to it
   * moments ago and it came back.
   */
  readonly browse: (url: string) => Promise<Refusal | undefined>;
  /**
   * Whether only `https` links go to the browser, as for links from the window, which main can't
   * tell from links a page made up: the browser gets nothing over plain `http` from there.
   */
  readonly httpsOnly: boolean;
  readonly log: (line: string) => void;
}

/**
 * Opens `text`, wherever it came from: a pull request in its tab, as `login` when that account can
 * see its repository, and otherwise as the account Lo chooses, which the tab says when it can't
 * open it; any other web link in the browser. Anything else opens nothing, and says why.
 */
export async function link(
  text: string,
  options: LinkOptions,
  { login }: { login?: string | undefined } = {},
): Promise<Opened> {
  const read = readLink(text);
  switch (read.kind) {
    case 'empty':
      return { kind: 'refused', why: 'empty' };
    case 'invalid':
      return { kind: 'refused', why: read.why };
    case 'web': {
      if (options.httpsOnly && !read.secure) return { kind: 'refused', why: 'insecure' };
      const refused = await options.browse(read.url);
      return refused === undefined ? { kind: 'browser' } : { kind: 'refused', why: refused };
    }
    case 'pull':
      break;
    default:
      read satisfies never;
      return { kind: 'refused', why: 'link' };
  }
  const { owner, repo, number } = read.pull;
  const pull = new PullRef(owner, repo, number);
  let choice: Choice | undefined;
  let as: { login: string } | undefined;
  try {
    choice = await choose(pull, options.github, login);
    if (choice.kind === 'open' && choice.acting.kind === 'account') {
      as = { login: choice.acting.login };
    }
  } catch (error) {
    // The tab asks again once it's shown, and says why it can't open, if it can't. A Recent row's
    // own account, still signed in, opens it meanwhile, with what Lo saved of it.
    options.log(`choosing the account for ${pull.toString()}: ${describe(error)}`);
    as = await signedIn(options.github, login);
  }
  const id = options.tabs.open({ kind: 'pull', owner, repo, number }, as);
  return { kind: 'tab', id, choice: choiceOf(choice) };
}

/** `login` as Lo has it, when it's one of Lo's accounts and signed in. */
async function signedIn(
  github: LinkGithub,
  login: string | undefined,
): Promise<{ login: string } | undefined> {
  if (login === undefined) return undefined;
  const found = (await github.accounts()).find(
    ({ account, signedOut }) => signedOut === undefined && sameLogin(account.login, login),
  );
  return found === undefined ? undefined : { login: found.account.login };
}

/** How the account was chosen, for what `link` answers. */
function choiceOf(choice: Choice | undefined): Extract<Opened, { kind: 'tab' }>['choice'] {
  switch (choice?.kind) {
    case 'open':
      return choice.acting.kind === 'account' ? 'account' : 'none';
    case 'ask':
      return 'ask';
    case 'refuse':
      return choice.found.choice.kind === 'unavailable' ? 'unavailable' : 'none';
    case undefined:
      return 'unavailable';
    default:
      choice satisfies never;
      return 'unavailable';
  }
}

/**
 * What the open box shows for `text`: what it opens, as whom, with the pull request's title and
 * state when GitHub gives them; or why it can't, and what would help. Nothing opens.
 */
export async function look(text: string, github: LinkGithub): Promise<Preview> {
  const read = readLink(text);
  switch (read.kind) {
    case 'empty':
      return { kind: 'empty' };
    case 'invalid':
      return { kind: 'invalid', why: read.why };
    case 'web':
      return {
        kind: 'web',
        url: read.url,
        github: read.github,
        page: read.page,
        secure: read.secure,
      };
    case 'pull':
      return lookAtPull(read.pull, github);
    default:
      read satisfies never;
      return { kind: 'invalid', why: 'link' };
  }
}

async function lookAtPull(named: PullLink, github: LinkGithub): Promise<Preview> {
  const { owner, repo, number } = named;
  const pull = new PullRef(owner, repo, number);
  const blocked = (why: Blocked, details?: string): Preview => ({
    kind: 'blocked',
    owner,
    repo,
    number,
    why,
    ...(details === undefined ? {} : { details }),
  });
  let choice: Choice;
  try {
    choice = await choose(pull, github);
  } catch (error) {
    return blocked({ kind: 'unchecked', cause: causeOf(error, owner) }, describe(error));
  }
  switch (choice.kind) {
    case 'open': {
      const { acting } = choice;
      if (acting.kind === 'account') {
        const read = await readSummary(await github.client(acting.login), pull);
        if (read.kind === 'missing') return blocked({ kind: 'missing' });
        return { kind: 'pull', owner, repo, number, as: acting, ...read.shown };
      }
      const read = await readSummary(github.anonymous, pull);
      if (read.kind === 'missing') {
        return blocked({ kind: 'hidden', signedIn: choice.found !== undefined });
      }
      return { kind: 'pull', owner, repo, number, as: acting, ...read.shown };
    }
    case 'ask': {
      const [first] = choice.logins;
      const read =
        first === undefined
          ? { kind: 'unknown' as const, shown: { title: null, state: null } }
          : await readSummary(await github.client(first), pull);
      const shown = read.kind === 'missing' ? { title: null, state: null } : read.shown;
      return {
        kind: 'pull',
        owner,
        repo,
        number,
        as: {
          kind: 'ask',
          logins: choice.logins,
          // An account chosen for the owner that can't see this repository keeps the owner's.
          remember: choice.found.remembered.owner === undefined ? 'owner' : 'repo',
        },
        ...shown,
      };
    }
    case 'refuse': {
      const { refusal, found } = choice;
      const chosen = found.choice.kind === 'unavailable' ? found.choice.login : undefined;
      const problems = found.problems.filter(
        ({ login }) => chosen === undefined || sameLogin(login, chosen),
      );
      // The cause that stops it: an organization's, where one stops it, since its link fixes it.
      const first =
        problems.find(({ error }) => error.helpLink() !== undefined) ??
        problems.find(({ error }) => !error.isUnauthorized()) ??
        problems[0];
      const cause =
        first === undefined
          ? ({ kind: 'unknown' } as const)
          : causeOf(first.error, owner, first.login);
      return blocked(
        { kind: 'refused', cause, links: refusal.links, openAnyway: refusal.waitable },
        refusal.message,
      );
    }
    default:
      choice satisfies never;
      return blocked({ kind: 'unknown' });
  }
}

/**
 * Why GitHub didn't answer, or refused, as the window words it: from the error, for a repository of
 * `owner`, asked as `login` when an account was.
 */
export function causeOf(error: unknown, owner: string, login?: string): Cause {
  if (!(error instanceof GithubError)) return { kind: 'unknown' };
  const { detail } = error;
  switch (detail.kind) {
    case 'network':
      return { kind: 'offline' };
    case 'rateLimited':
      return { kind: 'rateLimit', resets: detail.reset === undefined ? null : detail.reset * 1000 };
    case 'unauthorized': {
      const who = detail.missing ?? login;
      return who === undefined ? { kind: 'unknown' } : { kind: 'signedOut', login: who };
    }
    case 'ssoRequired':
      return { kind: 'sso', org: owner };
    case 'oauthAppRestricted':
      return { kind: 'unapproved', org: detail.org ?? owner };
    case 'api':
    case 'graphql':
    case 'inconsistent':
    case 'decode':
      return { kind: 'github' };
    case 'tokenUnavailable':
      return login === undefined ? { kind: 'unknown' } : { kind: 'unreadable', login };
    case 'notFound':
    case 'refusedUrl':
      return { kind: 'unknown' };
    default:
      detail satisfies never;
      return { kind: 'unknown' };
  }
}

/** What reading a pull request's summary found: its title and state, nothing, or GitHub's silence. */
type SummaryRead =
  | { kind: 'read'; shown: { title: string; state: PullState } }
  | { kind: 'missing' }
  | { kind: 'unknown'; shown: { title: null; state: null } };

/**
 * Reads `pull`'s title and state with `client`. A pull request GitHub doesn't have, or doesn't
 * show the client, is missing; any other failure leaves them unknown, for the tab to read again.
 */
async function readSummary(client: GithubClient, pull: PullRef): Promise<SummaryRead> {
  try {
    const summary = await client.get(pull.restPath(), readPullSummary);
    return { kind: 'read', shown: { title: summary.title, state: stateOf(summary) } };
  } catch (error) {
    if (error instanceof GithubError && error.detail.kind === 'notFound')
      return { kind: 'missing' };
    return { kind: 'unknown', shown: { title: null, state: null } };
  }
}

/** A pull request's state, as its summary says it. */
function stateOf(summary: PullSummary): PullState {
  if (pullMerged(summary)) return 'merged';
  if (summary.state === 'closed') return 'closed';
  return summary.draft ? 'draft' : 'open';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How long a link handed to the browser counts as coming back, if Lo is given it again. */
export const COMES_BACK_WITHIN = 10_000;

/**
 * Hands web links to the browser, unless doing so would send them round in a circle: Lo is the
 * default browser, so the system would hand the link straight back; or a link from another app is
 * one Lo handed to the browser moments ago, as when a link router's rules send it back to Lo.
 */
export class Browser {
  readonly #open: (url: string) => Promise<void>;
  readonly #isDefault: () => boolean;
  readonly #now: () => number;
  /** When Lo last handed each link to the browser. */
  readonly #sent = new Map<string, number>();

  constructor(options: {
    open: (url: string) => Promise<void>;
    /** Whether Lo is the system's browser for `https`. */
    isDefault: () => boolean;
    now?: () => number;
  }) {
    this.#open = options.open;
    this.#isDefault = options.isDefault;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Hands `url` to the browser, and answers nothing; or doesn't, and answers why. `fromOutside`
   * says another app gave Lo the link.
   */
  async hand(url: string, { fromOutside }: { fromOutside: boolean }): Promise<Refusal | undefined> {
    const now = this.#now();
    for (const [sent, at] of this.#sent) {
      if (now - at > COMES_BACK_WITHIN) this.#sent.delete(sent);
    }
    if (this.#isDefault()) return 'defaultBrowser';
    if (fromOutside && this.#sent.has(url)) return 'cameBack';
    this.#sent.set(url, now);
    await this.#open(url);
    return undefined;
  }
}
