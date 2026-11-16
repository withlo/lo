// What GitHub says of a pull request's merge, for the merge feature's tests: #138 in rozed-dev/e2e,
// open and mergeable into `main`, read as rozed-bot, an admin, in a repository that allows every
// method, with whatever a test changes.

import { noBranchRules, type MergeFacts } from '@lo/github';

export const HEAD = 'a'.repeat(40);
export const BASE_TIP = 'b'.repeat(40);

/** The pull request's fields a test can change. */
type PullFields = Partial<MergeFacts['pullRequest']>;

export function factsOf(pull: PullFields = {}, rest: Partial<MergeFacts> = {}): MergeFacts {
  return {
    login: 'rozed-bot',
    repository: {
      archived: false,
      viewerPermission: 'ADMIN',
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: true,
      viewerDefaultMergeMethod: 'MERGE',
      squashTitle: 'PR_TITLE',
      squashMessage: 'COMMIT_MESSAGES',
    },
    pullRequest: {
      url: 'https://github.com/rozed-dev/e2e/pull/138',
      state: 'OPEN',
      draft: false,
      locked: false,
      mergeable: 'MERGEABLE',
      mergeState: 'CLEAN',
      reviewDecision: undefined,
      head: HEAD,
      base: 'main',
      baseTip: BASE_TIP,
      author: 'rozed-bot',
      viewerDidAuthor: true,
      viewerCanMergeAsAdmin: false,
      viewerCanEnableAutoMerge: true,
      viewerCanDisableAutoMerge: false,
      queueRequired: false,
      inQueue: false,
      queuePosition: undefined,
      queueMethod: undefined,
      autoMerge: undefined,
      reviews: [],
      reviewRequests: [],
      viewerTeams: [],
      pendingReview: undefined,
      unresolvedThreads: 0,
      checks: [],
      checksPending: false,
      queuedApps: [],
      ...pull,
    },
    stack: undefined,
    protection: undefined,
    rules: noBranchRules('main'),
    cutShort: [],
    leftOut: [],
    ...rest,
  };
}
