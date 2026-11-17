// A view's merge status from what GitHub said of its pull request: `@lo/review`'s merge rules
// decide, and this maps their answer into what the window words. Text and pages from GitHub go
// out as text, cut to what the contract takes, and a page that isn't `https://` goes out as none,
// so the window never offers to open it. Nothing here calls Electron or GitHub.

import { rulesBase, type MergeFacts } from '@lo/github';
import {
  blockers,
  incomplete,
  latestReviews,
  mayNotSeeEveryRule,
  mergeAction,
  mergeSnapshot,
  mergeStatus,
  pickedMethod,
  type Blocker as ReviewBlocker,
  type Local,
  type RequiredCheck,
  type Reviewer as ReviewReviewer,
  type UncheckedRule,
} from '@lo/review';

import type { Blocker, Check, MergeState, Off, Reviewer, Unchecked } from '../contract.ts';

/** The longest text the contract takes from GitHub. */
const TEXT_LIMIT = 1024;

/** The longest page the contract takes. */
const PAGE_LIMIT = 4096;

/** `value` cut to what the contract takes. */
function text(value: string): string {
  return value.slice(0, TEXT_LIMIT);
}

/** `value` when it's an `https://` page the contract takes, else nothing. */
export function pageOf(value: string | undefined): string | null {
  if (value === undefined || value.length > PAGE_LIMIT) return null;
  const parsed = URL.parse(value);
  return parsed?.protocol === 'https:' && parsed.hostname !== '' ? value : null;
}

/** A full commit ID, as the contract takes it, or empty. */
function commitOf(value: string): string {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value : '';
}

function checkOf(found: RequiredCheck): Check {
  return { name: text(found.name), state: found.state, url: pageOf(found.url) };
}

function reviewerOf(found: ReviewReviewer): Reviewer {
  return found.kind === 'user'
    ? { kind: 'user', login: text(found.login) }
    : { kind: 'team', slug: text(found.slug) };
}

function blockerOf(found: ReviewBlocker, threadsCutShort: boolean, url: string): Blocker {
  switch (found.kind) {
    case 'merged':
    case 'closed':
    case 'draft':
    case 'conflicts':
    case 'outOfDate':
    case 'checkingMergeability':
      return { kind: found.kind };
    case 'changesRequested':
      return { kind: 'changesRequested', by: found.by.map(text) };
    case 'approvals':
      return { kind: 'approvals', more: found.more, codeOwners: found.codeOwners.map(reviewerOf) };
    case 'check':
    case 'notReported':
      return { kind: found.kind, check: checkOf(found.check) };
    case 'conversations':
      return { kind: 'conversations', unresolved: found.unresolved, cutShort: threadsCutShort };
    case 'rule':
      return {
        kind: 'rule',
        description: text(found.rule.description),
        url: pageOf(found.rule.url),
        waiting: found.rule.waiting,
      };
    case 'unexplained':
      return { kind: 'unexplained', url: pageOf(found.url) ?? url };
    default:
      found satisfies never;
      throw new Error(`A blocker Lo doesn't know: ${JSON.stringify(found)}`);
  }
}

function uncheckedOf(rule: UncheckedRule): Unchecked {
  return rule.kind === 'other' ? { kind: 'other', type: text(rule.type) } : { kind: rule.kind };
}

/** The pull request's page, which a block Lo can't explain links to: GitHub's, or its address. */
function pullPage(facts: MergeFacts, owner: string, repo: string, number: number): string {
  return (
    pageOf(facts.pullRequest.url) ??
    `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}`
  );
}

/** What a view's status is made from. */
export interface StatusInput {
  /** What GitHub said, as the account's poller read it. */
  readonly facts: MergeFacts;
  /** What GitHub doesn't say: the head on screen, the method remembered, the local copy's answer. */
  readonly local: Local;
  /** When GitHub last confirmed it, in milliseconds since the Unix epoch. */
  readonly readAt: number;
  /** Why Lo couldn't read it again since, while it can't. */
  readonly stale?: string | undefined;
  /** Why Lo merges nothing now, whatever GitHub says, if it doesn't. */
  readonly off?: Off | null | undefined;
  /** The pull request, for its page when GitHub's answer didn't give one. */
  readonly pull: { readonly owner: string; readonly repo: string; readonly number: number };
}

/** Where the pull request's merge stands, for the window to word. */
export function stateOf({ facts, local, readAt, stale, off, pull }: StatusInput): MergeState {
  const snapshot = mergeSnapshot(facts, local);
  const status = mergeStatus(snapshot);
  const url = pullPage(facts, pull.owner, pull.repo, pull.number);
  const found = blockers(snapshot).map((each) => blockerOf(each, snapshot.threadsCutShort, url));
  const action = mergeAction(snapshot);
  const { queue } = snapshot;
  const auto = snapshot.autoMerge;
  const checks = snapshot.requiredChecks;
  return {
    verdict: status.kind,
    position: status.kind === 'queued' ? (status.position ?? null) : null,
    blockers: status.kind === 'ready' ? [] : found,
    autoMerge: auto
      ? {
          // On a branch with a merge queue, GitHub reports a merge commit whatever was asked: the
          // queue's own method merges it, which only those who may read its settings see.
          method: queue.required ? (queue.method ?? null) : auto.method,
          by: auto.enabledBy === undefined ? null : text(auto.enabledBy),
        }
      : null,
    partial: mayNotSeeEveryRule(snapshot),
    incomplete: incomplete(snapshot) ?? null,
    action:
      action.kind === 'merge'
        ? { kind: 'merge', methods: [...action.methods], method: action.method }
        : action.kind === 'enqueue'
          ? { kind: 'enqueue', method: action.method ?? null }
          : { kind: 'notPossible', reason: action.reason.kind },
    picked: pickedMethod(snapshot) ?? null,
    methods: { ...snapshot.methods },
    signedCommits: snapshot.signedCommits,
    unchecked: snapshot.uncheckedRules.map(uncheckedOf),
    base: text(rulesBase(facts)),
    queue: { required: queue.required, method: queue.method ?? null },
    approvedBy: latestReviews(snapshot)
      .filter((review) => review.counts && review.state === 'APPROVED')
      .map((review) => text(review.author)),
    checks: {
      passed: checks.filter((each) => each.state === 'passed').length,
      total: checks.length,
    },
    url,
    head: commitOf(facts.pullRequest.head),
    readAt: Math.max(0, Math.round(readAt)),
    stale: stale === undefined ? null : text(stale),
    off: off ?? null,
  };
}

/** Every page `state` links: its checks' runs, its rules' pages, and the pull request's. */
export function pagesOf(state: MergeState): Set<string> {
  const pages = new Set<string>([state.url]);
  for (const each of state.blockers) {
    switch (each.kind) {
      case 'check':
      case 'notReported':
        if (each.check.url !== null) pages.add(each.check.url);
        break;
      case 'rule':
        if (each.url !== null) pages.add(each.url);
        break;
      case 'unexplained':
        pages.add(each.url);
        break;
      case 'merged':
      case 'closed':
      case 'draft':
      case 'conflicts':
      case 'outOfDate':
      case 'changesRequested':
      case 'approvals':
      case 'conversations':
      case 'checkingMergeability':
        break;
      default:
        each satisfies never;
    }
  }
  return pages;
}
