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
  PlanKind,
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
  /** Whether it offers the next unresolved thread, `]t`. */
  readonly nextThread: boolean;
  /** Whether it's a reason the pull request can't merge, rather than something to know. */
  readonly inTheWay: boolean;
}

/**
 * The merge panel's head: the verdict, then one line of facts, with the base branch in it as code:
 * `before` it, the branch, then `after` it. A line without the branch has only `after`.
 */
export interface PanelHead {
  readonly kind: MergeKind;
  readonly verdict: string;
  readonly before: string | undefined;
  readonly branch: string | undefined;
  readonly after: string | undefined;
}

/**
 * Who a merge acts as, and where, for the words that name them: the account's login, and the repo
 * as owner/repo.
 */
export interface Who {
  readonly login: string;
  readonly repo: string;
}

/** Who, when the window can't say. */
const SOMEONE: Who = { login: 'This account', repo: 'This repo' };

const ON_GITHUB = 'Open on GitHub';
const IN_BROWSER = 'Open in browser';

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

/** What the dialog's merge button says, whatever the method: "Merge #264". */
export function mergeLabel(number: number): string {
  return `Merge #${number}`;
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
      return 'branch out of date';
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
          return `${counted(count, 'check')} not started`;
        case 'awaiting':
          return `${counted(count, 'check')} waiting for approval`;
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
      return 'checking for conflicts';
    case 'unexplained':
      return 'blocked by GitHub';
    default:
      blocker satisfies never;
      return 'blocked';
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

/** What the header says in place of the method when the read may be missing something. */
function caveat(state: MergeState): string | undefined {
  if (state.incomplete === 'checksCutShort') return 'Over 1,000 checks';
  if (state.incomplete === 'readAgain') return 'Checking…';
  if (state.partial) return 'Some rules aren’t shown';
  return undefined;
}

/** How the merge method reads after "Ready to merge": "Squash into main". */
function readyDetail(action: Action, base: string): string {
  switch (action.kind) {
    case 'merge':
      return `${methodLabel(action.method)} into ${base}`;
    case 'enqueue':
      return `Merge queue for ${base}`;
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

/**
 * How long ago `at` was, from `now`, in its largest whole unit: "just now", "12 min ago", "2 h
 * ago", "3 d ago".
 */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
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

/** The verdict of a status that couldn't be read. */
export const CANT_CHECK = 'Can’t check merge status';

/**
 * The header's merge status for `view` at `now`, with its place in the merge queue as `queue` last
 * read it, or nothing while there's nothing to show: before main says anything, and for a view
 * that reads none.
 */
export function headerLine(
  view: MergeView | undefined,
  now: number = Date.now(),
  queue?: InQueue,
): HeaderLine | undefined {
  if (view === undefined) return undefined;
  switch (view.kind) {
    case 'none':
      return undefined;
    case 'loading':
      // The panel opens on it, saying the same.
      return { kind: 'waiting', verdict: 'Checking…', detail: undefined, opens: true };
    case 'failed':
      // The panel has the reason.
      return { kind: 'waiting', verdict: CANT_CHECK, detail: undefined, opens: true };
    case 'known':
      return dated(queuedLine(knownLine(view.state), view.state, queue), view.state, now);
    default:
      view satisfies never;
      return undefined;
  }
}

/** `line`, saying when `state` was read when it may be out of date at `now`. */
function dated(line: HeaderLine, state: MergeState, now: number): HeaderLine {
  const old = staleness(state, now);
  if (!old) return line;
  return {
    ...line,
    detail: [line.detail, `Checked ${old.ago}`].filter((part) => part !== undefined).join(' · '),
  };
}

function knownLine(state: MergeState): HeaderLine {
  switch (state.verdict) {
    case 'merged':
      return { kind: 'merged', verdict: 'Merged', detail: undefined, opens: false };
    case 'closed':
      return { kind: 'closed', verdict: 'Closed', detail: undefined, opens: false };
    case 'queued':
      return {
        kind: 'queued',
        verdict: state.position === null ? 'Queued' : `Queued, ${ordinal(state.position)}`,
        detail: undefined,
        opens: true,
      };
    case 'ready': {
      // A read that may be missing something never looks clean at a glance.
      const unsure = caveat(state);
      return {
        kind: unsure === undefined ? 'ready' : 'waiting',
        verdict: state.action.kind === 'enqueue' ? 'Ready for merge queue' : 'Ready to merge',
        detail: unsure ?? readyDetail(state.action, state.base),
        opens: true,
      };
    }
    case 'waiting':
      if (state.autoMerge) {
        return {
          kind: 'auto',
          verdict: 'Auto-merge is on',
          // The verdict says the rest, but where it joins a merge queue first.
          detail: state.queue.required ? 'waiting to join' : undefined,
          opens: true,
        };
      }
      return {
        kind: 'waiting',
        verdict: 'Can’t merge yet',
        detail: inTheWay(state.blockers),
        opens: true,
      };
    case 'blocked':
      return {
        kind: 'blocked',
        verdict: 'Can’t merge',
        detail: `${inTheWay(state.blockers)}${state.autoMerge ? ' · auto-merge is on' : ''}`,
        opens: true,
      };
    default:
      state.verdict satisfies never;
      return { kind: 'blocked', verdict: 'Can’t merge', detail: undefined, opens: true };
  }
}

/**
 * A length of time GitHub estimates, in seconds, in its largest whole unit: "12 min", "2 h", "3 d".
 */
export function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * `line`, from GitHub's read of a queued pull request, with what Lo last read of its entry in the
 * queue: its place, which that read has fresher, and when it should merge; once it failed there,
 * that it's leaving, and which checks failed; and once the queue no longer lists it, that it left,
 * never the place it had, until a read of the pull request says how.
 */
function queuedLine(line: HeaderLine, state: MergeState, queue: InQueue | undefined): HeaderLine {
  const place = queue?.place;
  if (state.verdict !== 'queued' || !place) return line;
  if (place.kind === 'unlisted') {
    // Partly read, the queue may list it where Lo can't see: GitHub's place stands.
    if (place.partial) return line;
    return { ...line, kind: 'waiting', verdict: 'Left merge queue', detail: 'Checking…' };
  }
  if (place.state === 'UNMERGEABLE') {
    const names = place.failed.map((check) => check.name);
    return {
      ...line,
      kind: 'blocked',
      verdict: 'Leaving merge queue',
      detail: names.length > 0 ? `${listed(names)} failed` : undefined,
    };
  }
  return {
    ...line,
    verdict: `Queued, ${ordinal(place.position)}`,
    detail:
      place.timeToMerge === null ? line.detail : `merges in about ${duration(place.timeToMerge)}`,
  };
}

/** The merge panel's head for `state`. */
export function panelHead(state: MergeState, who: Who = SOMEONE): PanelHead {
  const line = knownLine(state);
  const things = rowsOf(state, undefined, who).filter((row) => row.inTheWay).length;
  const head = { kind: line.kind, verdict: line.verdict };
  const into = (after: string | undefined): PanelHead => ({
    ...head,
    before: 'into',
    branch: state.base,
    after,
  });
  const count = things > 0 ? `· ${counted(things, 'reason')}` : undefined;
  switch (state.verdict) {
    case 'queued':
      return { ...head, before: 'In the merge queue for', branch: state.base, after: undefined };
    case 'ready': {
      if (state.action.kind === 'enqueue') {
        return { ...head, before: undefined, branch: state.base, after: 'has a merge queue' };
      }
      const said = [
        state.approvedBy.length > 0 ? `approved by ${listed(state.approvedBy)}` : undefined,
        state.checks.total > 0 ? `${counted(state.checks.passed, 'check')} passed` : undefined,
      ].filter((part) => part !== undefined);
      return into(said.length > 0 ? `· ${said.join(' · ')}` : undefined);
    }
    case 'waiting':
      if (state.autoMerge) {
        const { method, by } = state.autoMerge;
        const said = [
          method === null ? undefined : methodLabel(method).toLowerCase(),
          by === null ? undefined : `turned on by ${by}`,
        ].filter((part) => part !== undefined);
        return {
          ...head,
          before: undefined,
          branch: undefined,
          after: said.length > 0 ? said.join(' · ') : undefined,
        };
      }
      return into(count);
    case 'merged':
    case 'closed':
    case 'blocked':
      return into(count);
    default:
      state.verdict satisfies never;
      return into(undefined);
  }
}

/** A check under a reason, with its run linked when it has one. */
function subOf(check: Check, index: number, failed: boolean): RowSub {
  return {
    key: `${index}`,
    name: check.name,
    note: failed ? 'failed' : undefined,
    tone: failed ? 'fail' : 'quiet',
    link: check.url === null ? undefined : { label: IN_BROWSER, url: check.url },
  };
}

/**
 * What the review a pull request still needs says: "1 more approval, and 1 from a code owner: @a."
 * With no code owner asked, `base`'s rule is named: GitHub asks nobody when the only code owner is
 * the pull request's author, and drops its request once a code owner approved.
 */
function approvalsDetail(
  { more, codeOwners, codeOwnerRule }: Extract<Blocker, { kind: 'approvals' }>,
  base: string,
): string | undefined {
  const names = listed(codeOwners.map(reviewerName));
  if (more > 0 && codeOwners.length > 0) {
    return `${counted(more, 'more approval')}, and 1 from a code owner: ${names}.`;
  }
  if (codeOwners.length > 0) return `1 approval from a code owner: ${names}.`;
  const rule = `${base} requires a code owner’s approval.`;
  if (more > 0) {
    return codeOwnerRule
      ? `${counted(more, 'more approval')}. ${rule}`
      : `${counted(more, 'more approval')}.`;
  }
  return codeOwnerRule ? rule : undefined;
}

/** "1 required check", "2 required checks". */
function required(count: number): string {
  return `${count} required ${count === 1 ? 'check' : 'checks'}`;
}

/** The row for a group of checks. */
function checksRow(group: CheckGroup, checks: readonly Check[]): Row {
  const count = checks.length;
  const failed = group === 'failed';
  const subs = checks.map((check, index) => subOf(check, index, failed));
  const base = {
    key: `checks-${group}`,
    subs,
    link: undefined,
    detail: undefined,
    nextThread: false,
    inTheWay: true,
  };
  switch (group) {
    case 'failed':
      return { ...base, kind: 'fail', glyph: 'failed', title: `${required(count)} failed` };
    case 'notReported':
      return {
        ...base,
        kind: 'fail',
        glyph: 'pending',
        title: `${required(count)} ${count === 1 ? 'hasn’t' : 'haven’t'} started`,
      };
    case 'awaiting':
      return {
        ...base,
        kind: 'wait',
        glyph: 'pending',
        title: `${counted(count, 'check')} waiting for deployment approval`,
      };
    case 'running':
      return {
        ...base,
        kind: 'wait',
        glyph: 'running',
        title: `${counted(count, 'check')} running`,
      };
    case 'yet':
      return {
        ...base,
        kind: 'wait',
        glyph: 'pending',
        title: `${counted(count, 'check')} yet to report`,
      };
    default:
      group satisfies never;
      return { ...base, kind: 'wait', glyph: 'pending', title: 'Checks' };
  }
}

/** "2 unresolved threads", or "100+ unresolved threads" for a count cut short. */
function threads(blocker: Extract<Blocker, { kind: 'conversations' }>): string {
  const { unresolved, cutShort } = blocker;
  return `${unresolved}${cutShort ? '+' : ''} unresolved ${unresolved === 1 && !cutShort ? 'thread' : 'threads'}`;
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
    detail: undefined,
    nextThread: false,
    inTheWay: true,
  };
  switch (blocker.kind) {
    case 'merged':
      return { ...row, kind: 'info', glyph: 'ok', title: 'Already merged' };
    case 'closed':
      return { ...row, kind: 'info', glyph: 'failed', title: 'Closed' };
    case 'draft':
      return { ...row, kind: 'fail', glyph: 'draft', title: 'Draft pull request' };
    case 'conflicts':
      return { ...row, kind: 'fail', glyph: 'conflict', title: `Conflicts with ${base}` };
    case 'outOfDate':
      return { ...row, kind: 'fail', glyph: 'behind', title: `Out of date with ${base}` };
    case 'changesRequested':
      return {
        ...row,
        kind: 'fail',
        glyph: 'review',
        title: 'Changes requested',
        detail: blocker.by.length > 0 ? `By ${listed(blocker.by)}.` : undefined,
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
        title: threads(blocker),
        nextThread: true,
      };
    case 'rule':
      return {
        ...row,
        kind: blocker.waiting ? 'wait' : 'fail',
        glyph: 'rule',
        title: blocker.description,
        link: blocker.url === null ? undefined : { label: ON_GITHUB, url: blocker.url },
      };
    case 'checkingMergeability':
      return { ...row, kind: 'wait', glyph: 'running', title: 'Checking for conflicts…' };
    case 'unexplained':
      return {
        ...row,
        kind: 'fail',
        glyph: 'unknown',
        title: 'Blocked by GitHub',
        detail: 'GitHub gives no reason.',
        link: { label: ON_GITHUB, url: blocker.url },
      };
    default:
      blocker satisfies never;
      return { ...row, kind: 'fail', glyph: 'unknown', title: 'Blocked' };
  }
}

/** What a rule Lo doesn't check on `base` requires, in a few words. */
function uncheckedTitle(rule: Unchecked, base: string): string {
  switch (rule.kind) {
    case 'signatures':
      return 'Commits must be signed';
    case 'deployments':
      return 'Deployments must succeed';
    case 'locked':
      return `${base} is locked`;
    case 'codeScanning':
      return 'Code scanning must report';
    case 'workflows':
      return 'Workflows must pass';
    case 'reviewersByFile':
      return 'Some files need reviewers of their own';
    case 'copilotApproval':
      return 'Copilot’s changes need 1 more approval';
    case 'other':
      return `Another rule on ${base}`;
    default:
      rule satisfies never;
      return `Another rule on ${base}`;
  }
}

/** A row of the panel's that says something to know, not a reason it can't merge. */
function infoRow(row: Pick<Row, 'key' | 'title' | 'detail' | 'link'>): Row {
  return {
    ...row,
    kind: 'info',
    glyph: 'unknown',
    subs: [],
    nextThread: false,
    inTheWay: false,
  };
}

/**
 * The merge panel's rows for `state`: a row for each reason it can't merge, in `blockers`' order,
 * the checks of a state together, each a sub-row with its run; then what may be missing, as rules
 * Lo doesn't check, a read GitHub left part of out, or a block not all of whose rules are shown;
 * and, at `now`, when it was read when it may be out of date. `who` names the account and repo.
 */
export function rowsOf(state: MergeState, now: number = Date.now(), who: Who = SOMEONE): Row[] {
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
    const rule = {
      kind: 'fail',
      glyph: 'rule',
      link: undefined,
      subs: [],
      nextThread: false,
      inTheWay: true,
    } as const;
    if (reason === 'noPermission') {
      rows.push({
        ...rule,
        key: 'noPermission',
        title: `${who.login} can’t merge into ${state.base}`,
        detail: 'Merging requires write access.',
      });
    } else if (reason === 'noMethod') {
      rows.push({
        ...rule,
        key: 'noMethod',
        title: `${who.repo} allows no merge method`,
        detail: undefined,
      });
    }
  }
  // Rules Lo doesn't check may be why GitHub says no; once it says yes, they're met.
  if (state.verdict !== 'ready' && state.verdict !== 'queued') {
    for (const [index, rule] of state.unchecked.entries()) {
      rows.push({
        ...infoRow({
          key: `unchecked-${index}`,
          title: uncheckedTitle(rule, state.base),
          detail: 'Not checked.',
          link: undefined,
        }),
        glyph: 'rule',
      });
    }
  }
  if (state.incomplete === 'checksCutShort') {
    rows.push(
      infoRow({
        key: 'incomplete',
        title: 'Over 1,000 checks',
        detail: 'The first 1,000 are shown.',
        link: { label: ON_GITHUB, url: state.url },
      }),
    );
  } else if (state.incomplete === 'readAgain') {
    // It's read again.
    rows.push(
      infoRow({ key: 'incomplete', title: 'Checking…', detail: undefined, link: undefined }),
    );
  } else if (state.partial) {
    rows.push(
      infoRow({
        key: 'partial',
        title: 'Some rules aren’t shown',
        detail: undefined,
        link: { label: ON_GITHUB, url: state.url },
      }),
    );
  }
  const old = staleness(state, now);
  if (old) {
    rows.push(
      infoRow({ key: 'stale', title: `Checked ${old.ago}`, detail: old.why, link: undefined }),
    );
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
    methods.merge ? undefined : 'Merge commit',
    methods.squash ? undefined : 'Squash',
    methods.rebase ? undefined : 'Rebase',
  ].filter((name) => name !== undefined);
  const said: string[] = [];
  if (off.length > 0)
    said.push(`${listed(off)} ${off.length === 1 ? 'is' : 'are'} off in this repo.`);
  if (methods.rebase && signedCommits) {
    said.push(`${state.base} requires signed commits, so Rebase is off.`);
  }
  return said.length > 0 ? said.join(' ') : undefined;
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

/** Why Lo merges nothing now, whatever the pull request's state, as a dimmed control's reason. */
export function offWords(off: Off, who: Who = SOMEONE): string {
  switch (off.kind) {
    case 'offline':
      return 'Offline';
    case 'paused':
      return `GitHub’s rate limit resets at ${clock(off.until)}`;
    case 'signedOut':
      return `${who.login} is signed out`;
    default:
      off satisfies never;
      return 'Offline';
  }
}

/** The titles of the reasons in `rows` that `keep` keeps, a line each, as a dimmed control's reason. */
function titlesOf(rows: readonly Row[], keep: (row: Row) => boolean): string {
  return rows
    .filter((row) => row.inTheWay && keep(row))
    .map((row) => row.title)
    .join('\n');
}

/**
 * Why `⏎` in the panel can't merge now, or nothing when it can: a dimmed control's reason, in a
 * few words. Blocked, it's the reasons' titles, a line each, which the panel lists above it.
 */
export function cantMerge(
  state: MergeState,
  number: number,
  who: Who = SOMEONE,
): string | undefined {
  const { action } = state;
  if (action.kind === 'notPossible') {
    switch (action.reason) {
      case 'merged':
        return `#${number} is already merged`;
      case 'closed':
        return `#${number} is closed`;
      case 'queued':
        return `#${number} is already in the merge queue`;
      case 'blocked':
        return titlesOf(rowsOf(state, undefined, who), () => true) || 'Blocked by GitHub';
      case 'noPermission':
        return `${who.login} can’t merge into ${state.base}`;
      case 'noMethod':
        return `${who.repo} allows no merge method`;
      default:
        action.reason satisfies never;
        return 'Blocked by GitHub';
    }
  }
  if (state.incomplete === 'checksCutShort') return `#${number} has over 1,000 checks`;
  return state.off === null ? undefined : offWords(state.off, who);
}

/**
 * The dialog's title, the same from the check until the merge is done: "Merge #4821", "Add #4821
 * to merge queue", "Turn on auto-merge", "Bypass rules and merge", and for a stack's `layers`,
 * "Merge 3 layers".
 */
export function mergeTitle(kind: PlanKind, number: number, layers: number): string {
  const what = layers > 1 ? `${layers} layers` : `#${number}`;
  switch (kind) {
    case 'merge':
      return `Merge ${what}`;
    case 'enqueue':
      return `Add ${what} to merge queue`;
    case 'autoMerge':
    case 'whenReady':
      return 'Turn on auto-merge';
    case 'override':
      return 'Bypass rules and merge';
    default:
      kind satisfies never;
      return `Merge ${what}`;
  }
}

/** A plan's {@link mergeTitle}. */
export function confirmTitle(
  plan: Pick<MergePlan, 'kind' | 'number'> & { readonly together?: Together | null },
): string {
  return mergeTitle(plan.kind, plan.number, layersOf(plan.together ?? null));
}

/**
 * What the confirmation's main button says, the same whatever the method: "Merge #264", or "Merge
 * 3 layers" for a stack. The title has the count for the merge queue.
 */
export function confirmLabel(
  plan: Pick<MergePlan, 'kind' | 'number'> & { readonly together?: Together | null },
): string {
  const layers = layersOf(plan.together ?? null);
  switch (plan.kind) {
    case 'merge':
      return layers > 1 ? `Merge ${layers} layers` : mergeLabel(plan.number);
    case 'enqueue':
      return 'Add to merge queue';
    case 'autoMerge':
    case 'whenReady':
      return 'Turn on auto-merge';
    case 'override':
      return 'Bypass rules and merge';
    default:
      plan.kind satisfies never;
      return mergeLabel(plan.number);
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
 * typecheck pass". A block not all of whose rules are shown waits on the base branch's rules.
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
    parts.push('it has no conflicts');
  }
  if (
    state.partial ||
    state.blockers.some((blocker) => blocker.kind === 'rule' || blocker.kind === 'unexplained')
  ) {
    parts.push(`the other rules for ${state.base} are met`);
  }
  return parts.length > 0 ? listed(parts) : 'nothing blocks it';
}

/**
 * What turning auto-merge on does, as its confirmation says: "GitHub merges #4821 into main once
 * e2e (chromium) and typecheck pass.", or on a branch with a merge queue, "#4821 joins the merge
 * queue for main once ci passes."
 */
export function onceLine(plan: MergePlan): string {
  const said = saidOf(plan);
  const once = said === undefined ? 'nothing blocks it' : waitsFor(said);
  return plan.kind === 'whenReady'
    ? `#${plan.number} joins the merge queue for ${plan.base} once ${once}.`
    : `GitHub merges #${plan.number} into ${plan.base} once ${once}.`;
}

/** What turning auto-merge on warns of a commit pushed before it merges, if anything. */
export function pushWarning(state: Pick<Said, 'afterPush' | 'base'>): string | undefined {
  switch (state.afterPush) {
    case 'keepsApprovals':
      return 'A commit pushed before it merges will merge with the same approvals.';
    case 'noReview':
      return 'A commit pushed before it merges will merge without review.';
    case 'newApproval':
      return undefined;
    default:
      state.afterPush satisfies never;
      return undefined;
  }
}

/**
 * What a merge past the rules bypasses, a line each: "1 required check failed: test (node 20)".
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
        const names = listed((checks.get(group) ?? []).map((check) => check.name));
        lines.push(`${checksRow(group, checks.get(group) ?? []).title}: ${names}`);
        break;
      }
      case 'approvals': {
        const owners = listed(blocker.codeOwners.map(reviewerName));
        if (blocker.more > 0 && blocker.codeOwners.length > 0) {
          lines.push(
            `${counted(blocker.more, 'more approval')}, and 1 from a code owner: ${owners}`,
          );
        } else if (blocker.more > 0) {
          lines.push(counted(blocker.more, 'more approval'));
        } else if (blocker.codeOwners.length > 0) {
          lines.push(`1 approval from a code owner: ${owners}`);
        } else {
          lines.push('Review required');
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
        lines.push(threads(blocker));
        break;
      case 'outOfDate':
        lines.push(`Out of date with ${state.base}`);
        break;
      case 'rule':
        lines.push(blocker.description);
        break;
      case 'unexplained':
        lines.push('Blocked by GitHub');
        break;
      // Not rules: GitHub still checks these, and bypasses no rule for them.
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
  for (const rule of state.unchecked) lines.push(uncheckedTitle(rule, state.base));
  if (state.partial) lines.push('Some rules aren’t shown');
  return lines;
}

/** Why `a` in the panel can't turn auto-merge on or off now, or nothing when it can. */
export function cantAutoMerge(
  state: MergeState,
  number: number,
  who: Who = SOMEONE,
): string | undefined {
  const { auto } = state;
  if (auto.kind === 'notPossible') {
    switch (auto.reason) {
      case 'merged':
        return `#${number} is already merged`;
      case 'closed':
        return `#${number} is closed`;
      case 'queued':
        return `#${number} is already in the merge queue`;
      case 'ready':
        return `#${number} can merge now`;
      case 'blocked':
        // What waiting won't clear.
        return (
          titlesOf(rowsOf(state, undefined, who), (row) => row.kind === 'fail') ||
          'Blocked by GitHub'
        );
      case 'noPermission':
        return `${who.login} can’t add to the merge queue`;
      case 'notAllowed':
        return `${who.repo} doesn’t allow auto-merge, or ${who.login} can’t merge`;
      case 'cantTurnOff':
        return `${who.login} can’t turn off auto-merge`;
      case 'noMethod':
        return `${who.repo} allows no merge method`;
      default:
        auto.reason satisfies never;
        return 'Blocked by GitHub';
    }
  }
  return state.off === null ? undefined : offWords(state.off, who);
}

/** Why `⌥⏎` in the panel can't merge past the rules now, or nothing when it can. */
export function cantOverride(
  state: MergeState,
  number: number,
  who: Who = SOMEONE,
): string | undefined {
  const { override } = state;
  if (override.kind === 'notPossible') {
    switch (override.reason) {
      case 'merged':
        return `#${number} is already merged`;
      case 'closed':
        return `#${number} is closed`;
      case 'queued':
        return `#${number} is already in the merge queue`;
      case 'nothingToSkip':
        return `No rule blocks #${number}`;
      case 'noPermission':
        return `${who.login} can’t bypass rules for ${state.base}`;
      case 'draft':
        return 'Draft pull requests can’t merge';
      case 'conflicts':
        return `#${number} conflicts with ${state.base}`;
      case 'stackLayer':
        return 'Only a GitHub stack’s bottom layer can bypass rules';
      case 'noMethod':
        return `${who.repo} allows no merge method`;
      default:
        override.reason satisfies never;
        return 'Blocked by GitHub';
    }
  }
  return state.off === null ? undefined : offWords(state.off, who);
}

/**
 * The merge panel's main button for a pull request that sits as `placement` says, which opens the
 * confirmation: "Merge #264…", "Add to merge queue…", and for a stack's layer, "Merge 3 layers…"
 * or "Add 3 layers to merge queue…".
 */
export function panelLabel(
  placement: Placement | undefined,
  queued: boolean,
  number: number,
): string {
  const layers = placement?.kind === 'stack' ? placement.below.length + 1 : 1;
  if (queued) return layers > 1 ? `Add ${layers} layers to merge queue…` : 'Add to merge queue…';
  return layers > 1 ? `Merge ${layers} layers…` : `${mergeLabel(number)}…`;
}

/**
 * What the dialog's main button says for a pull request that sits as `placement` says: "Merge 3
 * layers" for a stack's layer, else what merging alone would say, `alone`.
 */
export function placedLabel(placement: Placement | undefined, queued: boolean, alone: string) {
  if (placement?.kind !== 'stack' || queued) return alone;
  return `Merge ${placement.below.length + 1} layers`;
}

/** Why `⏎` in the merge panel doesn't merge where the pull request sits, if it doesn't. */
export function placedWhy(placement: Placement | undefined): string | undefined {
  switch (placement?.kind) {
    case 'convert':
      return 'Convert to GitHub stack first';
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

/** A step of a chain's merge, in words. */
export interface ChainStep {
  readonly key: string;
  readonly title: string;
  readonly detail: string | undefined;
}

/**
 * What a chain's confirmation says of its base branch moves, each a step: "Move #4818 onto main.",
 * then the merge, then "Move #4819 onto main.", each layer on it marked "Needs a rebase." when the
 * merge leaves its commits out of the base, as a squash or a rebase does; nothing where the method
 * isn't known, as into a merge queue whose method Lo can't read. After a merge commit, which lands
 * them, the layers on it it doesn't move aren't listed.
 */
export function chainSteps(
  plan: Pick<MergePlan, 'number' | 'base' | 'method'>,
  together: Extract<Together, { kind: 'chain' }>,
): ChainStep[] {
  const steps: ChainStep[] = [];
  const known = plan.method !== null;
  const needsRebase = plan.method === 'MERGE' ? [] : together.needsRebase;
  if (together.before) {
    steps.push({
      key: 'before',
      title: `Move #${together.before.pr} onto ${together.before.to}.`,
      detail: `From ${together.before.from}.`,
    });
  }
  steps.push({
    key: 'merge',
    title: `Merge #${plan.number} into ${plan.base}.`,
    detail: undefined,
  });
  for (const move of together.after) {
    const rebased = known && needsRebase.includes(move.pr);
    steps.push({
      key: `after-${move.pr}`,
      title: `Move #${move.pr} onto ${move.to}.`,
      detail: rebased ? `From ${move.from}. Needs a rebase.` : `From ${move.from}.`,
    });
  }
  for (const pr of needsRebase) {
    if (together.after.some((move) => move.pr === pr)) continue;
    steps.push({
      key: `rebase-${pr}`,
      title: `#${pr} stays on ${plan.base}.`,
      detail: known ? 'Needs a rebase.' : undefined,
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

/** What stands where the method control would for a merge queue: its settings choose it. */
export function queueLine(method: Method | null): string {
  return method === null
    ? 'Method set by the merge queue'
    : `${methodLabel(method)}, set by the merge queue`;
}

/**
 * What a merge's result says once it's done, in its dialog or its toast: "Merged #4821", "Merged 3
 * layers", "Added #4821 to merge queue". For a chain, once it has moved the layers on it. Nothing
 * before then.
 */
export function doneLine(job: JobView): string | undefined {
  const { together } = job;
  if (together?.kind === 'chain') {
    return together.phase === 'done' ? `Merged #${job.number}` : undefined;
  }
  const what = together?.kind === 'stack' ? `${together.layers.length} layers` : `#${job.number}`;
  switch (job.state.kind) {
    case 'merged':
      return `Merged ${what}`;
    case 'enqueued':
      return `Added ${what} to merge queue`;
    case 'autoMergeOn':
      return `Turned on auto-merge for #${job.number}`;
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
 * What a merge that needs the reader says, as the title of what went wrong: it was refused, or its
 * end isn't confirmed. Nothing for one that doesn't.
 */
export function outcomeTitle(job: JobView): string | undefined {
  const { together } = job;
  if (together?.kind === 'chain' && together.phase === 'stopped') {
    if (job.state.kind === 'merged' || job.state.kind === 'enqueued') {
      return `Couldn’t move the layers above #${job.number}`;
    }
  }
  if (together?.kind === 'stack' && job.state.kind === 'refused' && job.kind === 'merge') {
    const { landed } = together;
    if (landed === null) return 'Merge not confirmed';
    return landed.length > 0
      ? `Merged ${numbers(landed)} only`
      : `Couldn’t merge ${together.layers.length} layers`;
  }
  const auto = job.kind === 'autoMerge' || job.kind === 'whenReady';
  switch (job.state.kind) {
    case 'refused':
      if (auto) return 'Couldn’t turn on auto-merge';
      if (job.kind === 'autoMergeOff') return 'Couldn’t turn off auto-merge';
      return job.kind === 'enqueue'
        ? `Couldn’t add #${job.number} to the merge queue`
        : `Couldn’t merge #${job.number}`;
    case 'unknown':
      return auto || job.kind === 'autoMergeOff'
        ? 'Auto-merge not confirmed'
        : 'Merge not confirmed';
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

/** The reason under {@link outcomeTitle}, in the core's words, and what GitHub showed since. */
export function outcomeDetail(job: JobView): string {
  const said: string[] = [];
  if (job.state.kind === 'refused') said.push(job.state.refusal.text);
  if (job.state.kind === 'unknown') {
    said.push(job.state.text);
    if (job.state.shows === 'open') said.push(`#${job.number} is still open.`);
  }
  const { together } = job;
  if (together?.kind === 'chain' && together.text !== null && together.phase === 'stopped') {
    if (!said.includes(together.text)) said.push(together.text);
  }
  return said.filter((part) => part !== '').join(' ');
}

/** The reason a merge still at work says when Lo's last question about it got no answer. */
export function troubleLine(): string {
  return 'GitHub didn’t respond.';
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
