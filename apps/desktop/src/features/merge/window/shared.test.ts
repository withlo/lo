// Asking to turn on auto-merge from outside the merge panel, as the merge queue's `a` does for a pull
// request that left the queue: it waits for the first read, plans it only when `a` in the panel
// would turn it on, and never turns it off.

import { describe, expect, it } from 'vitest';

import type { MergeState } from '../contract.ts';
import { autoMergeAsked } from './shared.ts';

/** A pull request into a branch with a merge queue, waiting on its checks, with `change`. */
function state(change: Partial<MergeState> = {}): MergeState {
  return {
    verdict: 'waiting',
    position: null,
    blockers: [],
    autoMerge: null,
    partial: false,
    incomplete: null,
    action: { kind: 'notPossible', reason: 'blocked' },
    auto: { kind: 'on' },
    override: { kind: 'notPossible', reason: 'noPermission' },
    afterPush: 'noReview',
    picked: null,
    methods: { merge: true, squash: true, rebase: true },
    signedCommits: false,
    unchecked: [],
    base: 'e4/queued',
    queue: { required: true, method: 'SQUASH' },
    approvedBy: [],
    checks: { passed: 0, total: 1 },
    url: 'https://github.com/rozed-dev/e2e/pull/261',
    head: 'a'.repeat(40),
    readAt: 1,
    stale: null,
    off: null,
    ...change,
  };
}

describe('asking to turn on auto-merge from outside the panel', () => {
  it('waits for the first read, then plans it as `a` in the panel would', () => {
    expect(autoMergeAsked(undefined, 261)).toBeUndefined();
    expect(autoMergeAsked({ kind: 'loading' }, 261)).toBeUndefined();
    expect(autoMergeAsked({ kind: 'known', state: state() }, 261)).toEqual({ kind: 'plan' });
  });

  it('never turns off auto-merge that’s on, and says why it can’t turn it on', () => {
    expect(autoMergeAsked({ kind: 'known', state: state({ auto: { kind: 'off' } }) }, 261)).toEqual(
      { kind: 'said', why: 'Auto-merge is already on', panel: true },
    );
    expect(
      autoMergeAsked(
        { kind: 'known', state: state({ auto: { kind: 'notPossible', reason: 'closed' } }) },
        261,
      ),
    ).toEqual({ kind: 'said', why: '#261 is closed', panel: true });
    expect(autoMergeAsked({ kind: 'none', why: 'Sign in to merge' }, 261)).toEqual({
      kind: 'said',
      why: 'Sign in to merge',
      panel: false,
    });
  });
});
