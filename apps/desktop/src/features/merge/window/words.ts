// How the window words a pull request's merge status: the header's one line, and the merge panel's
// head, reasons and foot, from what main decided; and a merge's confirmation and how it goes, a
// GitHub stack's layers and a chain's base branch moves among it. Text from GitHub, such as logins,
// branches and check names, is drawn as text without the characters that turn text around, which
// the components take out, or `MergeHeader` where it draws the text itself. Nothing here draws.

import type { MergeKind } from '@lo/ui';

import type {
  Action,
  Blocker,
  Check,
  InQueue,
  JobView,
  MergePlan,
  MergeState,
  MergeView,
  Method,
  Named,
  Off,
  Placement,
  Progress,
  Reviewer,
  StackLayer,
  Together,
  Unchecked,
} from '../contract.ts';

/** The header's merge status: a dot, a verdict and the reasons or method after it. */
export interface HeaderLine {
  readonly kind: MergeKind;
  readonly verdict: string;
  readonly detail: string | undefined;
  /** What it says on hover, when it says more than which key opens the panel. */
  readonly title: string | undefined;
  /** Whether it opens the merge panel: not once the pull request has merged or closed. */
  readonly opens: boolean;
}

/** A link a reason offers, to a page main may open. */
export interface RowLink {
  readonly label: string;
  readonly url: string;
}

/** A check under a reason, with its run's page. */
export interface RowSub {
  readonly key: string;
  readonly name: string;
  readonly note: string | undefined;
  readonly tone: 'fail' | 'quiet';
  readonly link: RowLink | undefined;
}

/** One row of the merge panel's reasons, as the checklist draws it. */
export interface Row {
  readonly key: string;
  readonly kind: 'fail' | 'wait' | 'ok' | 'todo' | 'info';
  readonly glyph:
    | 'ok'
    | 'review'
    | 'failed'
    | 'running'
    | 'pending'
    | 'conversation'
    | 'behind'
    | 'conflict'
    | 'draft'
    | 'rule'
    | 'unknown';
  readonly title: string;
  readonly detail: string | undefined;
  readonly link: RowLink | undefined;
  readonly subs: readonly RowSub[];
  /** Whether it offers the next unresolved conversation, `]t`. */
  readonly nextThread: boolean;
  /** Whether it's a reason the pull request can't merge, rather than something to know. */
  readonly inTheWay: boolean;
}

/** The merge panel's head: the verdict, and what it merges into and how it stands. */
export interface PanelHead {
  readonly kind: MergeKind;
  readonly verdict: string;
  /** Before the base branch: "into". Nothing when the line doesn't start with it. */
  readonly into: boolean;
  /** After the base branch, or the whole line without it. */
  readonly after: string | undefined;
}

const SEE_ON_GITHUB = 'See it on GitHub ↗';

/** `count` and `word`, with an s for any count but one: "2 checks". */
export function counted(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** `text` with its first letter capitalized. */
export function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Names joined as a sentence says them: "a", "a and b", "a, b and c". */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  return listed(prs.map((pr) => `#${pr}`));
}

/** How many layers a merge with `together` merges, its pull request among them: 1 for one alone. */
export function layersOf(together: Together | null): number {
  return together?.kind === 'stack' ? together.below.length + 1 : 1;
}

/** A place in a queue: "1st", "2nd", "3rd", "11th". */
export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/** A method as a word, as the merge panel's control names it: "Squash". */
export function methodLabel(method: Method): string {
  switch (method) {
    case 'SQUASH':
      return 'Squash';
    case 'MERGE':
      return 'Merge commit';
    case 'REBASE':
      return 'Rebase';
    default:
      method satisfies never;
      return String(method);
  }
}

/** What the merge button says for `method`: "Squash and merge". */
export function mergeLabel(method: Method): string {
  switch (method) {
    case 'SQUASH':
      return 'Squash and merge';
    case 'MERGE':
      return 'Merge';
    case 'REBASE':
      return 'Rebase and merge';
    default:
      method satisfies never;
      return 'Merge';
  }
}

/** A reviewer as the panel names them: "@jun-park", "@fieldwork/api-platform". */
function reviewerName(reviewer: Reviewer): string {
  return reviewer.kind === 'user' ? `@${reviewer.login}` : `@${reviewer.slug}`;
}

/** The checks of `blockers` of one kind and state, in their order. */
type CheckGroup = 'failed' | 'notReported' | 'awaiting' | 'running' | 'yet';

/** Which group a check's blocker goes in. */
function groupOf(blocker: Extract<Blocker, { kind: 'check' | 'notReported' }>): CheckGroup {
  if (blocker.kind === 'notReported') return 'notReported';
  switch (blocker.check.state) {
    case 'failed':
      return 'failed';
    case 'awaitingApproval':
      return 'awaiting';
    case 'missing':
      return 'yet';
    case 'running':
    case 'passed':
      return 'running';
    default:
      blocker.check.state satisfies never;
      return 'running';
  }
}

/** A short name for each kind of reason, for the header's one line. */
function shortOf(blocker: Blocker, checks: ReadonlyMap<CheckGroup, readonly Check[]>): string {
  switch (blocker.kind) {
    case 'merged':
      return 'merged';
    case 'closed':
      return 'closed';
    case 'draft':
      return 'draft';
    case 'conflicts':
      return 'conflicts';
    case 'outOfDate':
      return 'out of date';
    case 'changesRequested':
      return 'changes requested';
    case 'approvals':
      return 'review required';
    case 'check':
    case 'notReported': {
      const group = groupOf(blocker);
      const count = checks.get(group)?.length ?? 0;
      switch (group) {
        case 'failed':
          return `${counted(count, 'check')} failed`;
        case 'notReported':
          return `${counted(count, 'check')} not reported`;
        case 'awaiting':
          return `${counted(count, 'check')} awaiting approval`;
        case 'running':
          return `${counted(count, 'check')} running`;
        case 'yet':
          return `${counted(count, 'check')} yet to report`;
        default:
          group satisfies never;
          return 'checks';
      }
    }
    case 'conversations':
      return `${blocker.unresolved}${blocker.cutShort ? '+' : ''} unresolved`;
    case 'rule':
      return blocker.description;
    case 'checkingMergeability':
      return 'GitHub is checking';
    case 'unexplained':
      return 'GitHub says no';
    default:
      blocker satisfies never;
      return 'in the way';
  }
}

/** The checks among `blockers`, by group, in their order. */
function checksOf(blockers: readonly Blocker[]): Map<CheckGroup, Check[]> {
  const groups = new Map<CheckGroup, Check[]>();
  for (const blocker of blockers) {
    if (blocker.kind !== 'check' && blocker.kind !== 'notReported') continue;
    const group = groupOf(blocker);
    groups.set(group, [...(groups.get(group) ?? []), blocker.check]);
  }
  return groups;
}

/** The kind of reason `blocker` is, so a group of checks is one. */
function reasonKey(blocker: Blocker): string {
  return blocker.kind === 'check' || blocker.kind === 'notReported'
    ? `checks-${groupOf(blocker)}`
    : blocker.kind === 'rule'
      ? `rule-${blocker.description}`
      : blocker.kind;
}

/** Each kind of reason once, in the order the first of it comes: a group of checks is one. */
function reasons(blockers: readonly Blocker[]): Blocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = reasonKey(blocker);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the header says after the verdict for what's in the way: "Review required · 2 checks running". */
function inTheWay(blockers: readonly Blocker[]): string {
  const checks = checksOf(blockers);
  return capitalized(
    reasons(blockers)
      .map((blocker) => shortOf(blocker, checks))
      .join(' · '),
  );
}

/** What the hover says of what may be missing from `state`, when something may be. */
function caveat(state: MergeState): string | undefined {
  if (state.incomplete === 'checksCutShort') {
    return 'GitHub has over 1,000 checks here, and Lo reads the first 1,000.';
  }
  if (state.incomplete === 'readAgain') {
    return 'GitHub left part of this out, so Lo may not see all of it. Lo is reading it again.';
  }
  if (state.partial) return 'Lo may not see every rule';
  return undefined;
}

/** How the merge method reads after "Ready to merge": "Squash into main". */
function readyDetail(action: Action, base: string): string {
  switch (action.kind) {
    case 'merge':
      return `${methodLabel(action.method)} into ${base}`;
    case 'enqueue':
      return `through the queue for ${base}`;
    case 'notPossible':
      return `into ${base}`;
    default:
      action satisfies never;
      return `into ${base}`;
  }
}

/**
 * How long a status goes unread before it says how old it is: twice the five minutes the poller
 * lets a read stand, while nothing it watches changes, before it reads it again.
 */
export const STALE_AFTER = 10 * 60_000;

/** How long ago `at` was, from `now`, in words: "a moment ago", "3 min ago", "2 hours ago". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'a moment ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * Whether `state` may be out of date at `now`, and why: Lo couldn't read it again (`why`), or it's
 * gone unread past {@link STALE_AFTER}. Nothing while it's current, or once it merged.
 */
export function staleness(
  state: MergeState,
  now: number,
): { readonly ago: string; readonly why: string | undefined } | undefined {
  if (state.verdict === 'merged') return undefined;
  if (state.stale === null && now - state.readAt < STALE_AFTER) return undefined;
  return { ago: ago(state.readAt, now), why: state.stale ?? undefined };
}

/**
 * The header's merge status for `view` at `now`, with its place in the merge queue as `queue` last
 * read it, or nothing while there's nothing to show: before the first read, and for a view that
 * reads none.
 */
export function headerLine(
  view: MergeView | undefined,
  now: number = Date.now(),
  queue?: InQueue,
): HeaderLine | undefined {
  if (view === undefined) return undefined;
  switch (view.kind) {
    case 'none':
    case 'loading':
      return undefined;
    case 'failed':
      return {
        kind: 'waiting',
        verdict: 'Can’t tell whether it can merge',
        detail: undefined,
        title: view.why,
        opens: false,
      };
    case 'known':
      return dated(queuedLine(knownLine(view.state), view.state, queue), view.state, now);
    default:
      view satisfies never;
      return undefined;
  }
}

/** `line`, saying how old `state` is when it may be out of date at `now`. */
function dated(line: HeaderLine, state: MergeState, now: number): HeaderLine {
  const old = staleness(state, now);
  if (!old) return line;
  const said =
    old.why === undefined
      ? `Lo hasn’t read this since ${old.ago}.`
      : `Lo couldn’t check again: ${old.why}`;
  return {
    ...line,
    detail: [line.detail, `as of ${old.ago}`].filter((part) => part !== undefined).join(' · '),
    title: line.title === undefined ? said : `${line.title}\n${said}`,
  };
}

function knownLine(state: MergeState): HeaderLine {
  const title = caveat(state);
  switch (state.verdict) {
    case 'merged':
      return { kind: 'merged', verdict: 'Merged', detail: undefined, title, opens: false };
    case 'closed':
      return { kind: 'closed', verdict: 'Closed', detail: undefined, title, opens: false };
    case 'queued':
      return {
        kind: 'queued',
        verdict: state.position === null ? 'Queued' : `Queued, ${ordinal(state.position)}`,
        detail: undefined,
        title,
        opens: true,
      };
    case 'ready': {
      // A read that may be missing something never looks clean at a glance.
      const unsure = state.incomplete !== null || state.partial;
      return {
        kind: unsure ? 'waiting' : 'ready',
        verdict: state.action.kind === 'enqueue' ? 'Ready for the queue' : 'Ready to merge',
        detail: unsure ? 'Lo may not see everything' : readyDetail(state.action, state.base),
        title,
        opens: true,
      };
    }
    case 'waiting':
      if (state.autoMerge) {
        return {
          kind: 'auto',
          verdict: 'Merges when ready',
          detail: 'Auto-merge on',
          title,
          opens: true,
        };
      }
      return {
        kind: 'waiting',
        verdict: 'Can’t merge yet',
        detail: inTheWay(state.blockers),
        title,
        opens: true,
      };
    case 'blocked':
      return {
        kind: 'blocked',
        verdict: 'Can’t merge',
        detail: `${inTheWay(state.blockers)}${state.autoMerge ? ' · auto-merge on' : ''}`,
        title,
        opens: true,
      };
    default:
      state.verdict satisfies never;
      return { kind: 'blocked', verdict: 'Can’t merge', detail: undefined, title, opens: true };
  }
}

/** A length of time GitHub estimates, in seconds, in words: "12 min", "2 h", "1 h 5 min". */
export function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Why a queued pull request's place may be missing failed checks, on hover. */
export const PARTIAL_CHECKS = 'GitHub left part of the queue out, so more checks may have failed.';

/** Why the header no longer says a pull request's place, on hover, once the queue stops listing it. */
export const LEFT_CHECKING = 'The merge queue no longer lists it. Lo is reading whether it merged.';

/** `line`'s hover, with `more` after it. */
function hover(line: HeaderLine, more: string): string {
  return line.title === undefined ? more : `${line.title}\n${more}`;
}

/**
 * `line`, from GitHub's read of a queued pull request, with what Lo last read of its entry in the
 * queue: its place, which that read has fresher, and when it should merge; once it failed there,
 * that it will be removed, and which checks failed; and once the queue no longer lists it, that it
 * left, never the place it had, until a read of the pull request says how.
 */
function queuedLine(line: HeaderLine, state: MergeState, queue: InQueue | undefined): HeaderLine {
  const place = queue?.place;
  if (state.verdict !== 'queued' || !place) return line;
  if (place.kind === 'unlisted') {
    // Partly read, the queue may list it where Lo can't see: GitHub's place stands.
    if (place.partial) return line;
    return {
      ...line,
      kind: 'waiting',
      verdict: 'Left the queue',
      detail: 'checking',
      title: hover(line, LEFT_CHECKING),
    };
  }
  if (place.state === 'UNMERGEABLE') {
    const names = place.failed.map((check) => check.name);
    return {
      ...line,
      kind: 'blocked',
      verdict: 'Will be removed',
      detail: names.length > 0 ? `${listed(names)} failed in the queue` : 'from the merge queue',
      title: place.partial ? hover(line, PARTIAL_CHECKS) : line.title,
    };
  }
  return {
    ...line,
    verdict: `Queued, ${ordinal(place.position)}`,
    detail: place.timeToMerge === null ? line.detail : `about ${duration(place.timeToMerge)}`,
  };
}

/** The merge panel's head for `state`. */
export function panelHead(state: MergeState): PanelHead {
  const line = knownLine(state);
  const things = rowsOf(state).filter((row) => row.inTheWay).length;
  switch (state.verdict) {
    case 'queued':
      return {
        kind: line.kind,
        verdict: line.verdict,
        into: false,
        after: `In the merge queue for ${state.base}`,
      };
    case 'ready': {
      if (state.action.kind === 'enqueue') {
        return {
          kind: line.kind,
          verdict: line.verdict,
          into: false,
          after: `${state.base} merges through a queue`,
        };
      }
      const said = [
        state.approvedBy.length > 0 ? `approved by ${listed(state.approvedBy)}` : undefined,
        state.checks.total > 0 ? `${counted(state.checks.passed, 'check')} passed` : undefined,
      ].filter((part) => part !== undefined);
      return {
        kind: line.kind,
        verdict: line.verdict,
        into: true,
        after: said.length > 0 ? `· ${said.join(' · ')}` : undefined,
      };
    }
    case 'waiting':
      if (state.autoMerge) {
        const { method, by } = state.autoMerge;
        const said = [
          'Auto-merge on',
          method === null ? undefined : methodLabel(method).toLowerCase(),
          by === null ? undefined : `turned on by ${by}`,
        ].filter((part) => part !== undefined);
        return { kind: line.kind, verdict: line.verdict, into: false, after: said.join(' · ') };
      }
      return {
        kind: line.kind,
        verdict: line.verdict,
        into: true,
        after: `· ${counted(things, 'thing')} in the way`,
      };
    case 'merged':
    case 'closed':
    case 'blocked':
      return {
        kind: line.kind,
        verdict: line.verdict,
        into: true,
        after: things > 0 ? `· ${counted(things, 'thing')} in the way` : undefined,
      };
    default:
      state.verdict satisfies never;
      return { kind: line.kind, verdict: line.verdict, into: true, after: undefined };
  }
}

/** A check under a reason, with its run linked when it has one. */
function subOf(check: Check, index: number, failed: boolean): RowSub {
  return {
    key: `${index}`,
    name: check.name,
    note: failed ? 'failed' : undefined,
    tone: failed ? 'fail' : 'quiet',
    link: check.url === null ? undefined : { label: 'Open the run ↗', url: check.url },
  };
}

/**
 * What the review a pull request still needs says: "1 more approval, and one from a code owner: @a."
 * With no code owner asked, `base`'s rule is named, hedged: GitHub asks nobody when the only code
 * owner is the pull request's author, and drops its request once a code owner approved.
 */
function approvalsDetail(
  { more, codeOwners, codeOwnerRule }: Extract<Blocker, { kind: 'approvals' }>,
  base: string,
): string {
  const names = listed(codeOwners.map(reviewerName));
  if (more > 0 && codeOwners.length > 0) {
    return `${counted(more, 'more approval')}, and one from a code owner: ${names}.`;
  }
  if (codeOwners.length > 0) return `An approval from a code owner: ${names}.`;
  const rule = `${base} also requires a code owner’s approval for changed files that have an owner`;
  if (more > 0) {
    return codeOwnerRule
      ? `${counted(more, 'more approval')}. ${rule}, which may be one of them or given already.`
      : `${counted(more, 'more approval')}.`;
  }
  return codeOwnerRule
    ? `GitHub requires a review it doesn’t name. ${rule}, which may be it.`
    : 'GitHub requires a review it doesn’t name, such as one of the latest push.';
}

/** The row for a group of checks. */
function checksRow(group: CheckGroup, checks: readonly Check[]): Row {
  const count = checks.length;
  const failed = group === 'failed';
  const subs = checks.map((check, index) => subOf(check, index, failed));
  const base = { key: `checks-${group}`, subs, link: undefined, nextThread: false, inTheWay: true };
  switch (group) {
    case 'failed':
      return {
        ...base,
        kind: 'fail',
        glyph: 'failed',
        title: `${count} required ${count === 1 ? 'check' : 'checks'} failed`,
        detail: undefined,
      };
    case 'notReported':
      return {
        ...base,
        kind: 'fail',
        glyph: 'pending',
        title: `${counted(count, 'check')} ${count === 1 ? 'hasn’t' : 'haven’t'} reported`,
        detail:
          count === 1
            ? `${checks[0]?.name ?? 'It'} is required by the branch rules but hasn’t started.`
            : 'They’re required by the branch rules but haven’t started.',
      };
    case 'awaiting':
      return {
        ...base,
        kind: 'wait',
        glyph: 'pending',
        title: `${counted(count, 'check')} waiting for a deployment’s approval`,
        detail: undefined,
      };
    case 'running':
      return {
        ...base,
        kind: 'wait',
        glyph: 'running',
        title: `${counted(count, 'check')} running`,
        detail: undefined,
      };
    case 'yet':
      return {
        ...base,
        kind: 'wait',
        glyph: 'pending',
        title: `${counted(count, 'check')} yet to report`,
        detail: 'Something on the head can still report them.',
      };
    default:
      group satisfies never;
      return { ...base, kind: 'wait', glyph: 'pending', title: 'Checks', detail: undefined };
  }
}

/** The row for a reason that isn't a check. */
function reasonRow(
  blocker: Exclude<Blocker, { kind: 'check' | 'notReported' }>,
  base: string,
): Row {
  const row = {
    key: reasonKey(blocker),
    subs: [],
    link: undefined,
    nextThread: false,
    inTheWay: true,
  };
  switch (blocker.kind) {
    case 'merged':
      return { ...row, kind: 'info', glyph: 'ok', title: 'It’s merged', detail: undefined };
    case 'closed':
      return { ...row, kind: 'info', glyph: 'failed', title: 'It’s closed', detail: undefined };
    case 'draft':
      return {
        ...row,
        kind: 'fail',
        glyph: 'draft',
        title: 'This is a draft',
        detail: 'The author marks it ready on GitHub.',
      };
    case 'conflicts':
      return {
        ...row,
        kind: 'fail',
        glyph: 'conflict',
        title: `Conflicts with ${base}`,
        detail: 'The author resolves them on their branch; Lo doesn’t add commits to a PR.',
      };
    case 'outOfDate':
      return {
        ...row,
        kind: 'fail',
        glyph: 'behind',
        title: `Out of date with ${base}`,
        detail: 'The author updates the branch; Lo doesn’t add commits to a PR.',
      };
    case 'changesRequested':
      return {
        ...row,
        kind: 'fail',
        glyph: 'review',
        title: 'Changes requested',
        detail:
          blocker.by.length > 0
            ? `By ${listed(blocker.by)}. Their approval, or their review dismissed, clears it.`
            : 'By a reviewer Lo can’t see.',
      };
    case 'approvals':
      return {
        ...row,
        kind: 'wait',
        glyph: 'review',
        title: 'Review required',
        detail: approvalsDetail(blocker, base),
      };
    case 'conversations':
      return {
        ...row,
        kind: 'fail',
        glyph: 'conversation',
        title: `${blocker.cutShort ? 'At least ' : ''}${counted(blocker.unresolved, 'unresolved conversation')}`,
        detail: 'The branch rules ask for every conversation to be resolved.',
        nextThread: true,
      };
    case 'rule':
      return {
        ...row,
        kind: blocker.waiting ? 'wait' : 'fail',
        glyph: 'rule',
        title: blocker.description,
        detail: undefined,
        link: blocker.url === null ? undefined : { label: SEE_ON_GITHUB, url: blocker.url },
      };
    case 'checkingMergeability':
      return {
        ...row,
        kind: 'wait',
        glyph: 'running',
        title: 'GitHub is checking whether it merges cleanly',
        detail: 'Lo reads it again.',
      };
    case 'unexplained':
      return {
        ...row,
        kind: 'fail',
        glyph: 'unknown',
        title: 'GitHub says no, and not why',
        detail: 'Lo checked reviews, checks, conversations and rules.',
        link: { label: SEE_ON_GITHUB, url: blocker.url },
      };
    default:
      blocker satisfies never;
      return { ...row, kind: 'fail', glyph: 'unknown', title: 'In the way', detail: undefined };
  }
}

/** What a rule Lo doesn't check requires, in a few words. */
function uncheckedTitle(rule: Unchecked): string {
  switch (rule.kind) {
    case 'signatures':
      return 'Commits must be signed';
    case 'deployments':
      return 'Deployments must succeed';
    case 'locked':
      return 'The branch is locked';
    case 'codeScanning':
      return 'Code scanning must report';
    case 'workflows':
      return 'Workflows must pass';
    case 'reviewersByFile':
      return 'Some files need reviewers of their own';
    case 'copilotApproval':
      return 'Copilot’s changes need one more approval';
    case 'other':
      return `A rule Lo doesn’t know: ${rule.type}`;
    default:
      rule satisfies never;
      return 'A rule Lo doesn’t know';
  }
}

/**
 * The merge panel's rows for `state`: a row for each reason it can't merge, in `blockers`' order,
 * the checks of a state together, each a sub-row with its run; then what may be missing, as rules
 * Lo doesn't check, a read GitHub left part of out, or a block Lo may not see all of; and, at `now`,
 * how old it is when it may be out of date.
 */
export function rowsOf(state: MergeState, now: number = Date.now()): Row[] {
  const rows: Row[] = [];
  if (state.verdict === 'merged' || state.verdict === 'closed') return rows;
  const checks = checksOf(state.blockers);
  for (const blocker of reasons(state.blockers)) {
    if (blocker.kind === 'check' || blocker.kind === 'notReported') {
      const group = groupOf(blocker);
      rows.push(checksRow(group, checks.get(group) ?? []));
    } else {
      rows.push(reasonRow(blocker, state.base));
    }
  }
  if (state.verdict === 'ready' && state.action.kind === 'notPossible') {
    const { reason } = state.action;
    if (reason === 'noPermission') {
      rows.push({
        key: 'noPermission',
        kind: 'fail',
        glyph: 'rule',
        title: `You can’t merge into ${state.base}`,
        detail: 'Merging takes write access to the repository.',
        link: undefined,
        subs: [],
        nextThread: false,
        inTheWay: true,
      });
    } else if (reason === 'noMethod') {
      rows.push({
        key: 'noMethod',
        kind: 'fail',
        glyph: 'rule',
        title: 'The repository allows no merge method',
        detail: 'A maintainer allows one in its settings.',
        link: undefined,
        subs: [],
        nextThread: false,
        inTheWay: true,
      });
    }
  }
  // Rules Lo doesn't check may be why GitHub says no; once it says yes, they're met.
  if (state.verdict !== 'ready' && state.verdict !== 'queued') {
    for (const [index, rule] of state.unchecked.entries()) {
      rows.push({
        key: `unchecked-${index}`,
        kind: 'info',
        glyph: 'rule',
        title: uncheckedTitle(rule),
        detail: `A rule on ${state.base}, which Lo doesn’t check.`,
        link: undefined,
        subs: [],
        nextThread: false,
        inTheWay: false,
      });
    }
  }
  if (state.incomplete !== null) {
    rows.push({
      key: 'incomplete',
      kind: 'info',
      glyph: 'unknown',
      title:
        state.incomplete === 'checksCutShort'
          ? 'GitHub has over 1,000 checks here'
          : 'GitHub left part of this out',
      detail:
        state.incomplete === 'checksCutShort'
          ? 'Lo reads the first 1,000, so what’s shown may not be all.'
          : 'What’s shown may not be all of it. Lo is reading it again.',
      link: { label: SEE_ON_GITHUB, url: state.url },
      subs: [],
      nextThread: false,
      inTheWay: false,
    });
  } else if (state.partial) {
    rows.push({
      key: 'partial',
      kind: 'info',
      glyph: 'unknown',
      title: 'Lo may not see every rule',
      detail: 'GitHub may block it for more than what’s listed here.',
      link: { label: SEE_ON_GITHUB, url: state.url },
      subs: [],
      nextThread: false,
      inTheWay: false,
    });
  }
  const old = staleness(state, now);
  if (old) {
    rows.push({
      key: 'stale',
      kind: 'info',
      glyph: 'unknown',
      title: old.why === undefined ? `As of ${old.ago}` : 'Lo couldn’t check again',
      detail:
        old.why === undefined
          ? 'Lo hasn’t read it again since.'
          : `${old.why} What’s shown is as of ${old.ago}.`,
      link: undefined,
      subs: [],
      nextThread: false,
      inTheWay: false,
    });
  }
  return rows;
}

/** The page a row opens with `o`: its own link, else its first check's run. */
export function rowPage(row: Row): string | undefined {
  return row.link?.url ?? row.subs.find((sub) => sub.link !== undefined)?.link?.url;
}

/** What the method control's note says of the methods the repository doesn't allow, if any. */
export function methodNote(state: MergeState): string | undefined {
  const { methods, signedCommits } = state;
  const off = [
    methods.merge ? undefined : 'Merge commits',
    methods.squash ? undefined : 'Squashes',
    methods.rebase ? undefined : 'Rebases',
  ].filter((name) => name !== undefined);
  const said: string[] = [];
  if (off.length > 0) said.push(`${listed(off)} are off in this repo`);
  if (methods.rebase && signedCommits)
    said.push(`${state.base} needs signed commits, so no rebase`);
  return said.length > 0 ? said.join('. ') : undefined;
}

/**
 * The method the panel shows: the one chosen there, if still allowed, else the one picked first.
 * Into a merge queue, the queue's own, which merges it whatever was picked, or none when the
 * account may not read it.
 */
export function shownMethod(state: MergeState, chosen: Method | undefined): Method | undefined {
  const { action } = state;
  if (action.kind === 'merge') {
    return chosen !== undefined && action.methods.includes(chosen) ? chosen : action.method;
  }
  if (action.kind === 'enqueue') return action.method ?? undefined;
  if (state.queue.required) return state.queue.method ?? undefined;
  return state.picked ?? undefined;
}

/** The method `step` places on from `method` among those `state` allows, round. */
export function steppedMethod(
  state: MergeState,
  chosen: Method | undefined,
  step: 1 | -1,
): Method | undefined {
  if (state.action.kind !== 'merge') return undefined;
  const { methods } = state.action;
  const at = methods.indexOf(shownMethod(state, chosen) ?? state.action.method);
  return methods[(at + step + methods.length) % methods.length];
}

/** A number of minutes or hours, as a clock writes it: "05". */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A clock time as the interface writes it: "14:05". */
function clock(at: number): string {
  const time = new Date(at);
  return `${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}`;
}

/** Why Lo merges nothing now, whatever the pull request's state. */
export function offWords(off: Off): string {
  switch (off.kind) {
    case 'offline':
      return 'Offline. Merging waits until you’re back.';
    case 'paused':
      return `GitHub asked Lo to hold off until ${clock(off.until)}. Merge then.`;
    case 'signedOut':
      return 'The account is signed out of GitHub. Sign in again, then merge.';
    default:
      off satisfies never;
      return 'Lo can’t merge now.';
  }
}

/** Why `⏎` in the panel can't merge now, or nothing when it can. */
export function cantMerge(state: MergeState, number: number): string | undefined {
  const { action } = state;
  if (action.kind === 'notPossible') {
    switch (action.reason) {
      case 'merged':
        return `#${number} is merged.`;
      case 'closed':
        return `#${number} is closed.`;
      case 'queued':
        return `#${number} is in the merge queue already.`;
      case 'blocked': {
        const why = inTheWay(state.blockers) || 'GitHub says no';
        return `#${number} can’t merge yet: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
      }
      case 'noPermission':
        return `GitHub doesn’t let this account merge into ${state.base}.`;
      case 'noMethod':
        return 'The repository allows no merge method.';
      default:
        action.reason satisfies never;
        return 'Lo can’t merge it now.';
    }
  }
  return state.off === null ? undefined : offWords(state.off);
}

/**
 * The confirmation's title: "Merge #4821 into main?", "Add #4821 to the merge queue for main?",
 * "Merge #4821 when it’s ready?", "Merge #4821 without the rules?", and for a stack's layer, "Merge
 * 3 layers into main?"
 */
export function confirmTitle(
  plan: Pick<MergePlan, 'kind' | 'number' | 'base'> & { readonly together?: Together | null },
): string {
  const layers = layersOf(plan.together ?? null);
  const what = layers > 1 ? `${layers} layers` : `#${plan.number}`;
  switch (plan.kind) {
    case 'merge':
      return `Merge ${what} into ${plan.base}?`;
    case 'enqueue':
      return `Add ${what} to the merge queue for ${plan.base}?`;
    case 'autoMerge':
    case 'whenReady':
      return `Merge #${plan.number} when it’s ready?`;
    case 'override':
      return `Merge #${plan.number} without the rules?`;
    default:
      plan.kind satisfies never;
      return `Merge #${plan.number} into ${plan.base}?`;
  }
}

/** What the confirmation's main button says: "Squash and merge", or "Merge 3 layers" for a stack. */
export function confirmLabel(
  plan: Pick<MergePlan, 'kind' | 'method'> & { readonly together?: Together | null },
): string {
  const layers = layersOf(plan.together ?? null);
  switch (plan.kind) {
    case 'merge':
      return layers > 1 ? `Merge ${layers} layers` : mergeLabel(plan.method ?? 'MERGE');
    case 'enqueue':
      return layers > 1 ? `Add ${layers} layers to the merge queue` : 'Add to merge queue';
    case 'autoMerge':
    case 'whenReady':
      return 'Merge when ready';
    case 'override':
      return 'Merge anyway';
    default:
      plan.kind satisfies never;
      return 'Merge';
  }
}

/**
 * What the confirmation's main button says while what it was pressed for runs: the verb of
 * {@link confirmLabel}, as a progress label.
 */
export function confirmWorking(plan: Pick<MergePlan, 'kind'>): string {
  switch (plan.kind) {
    case 'merge':
    case 'override':
      return 'Merging…';
    case 'enqueue':
      return 'Adding…';
    case 'autoMerge':
    case 'whenReady':
      return 'Turning on…';
    default:
      plan.kind satisfies never;
      return 'Merging…';
  }
}

/** A method as GitHub doing it: "squashes". */
function merges(method: Method | null): string {
  switch (method) {
    case 'SQUASH':
      return 'squashes';
    case 'REBASE':
      return 'rebases';
    case 'MERGE':
    case null:
      return 'merges';
    default:
      method satisfies never;
      return 'merges';
  }
}

/**
 * What a confirmation of auto-merge or of a merge past the rules names, and the branch it merges
 * into: as the plan carries it, or a view's status says it.
 */
export type Said = Named & { readonly base: string };

/** What the confirmation of `plan` names, as main planned it. */
export function saidOf(plan: MergePlan): Said | undefined {
  return plan.named === null ? undefined : { ...plan.named, base: plan.base };
}

/**
 * What auto-merge waits on, from `state`'s reasons: "it’s approved and e2e (chromium) and
 * typecheck pass". A block Lo can't see all of waits on the base branch's rules.
 */
export function waitsFor(state: Said): string {
  const parts: string[] = [];
  if (state.blockers.some((blocker) => blocker.kind === 'approvals')) parts.push('it’s approved');
  const checks = [
    ...new Set(
      state.blockers.flatMap((blocker) =>
        (blocker.kind === 'check' || blocker.kind === 'notReported') &&
        blocker.check.state !== 'failed'
          ? [blocker.check.name]
          : [],
      ),
    ),
  ];
  if (checks.length > 0) parts.push(`${listed(checks)} ${checks.length === 1 ? 'passes' : 'pass'}`);
  if (state.blockers.some((blocker) => blocker.kind === 'checkingMergeability')) {
    parts.push('GitHub finds it merges cleanly');
  }
  if (
    state.partial ||
    state.blockers.some((blocker) => blocker.kind === 'rule' || blocker.kind === 'unexplained')
  ) {
    parts.push(`${state.base}’s other rules are met`);
  }
  return parts.length > 0 ? listed(parts) : 'nothing blocks it';
}

/**
 * What turning auto-merge on does, as its confirmation says: "GitHub squashes #4821 into main once
 * e2e (chromium) and typecheck pass.", or on a branch with a merge queue, "GitHub adds #4821 to the
 * merge queue for main once ci passes."
 */
export function onceLine(plan: MergePlan): string {
  const said = saidOf(plan);
  const once = said === undefined ? 'it’s ready' : waitsFor(said);
  return plan.kind === 'whenReady'
    ? `GitHub adds #${plan.number} to the merge queue for ${plan.base} once ${once}.`
    : `GitHub ${merges(plan.method)} #${plan.number} into ${plan.base} once ${once}.`;
}

/** What turning auto-merge on warns of a push before it merges, if anything. */
export function pushWarning(state: Pick<Said, 'afterPush' | 'base'>): string | undefined {
  switch (state.afterPush) {
    case 'keepsApprovals':
      return 'A push before it merges would merge with the approvals already given.';
    case 'noReview':
      return `${state.base} requires no review, so a push before it merges would merge too.`;
    case 'newApproval':
      return undefined;
    default:
      state.afterPush satisfies never;
      return undefined;
  }
}

/**
 * What a merge past the rules skips, a line each: "1 required check that failed: test (node 20)".
 * It merges straight in, so past a merge queue too.
 */
export function skipsOf(state: Said): string[] {
  const lines: string[] = [];
  if (state.queue.required) lines.push(`The merge queue for ${state.base}`);
  const checks = checksOf(state.blockers);
  for (const blocker of reasons(state.blockers)) {
    switch (blocker.kind) {
      case 'check':
      case 'notReported': {
        const group = groupOf(blocker);
        const names = (checks.get(group) ?? []).map((check) => check.name);
        const count = names.length;
        const which = count === 1 ? 'check' : 'checks';
        const that = {
          failed: 'that failed',
          notReported: count === 1 ? 'that hasn’t reported' : 'that haven’t reported',
          awaiting: 'waiting for a deployment’s approval',
          running: 'still running',
          yet: 'yet to report',
        }[group];
        lines.push(`${count} required ${which} ${that}: ${listed(names)}`);
        break;
      }
      case 'approvals': {
        const owners = listed(blocker.codeOwners.map(reviewerName));
        // A code owner's approval GitHub asked nobody for, which the rules still require.
        const rule = blocker.codeOwners.length === 0 && blocker.codeOwnerRule;
        if (blocker.more > 0 && blocker.codeOwners.length > 0) {
          lines.push(
            `${counted(blocker.more, 'more approval')}, and a code owner review from ${owners}`,
          );
        } else if (blocker.more > 0) {
          lines.push(
            rule
              ? `${counted(blocker.more, 'more approval')}, maybe a code owner’s`
              : counted(blocker.more, 'more approval'),
          );
        } else if (blocker.codeOwners.length > 0) {
          lines.push(`A code owner review from ${owners}`);
        } else {
          lines.push(
            rule ? 'A review GitHub requires, maybe a code owner’s' : 'A review GitHub requires',
          );
        }
        break;
      }
      case 'changesRequested':
        lines.push(
          blocker.by.length > 0
            ? `Changes requested by ${listed(blocker.by)}`
            : 'Changes requested',
        );
        break;
      case 'conversations':
        lines.push(
          `${blocker.cutShort ? 'At least ' : ''}${counted(blocker.unresolved, 'unresolved conversation')}`,
        );
        break;
      case 'outOfDate':
        lines.push(`Being up to date with ${state.base}`);
        break;
      case 'rule':
        lines.push(blocker.description);
        break;
      case 'unexplained':
        lines.push(`What GitHub blocks it for, which Lo can’t see`);
        break;
      // Not rules: GitHub still checks these, and merges past no rule for them.
      case 'merged':
      case 'closed':
      case 'draft':
      case 'conflicts':
      case 'checkingMergeability':
        break;
      default:
        blocker satisfies never;
    }
  }
  for (const rule of state.unchecked) lines.push(uncheckedTitle(rule));
  if (state.partial) lines.push(`Any rule on ${state.base} Lo doesn’t see`);
  return lines;
}

/** Why `a` in the panel can't turn auto-merge on or off now, or nothing when it can. */
export function cantAutoMerge(state: MergeState, number: number): string | undefined {
  const { auto } = state;
  if (auto.kind === 'notPossible') {
    switch (auto.reason) {
      case 'merged':
        return `#${number} is merged.`;
      case 'closed':
        return `#${number} is closed.`;
      case 'queued':
        return `#${number} is in the merge queue already.`;
      case 'ready':
        return `Nothing blocks #${number} now, so it can merge as it is.`;
      case 'blocked': {
        const why = inTheWay(state.blockers);
        return `Something waiting won’t fix is in #${number}’s way: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
      }
      case 'noPermission':
        return `GitHub doesn’t let this account add to the merge queue for ${state.base}.`;
      case 'notAllowed':
        return `GitHub doesn’t let this account turn on auto-merge for #${number}. The repository may not allow it: a maintainer turns it on in its settings.`;
      case 'cantTurnOff':
        return `GitHub doesn’t let this account turn off auto-merge for #${number}.`;
      case 'noMethod':
        return 'The repository allows no merge method.';
      default:
        auto.reason satisfies never;
        return 'Lo can’t turn on auto-merge now.';
    }
  }
  return state.off === null ? undefined : offWords(state.off);
}

/** Why `⌥⏎` in the panel can't merge past the rules now, or nothing when it can. */
export function cantOverride(state: MergeState, number: number): string | undefined {
  const { override } = state;
  if (override.kind === 'notPossible') {
    switch (override.reason) {
      case 'merged':
        return `#${number} is merged.`;
      case 'closed':
        return `#${number} is closed.`;
      case 'queued':
        return `#${number} is in the merge queue already.`;
      case 'nothingToSkip':
        return `Nothing blocks #${number}, so there’s no rule to skip.`;
      case 'noPermission':
        return `GitHub doesn’t let this account merge past ${state.base}’s rules.`;
      case 'draft':
        return `#${number} is a draft, which GitHub doesn’t merge, past the rules or not.`;
      case 'conflicts':
        return `#${number} conflicts with ${state.base}, which no rule skips.`;
      case 'stackLayer':
        return `#${number} sits on another layer of its GitHub stack, and GitHub merges past the rules only a stack’s bottom layer.`;
      case 'noMethod':
        return 'The repository allows no merge method.';
      default:
        override.reason satisfies never;
        return 'Lo can’t merge it past the rules now.';
    }
  }
  return state.off === null ? undefined : offWords(state.off);
}

/**
 * The merge panel's main button for a pull request that sits as `placement` says: "Merge 3 layers"
 * for a stack's layer, else what merging alone would say, `alone`.
 */
export function placedLabel(placement: Placement | undefined, queued: boolean, alone: string) {
  if (placement?.kind !== 'stack') return alone;
  const layers = placement.below.length + 1;
  return queued ? `Add ${layers} layers to the merge queue` : `Merge ${layers} layers`;
}

/** Why `⏎` in the merge panel doesn't merge where the pull request sits, if it doesn't. */
export function placedWhy(placement: Placement | undefined): string | undefined {
  switch (placement?.kind) {
    case 'convert':
      return `${placement.offer} Make this a GitHub stack, then merge it.`;
    case 'refused':
      return placement.why;
    case undefined:
    case 'alone':
    case 'stack':
    case 'chain':
      return undefined;
    default:
      placement satisfies never;
      return undefined;
  }
}

/**
 * What a chain's confirmation says of its base branch moves, each on its own line: "Move #4818
 * onto main", then the merge, then "Move #4819 onto main", each layer on it marked "needs rebase"
 * when the merge leaves its commits out of the base, as a squash or a rebase does, or "may need a
 * rebase" into a merge queue whose method Lo can't read. After a merge commit, which lands them,
 * the layers on it it doesn't move aren't listed.
 */
export function chainSteps(
  plan: Pick<MergePlan, 'number' | 'base' | 'method'>,
  together: Extract<Together, { kind: 'chain' }>,
): { readonly key: string; readonly title: string; readonly detail: string }[] {
  const steps = [];
  const rebase = plan.method === null ? 'may need a rebase' : 'needs rebase';
  const needsRebase = plan.method === 'MERGE' ? [] : together.needsRebase;
  if (together.before) {
    steps.push({
      key: 'before',
      title: `Move #${together.before.pr} onto ${together.before.to}`,
      detail: `From ${together.before.from}, so it merges under ${together.before.to}’s rules`,
    });
  }
  steps.push({ key: 'merge', title: `Merge #${plan.number} into ${plan.base}`, detail: 'Alone' });
  for (const move of together.after) {
    const rebased = needsRebase.includes(move.pr);
    steps.push({
      key: `after-${move.pr}`,
      title: `Move #${move.pr} onto ${move.to}`,
      detail: rebased ? `From ${move.from} · ${rebase}` : `From ${move.from}`,
    });
  }
  for (const pr of needsRebase) {
    if (together.after.some((move) => move.pr === pr)) continue;
    steps.push({
      key: `rebase-${pr}`,
      title: `#${pr} stays on ${plan.base}`,
      detail: capitalized(rebase),
    });
  }
  return steps;
}

/**
 * Where a GitHub stack's layer stands, in its confirmation: "Approved · checks passed". Nothing
 * before the stack's layers were read.
 */
export function layerLine(layer: Pick<StackLayer, 'review' | 'checks'>): string | undefined {
  const said: string[] = [];
  switch (layer.review) {
    case 'approved':
      said.push('Approved');
      break;
    case 'changesRequested':
      said.push('Changes requested');
      break;
    case 'reviewRequired':
      said.push('Review required');
      break;
    case null:
      break;
    default:
      layer.review satisfies never;
  }
  switch (layer.checks) {
    case 'passing':
      said.push('checks passed');
      break;
    case 'running':
      said.push('checks running');
      break;
    case 'failing':
      said.push('checks failed');
      break;
    case null:
      break;
    default:
      layer.checks satisfies never;
  }
  const [first, ...rest] = said;
  if (first === undefined) return undefined;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' · ');
}

/** How long ago `at` was, for a merge in progress: "40 s ago", or as {@link ago} says it. */
export function secondsAgo(at: number, now: number): string {
  const seconds = Math.floor(Math.max(0, now - at) / 1000);
  return seconds < 60 ? `${seconds} s ago` : ago(at, now);
}

/** What a queue entry's confirmation says of the method: the queue's settings choose it. */
export function queueLine(method: Method | null): string {
  const said = 'The queue’s settings choose the method and the message';
  return method === null ? `${said}.` : `${said}: ${methodLabel(method).toLowerCase()}.`;
}

/** What a merge that went says while GitHub runs it. */
export function pendingLine(job: Pick<JobView, 'kind'>): string {
  const doing =
    job.kind === 'enqueue' ? 'GitHub is adding it to the merge queue.' : 'GitHub is merging it.';
  return `${doing} You can close this; the tab shows how it ends.`;
}

/**
 * What the toast says once a merge is done: "Merged #4821 into main", "Merged 3 layers into main",
 * or, for a chain once it has moved the layers on it, "Merged #2260, one layer at a time". Nothing
 * before then.
 */
export function doneLine(job: JobView): string | undefined {
  const { together } = job;
  if (together?.kind === 'chain') {
    return together.phase === 'done' ? `Merged #${job.number}, one layer at a time` : undefined;
  }
  const what = together?.kind === 'stack' ? `${together.layers.length} layers` : `#${job.number}`;
  switch (job.state.kind) {
    case 'merged':
      return `Merged ${what} into ${job.base}`;
    case 'enqueued':
      return `Added ${what} to the merge queue for ${job.base}`;
    case 'autoMergeOn':
      return job.kind === 'whenReady'
        ? `#${job.number} joins the merge queue for ${job.base} once it’s ready`
        : `Turned on auto-merge for #${job.number}`;
    case 'autoMergeOff':
      return `Turned off auto-merge for #${job.number}`;
    case 'sending':
    case 'pending':
    case 'refused':
    case 'unknown':
      return undefined;
    default:
      job.state satisfies never;
      return undefined;
  }
}

/**
 * What follows {@link doneLine} in its toast: for a chain, where the layers on it went, "#2266 now
 * points at main and needs a rebase."
 */
export function doneDetail(job: JobView): string {
  return job.together?.kind === 'chain' ? (job.together.text ?? '') : '';
}

/**
 * What a merge that needs the reader says, first: it was refused, or Lo can't tell how it ended.
 * Nothing for one that doesn't.
 */
export function outcomeTitle(job: JobView): string | undefined {
  const { together } = job;
  if (together?.kind === 'chain' && together.phase === 'stopped') {
    if (job.state.kind === 'merged' || job.state.kind === 'enqueued') {
      return `Lo stopped moving the layers on #${job.number}.`;
    }
  }
  if (together?.kind === 'stack' && job.state.kind === 'refused' && job.kind === 'merge') {
    const { landed } = together;
    if (landed === null) return 'Lo can’t tell which layers merged.';
    return landed.length > 0 ? `Merged ${numbers(landed)} only.` : 'Nothing merged.';
  }
  const auto = job.kind === 'autoMerge' || job.kind === 'whenReady';
  switch (job.state.kind) {
    case 'refused':
      if (auto) return `Couldn’t turn on auto-merge for #${job.number}.`;
      if (job.kind === 'autoMergeOff') return `Couldn’t turn off auto-merge for #${job.number}.`;
      return job.kind === 'enqueue'
        ? `Couldn’t add #${job.number} to the merge queue.`
        : `Couldn’t merge #${job.number}.`;
    case 'unknown':
      if (auto) return `Lo can’t tell whether auto-merge is on for #${job.number}.`;
      if (job.kind === 'autoMergeOff') {
        return `Lo can’t tell whether auto-merge is off for #${job.number}.`;
      }
      return `Lo can’t tell whether #${job.number} merged.`;
    case 'sending':
    case 'pending':
    case 'merged':
    case 'enqueued':
    case 'autoMergeOn':
    case 'autoMergeOff':
      return undefined;
    default:
      job.state satisfies never;
      return undefined;
  }
}

/** What follows {@link outcomeTitle}: why, in the core's sentences, and what GitHub showed since. */
export function outcomeDetail(job: JobView): string {
  const said: string[] = [];
  if (job.already) {
    said.push('GitHub was already merging it, from Lo or elsewhere, so Lo followed that merge.');
  }
  if (job.state.kind === 'refused') said.push(job.state.refusal.text);
  if (job.state.kind === 'unknown') {
    said.push(job.state.text);
    if (job.state.shows === 'open') said.push('GitHub shows it open.');
  }
  const { together } = job;
  if (together?.kind === 'stack' && job.state.kind === 'refused' && job.kind === 'merge') {
    const { landed } = together;
    said.push(
      landed === null
        ? 'Lo couldn’t read which layers went in.'
        : landed.length === 0
          ? 'No layer went in.'
          : `${numbers(landed)} went in all the same, and the layers above ${landed.length === 1 ? 'it' : 'them'} didn’t.`,
    );
  }
  if (together?.kind === 'chain' && together.text !== null && together.phase === 'stopped') {
    if (!said.includes(together.text)) said.push(together.text);
  }
  return said.join(' ');
}

/** How a stack's merge goes, as its dialog says it: "Merging 3 layers into main". */
export function stackLine(job: JobView, progress: Extract<Progress, { kind: 'stack' }>): string {
  const layers = `${progress.layers.length} layers`;
  return job.kind === 'enqueue'
    ? `Adding ${layers} to the merge queue for ${job.base}`
    : `Merging ${layers} into ${job.base}`;
}

/** What a pending merge's trouble says: why Lo's last question got no answer. */
export function troubleLine(trouble: string): string {
  return `Lo couldn’t ask GitHub how it’s going: ${trouble} Lo asks again.`;
}

/**
 * What's in the way among `blockers`, as the header names it after the verdict, but starting in
 * lowercase, to follow other words: "review required · 2 checks running".
 */
export function inTheWayOf(blockers: readonly Blocker[]): string {
  const said = inTheWay(blockers);
  // A rule's own words keep their case.
  if (blockers[0]?.kind === 'rule') return said;
  return said.charAt(0).toLowerCase() + said.slice(1);
}
