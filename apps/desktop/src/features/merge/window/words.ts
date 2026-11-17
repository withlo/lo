// How the window words a pull request's merge status: the header's one line, and the merge panel's
// head, reasons and foot, from what main decided. Text from GitHub, such as logins, branches and
// check names, is drawn as text without the characters that turn text around, which the components
// take out, or `MergeHeader` where it draws the text itself. Nothing here draws.

import type { MergeKind } from '@lo/ui';

import type {
  Action,
  Blocker,
  Check,
  JobView,
  MergePlan,
  MergeState,
  MergeView,
  Method,
  Off,
  Reviewer,
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
function counted(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** `text` with its first letter capitalized. */
function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Names joined as a sentence says them: "a", "a and b", "a, b and c". */
function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
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
 * The header's merge status for `view` at `now`, or nothing while there's nothing to show: before
 * the first read, and for a view that reads none.
 */
export function headerLine(
  view: MergeView | undefined,
  now: number = Date.now(),
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
      return dated(knownLine(view.state), view.state, now);
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

/** What the review a pull request still needs says: "1 more approval, and one from a code owner: @a." */
function approvalsDetail(more: number, owners: readonly Reviewer[]): string {
  const names = listed(owners.map(reviewerName));
  if (more > 0 && owners.length > 0) {
    return `${counted(more, 'more approval')}, and one from a code owner: ${names}.`;
  }
  if (more > 0) return `${counted(more, 'more approval')}.`;
  if (owners.length > 0) return `An approval from a code owner: ${names}.`;
  return 'GitHub requires a review it doesn’t name, such as one of the latest push.';
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
        detail: approvalsDetail(blocker.more, blocker.codeOwners),
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

/** The method the panel shows: the one chosen there, if still allowed, else the one picked first. */
export function shownMethod(state: MergeState, chosen: Method | undefined): Method | undefined {
  const { action } = state;
  if (action.kind === 'merge') {
    return chosen !== undefined && action.methods.includes(chosen) ? chosen : action.method;
  }
  if (action.kind === 'enqueue') return action.method ?? undefined;
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

/** The confirmation's title: "Merge #4821 into main?", "Add #4821 to the merge queue for main?" */
export function confirmTitle(plan: Pick<MergePlan, 'kind' | 'number' | 'base'>): string {
  return plan.kind === 'enqueue'
    ? `Add #${plan.number} to the merge queue for ${plan.base}?`
    : `Merge #${plan.number} into ${plan.base}?`;
}

/** What the confirmation's main button says. */
export function confirmLabel(plan: Pick<MergePlan, 'kind' | 'method'>): string {
  return plan.kind === 'enqueue' ? 'Add to merge queue' : mergeLabel(plan.method ?? 'MERGE');
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

/** What the toast says once a merge is done: "Merged #4821 into main". Nothing before then. */
export function doneLine(job: JobView): string | undefined {
  switch (job.state.kind) {
    case 'merged':
      return `Merged #${job.number} into ${job.base}`;
    case 'enqueued':
      return `Added #${job.number} to the merge queue for ${job.base}`;
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
 * What a merge that needs the reader says, first: it was refused, or Lo can't tell how it ended.
 * Nothing for one that doesn't.
 */
export function outcomeTitle(job: JobView): string | undefined {
  switch (job.state.kind) {
    case 'refused':
      return job.kind === 'enqueue'
        ? `Couldn’t add #${job.number} to the merge queue.`
        : `Couldn’t merge #${job.number}.`;
    case 'unknown':
      return `Lo can’t tell whether #${job.number} merged.`;
    case 'sending':
    case 'pending':
    case 'merged':
    case 'enqueued':
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
  return said.join(' ');
}

/** What a pending merge's trouble says: why Lo's last question got no answer. */
export function troubleLine(trouble: string): string {
  return `Lo couldn’t ask GitHub how it’s going: ${trouble} Lo asks again.`;
}
