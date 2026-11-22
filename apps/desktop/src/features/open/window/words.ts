// The open feature's words for what main says as a kind: why a link opened nothing, why the open
// box can't open a pull request, and what a link that isn't a pull request is. Main never writes
// them, so each is said one way wherever it shows: under the open box's field, under the welcome's,
// or in a note for a link another app handed Lo.

import {
  notPull,
  type Blocked,
  type Cause,
  type GithubPage,
  type NotPull,
  type Refusal,
} from '../contract.ts';

/**
 * What a pull request link looks like, said of text that isn't one, with code between backticks:
 * nothing for text too long to be one, which the title says.
 */
export function notPullLine(why: NotPull): string | undefined {
  switch (why) {
    case 'link':
      return 'A pull request link looks like `https://github.com/owner/repo/pull/123`.';
    case 'loLink':
      return 'A pull request link looks like `lo://github.com/owner/repo/pull/123`.';
    case 'long':
      return undefined;
    default:
      throw new Error(`A link Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** Whether `why` is that the text isn't a pull request link. */
export function isNotPull(why: Refusal): why is NotPull {
  return (notPull.options as readonly string[]).includes(why);
}

/**
 * Why a link opened nothing, as the reason under "Couldn’t open the link", with code between
 * backticks; or, with no link at all, the reason alone. Nothing where the title says it.
 */
export function refusalReason(why: Refusal): string | undefined {
  if (isNotPull(why)) return notPullLine(why);
  switch (why) {
    case 'empty':
      return 'No link to open';
    case 'insecure':
      return 'It’s `http`, not `https`.';
    case 'defaultBrowser':
      return 'The default browser is Lo.';
    case 'cameBack':
      return 'The browser sent it straight back.';
    default:
      throw new Error(`A refusal Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** A time of day, in the system's own format: `14:05`. */
function timeOfDay(time: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(time);
}

/** Why GitHub didn't say, as a reason line: nothing where the cause isn't known. */
export function causeReason(cause: Cause): string | undefined {
  switch (cause.kind) {
    case 'offline':
      return 'Offline.';
    case 'github':
      return 'GitHub returned an error.';
    case 'rateLimit':
      return cause.resets === null
        ? 'GitHub’s rate limit was reached.'
        : `GitHub’s rate limit resets at ${timeOfDay(cause.resets)}.`;
    case 'signedOut':
      return `${cause.login} is signed out.`;
    case 'sso':
      return `${cause.org} requires single sign-on.`;
    case 'unapproved':
      return `${cause.org} hasn’t approved Lo.`;
    case 'unknown':
      return undefined;
    default:
      throw new Error(`A cause Lo doesn't know: ${JSON.stringify(cause satisfies never)}`);
  }
}

/** What the reader can do about a pull request the box can't open. */
export type BlockedWay =
  | { readonly kind: 'link'; readonly label: string; readonly url: string }
  | { readonly kind: 'openAnyway' }
  | { readonly kind: 'signIn'; readonly again: boolean };

/** A pull request the box can't open, as an error: its title, one reason, and the way on. */
export interface BlockedWords {
  readonly title: string;
  readonly reason: string | undefined;
  readonly way: BlockedWay | undefined;
}

/** What the open box says of `name`, a pull request it can't open, for `why`. */
export function blockedWords(
  why: Blocked,
  { owner, repo, number }: { owner: string; repo: string; number: number },
): BlockedWords {
  const name = `${owner}/${repo}#${number}`;
  const cant = `Can’t open ${name}`;
  switch (why.kind) {
    case 'unchecked':
      return {
        title: `Couldn’t check ${name}`,
        reason: causeReason(why.cause),
        way: { kind: 'openAnyway' },
      };
    case 'missing':
      return {
        title: cant,
        reason: `${owner}/${repo} has no pull request #${number}.`,
        way: undefined,
      };
    case 'hidden':
      return {
        title: cant,
        reason: why.signedIn
          ? 'It doesn’t exist, or none of your accounts can see it.'
          : 'It doesn’t exist, or it’s private.',
        way: { kind: 'signIn', again: false },
      };
    case 'refused': {
      const [link] = why.links;
      const way: BlockedWay | undefined =
        link !== undefined
          ? { kind: 'link', label: link.label, url: link.url }
          : why.openAnyway
            ? { kind: 'openAnyway' }
            : why.cause.kind === 'signedOut'
              ? { kind: 'signIn', again: true }
              : undefined;
      return { title: cant, reason: causeReason(why.cause), way };
    }
    case 'unknown':
      return { title: cant, reason: undefined, way: undefined };
    default:
      throw new Error(`A block Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** What the open box calls the button of a way on. */
export function wayLabel(way: BlockedWay): string {
  switch (way.kind) {
    case 'link':
      return way.label;
    case 'openAnyway':
      return 'Open anyway';
    case 'signIn':
      return way.again ? 'Sign in again' : 'Sign in with GitHub…';
    default:
      throw new Error(`A way on Lo doesn't know: ${JSON.stringify(way satisfies never)}`);
  }
}

/** What a page of GitHub's is, in a title: "This link is to an issue". */
const PAGES: Readonly<Record<GithubPage, string>> = {
  issue: 'an issue',
  commit: 'a commit',
  pulls: 'a list of pull requests',
  folder: 'a folder',
  file: 'a file',
  discussion: 'a discussion',
  workflow: 'a workflow',
};

/** What the open box says of a web link that isn't a pull request, and what `⏎` does with it. */
export function webWords(web: { github: boolean; page: GithubPage | null; secure: boolean }): {
  title: string;
  reason: string | undefined;
  action: string;
} {
  if (!web.secure) {
    return {
      title: 'This link isn’t secure',
      reason: 'It’s `http`, not `https`.',
      action: 'Copy link',
    };
  }
  if (!web.github)
    return { title: 'Not a GitHub link', reason: undefined, action: 'Open in browser' };
  return {
    title:
      web.page === null
        ? 'This link isn’t to a pull request'
        : `This link is to ${PAGES[web.page]}`,
    reason: undefined,
    action: 'Open on GitHub',
  };
}
