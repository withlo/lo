import { cva } from 'class-variance-authority';

import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';

/** A pull request's state, as GitHub has it. */
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';

const pill = cva(
  'inline-flex h-control-h-sm flex-none items-center gap-4 rounded-pill ps-6 pe-8 font-semibold whitespace-nowrap text-small',
  {
    variants: {
      state: {
        open: 'state-open',
        draft: 'state-draft',
        merged: 'state-merged',
        closed: 'state-closed',
      },
    },
  },
);

const WORDS: Record<PullRequestState, string> = {
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

/** Each state's icon, as GitHub draws it. */
export const STATE_ICONS: Readonly<Record<PullRequestState, IconName>> = {
  open: 'git-pull-request',
  draft: 'git-pull-request-draft',
  merged: 'git-merge',
  closed: 'git-pull-request-closed',
};

/** A pull request's state as its icon, its word and GitHub's color for it, always all three. */
export function StatePill({ state }: { state: PullRequestState }) {
  return (
    <span className={pill({ state })}>
      <Icon name={STATE_ICONS[state]} size={12} />
      {WORDS[state]}
    </span>
  );
}
