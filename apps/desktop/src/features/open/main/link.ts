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
import { displayPullLink, parsePullLink, type PullLink } from '@lo/review';

import type { GithubAccess } from '../../accounts/service.ts';
import type { PullState } from '../../tab/contract.ts';
import type { TabService } from '../../tab/service.ts';
import { TEXT_LIMIT, type Opened, type Preview } from '../contract.ts';

/** What reading a link needs of GitHub. */
export type LinkGithub = Pick<GithubAccess, 'anonymous' | 'accounts' | 'client' | 'accountForRepo'>;

/** What some text is, as a link. */
export type ReadLink =
  | { kind: 'empty' }
  | { kind: 'pull'; pull: PullLink }
  /** A web link Lo doesn't show, with what it is, in words. */
  | { kind: 'web'; url: string; title: string; message: string }
  | { kind: 'invalid'; message: string };

/** A pull request's page, or one under it, on GitHub: its files, a commit, its checks. */
const UNDER_A_PULL =
  /^(?:(?:https?|lo):\/\/)?((?:www\.)?github\.com)\/([^/?#]+)\/([^/?#]+)\/pull\/([0-9]+)(?:[/?#].*)?$/i;

const EXAMPLE = 'https://github.com/owner/repo/pull/123';

/**
 * Reads `text` as a link: a pull request on github.com, by its page or one under it, over
 * `https`, `http` or `lo://`, or without a scheme; another web link, which Lo leaves to the
 * browser; or nothing Lo can do anything with. A `lo://` link is a pull request's or nothing.
 */
export function readLink(text: string): ReadLink {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (trimmed.length > TEXT_LIMIT) {
    return { kind: 'invalid', message: 'That’s too long to be a link to a pull request.' };
  }
  const pull = readPull(trimmed);
  if (pull) return { kind: 'pull', pull };
  if (/^lo:/i.test(trimmed)) {
    return {
      kind: 'invalid',
      message: `Lo opens lo:// links to pull requests only, such as lo://github.com/owner/repo/pull/123.`,
    };
  }
  const url = webUrl(trimmed);
  if (!url) {
    return {
      kind: 'invalid',
      message: `Lo opens links to pull requests, such as ${EXAMPLE}.`,
    };
  }
  return { kind: 'web', url: url.href, ...describeWeb(url) };
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

/** What a web link that isn't a pull request is, in words, and that it goes to the browser. */
function describeWeb(url: URL): { title: string; message: string } {
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return {
      title: 'That isn’t a link to GitHub',
      message: 'Lo opens pull requests on github.com. This one goes to your browser.',
    };
  }
  const [, , kind] = url.pathname.split('/').filter(Boolean);
  const what: Readonly<Record<string, string>> = {
    issues: 'an issue',
    commit: 'a commit',
    pulls: 'the list of pull requests',
    tree: 'a folder',
    blob: 'a file',
    discussions: 'a discussion',
    actions: 'a workflow',
  };
  const named = kind === undefined ? undefined : what[kind];
  return {
    title:
      named === undefined ? 'That isn’t a pull request' : `That’s ${named}, not a pull request`,
    message:
      'Lo opens pull requests, and their files, commits and checks pages. This one goes to your browser.',
  };
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
  readonly browse: (url: string) => Promise<string | undefined>;
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
      return { kind: 'refused', message: 'There’s no link to open.' };
    case 'invalid':
      return { kind: 'refused', message: read.message };
    case 'web': {
      const refused = await options.browse(read.url);
      return refused === undefined ? { kind: 'browser' } : { kind: 'refused', message: refused };
    }
    case 'pull':
      break;
    default:
      read satisfies never;
      return { kind: 'refused', message: 'Lo couldn’t read the link.' };
  }
  const { owner, repo, number } = read.pull;
  const pull = new PullRef(owner, repo, number);
  let choice: Choice | undefined;
  try {
    choice = await choose(pull, options.github, login);
  } catch (error) {
    // The tab asks again once it's shown, and says why it can't open, if it can't.
    options.log(`choosing the account for ${pull.toString()}: ${describe(error)}`);
  }
  const acting = choice?.kind === 'open' ? choice.acting : undefined;
  const as = acting?.kind === 'account' ? { login: acting.login } : undefined;
  const id = options.tabs.open({ kind: 'pull', owner, repo, number }, as);
  return { kind: 'tab', id, choice: choiceOf(choice) };
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
      return { kind: 'invalid', message: read.message };
    case 'web':
      return { kind: 'web', url: read.url, title: read.title, message: read.message };
    case 'pull':
      return lookAtPull(read.pull, github);
    default:
      read satisfies never;
      return { kind: 'invalid', message: 'Lo couldn’t read the link.' };
  }
}

async function lookAtPull(named: PullLink, github: LinkGithub): Promise<Preview> {
  const { owner, repo, number } = named;
  const pull = new PullRef(owner, repo, number);
  const name = displayPullLink(named);
  const blocked = (
    title: string,
    message: string,
    more: { links?: { label: string; url: string }[]; signIn?: boolean; openAnyway?: boolean },
  ): Preview => ({
    kind: 'blocked',
    owner,
    repo,
    number,
    title,
    message,
    links: more.links ?? [],
    signIn: more.signIn ?? false,
    openAnyway: more.openAnyway ?? false,
  });
  let choice: Choice;
  try {
    choice = await choose(pull, github);
  } catch (error) {
    return blocked(
      `Lo couldn’t ask GitHub about ${name}`,
      `${capitalized(describe(error))}. Open it, and Lo tries again by itself.`,
      { openAnyway: true },
    );
  }
  switch (choice.kind) {
    case 'open': {
      const { acting } = choice;
      if (acting.kind === 'account') {
        const read = await readSummary(await github.client(acting.login), pull);
        if (read.kind === 'missing') {
          return blocked(
            `GitHub has no pull request ${name}`,
            `${acting.login} can see ${owner}/${repo}, which has no pull request #${number}.`,
            {},
          );
        }
        return { kind: 'pull', owner, repo, number, as: acting, ...read.shown };
      }
      const read = await readSummary(github.anonymous, pull);
      if (read.kind === 'missing') {
        return choice.found === undefined
          ? blocked(
              `GitHub has no public pull request ${name}`,
              'If it’s private, sign in with an account that can see it.',
              { signIn: true },
            )
          : blocked(
              `None of your accounts can see ${owner}/${repo}`,
              'It’s private, or it doesn’t exist. Sign in with an account that has access.',
              { signIn: true },
            );
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
        as: { kind: 'ask', logins: choice.logins },
        ...shown,
      };
    }
    case 'refuse': {
      const { refusal, found } = choice;
      const chosen = found.choice.kind === 'unavailable' ? found.choice.login : undefined;
      const problems = found.problems.filter(
        ({ login }) => chosen === undefined || sameLogin(login, chosen),
      );
      const restricted = problems.find(({ error }) => error.detail.kind === 'oauthAppRestricted');
      if (restricted) {
        const { detail } = restricted.error;
        const org = (detail.kind === 'oauthAppRestricted' ? detail.org : undefined) ?? owner;
        return blocked(
          `${org} hasn’t approved Lo`,
          `${org} restricts third-party apps, so GitHub hides its repositories from Lo. An owner has to approve Lo first: ask for it on GitHub, and GitHub emails ${org}’s owners.`,
          { links: refusal.links, signIn: true },
        );
      }
      const signedOut = problems.some(({ error }) => error.isUnauthorized());
      return blocked(
        chosen === undefined
          ? `Lo can’t open ${name} with your accounts`
          : `${chosen} can’t check ${owner}/${repo} just now`,
        refusal.message,
        { links: refusal.links, signIn: signedOut, openAnyway: refusal.waitable },
      );
    }
    default:
      choice satisfies never;
      return blocked(`Lo can’t open ${name}`, 'Lo couldn’t tell how to open it.', {});
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

function capitalized(text: string): string {
  return text.slice(0, 1).toUpperCase() + text.slice(1);
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
  async hand(url: string, { fromOutside }: { fromOutside: boolean }): Promise<string | undefined> {
    const now = this.#now();
    for (const [sent, at] of this.#sent) {
      if (now - at > COMES_BACK_WITHIN) this.#sent.delete(sent);
    }
    if (this.#isDefault()) {
      return 'Lo is your default browser, so it can’t hand this link on. Choose another default browser in the system’s settings.';
    }
    if (fromOutside && this.#sent.has(url)) {
      return 'Lo handed this link to your browser, and it came straight back. If a link router sends links to Lo, check that it sends Lo only pull requests.';
    }
    this.#sent.set(url, now);
    await this.#open(url);
    return undefined;
  }
}
