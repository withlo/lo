import { cva } from 'class-variance-authority';

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

/** A pull request's state as its icon, its word and GitHub's color for it, always all three. */
export function StatePill({ state }: { state: PullRequestState }) {
  return (
    <span className={pill({ state })}>
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <StateIcon state={state} />
      </svg>
      {WORDS[state]}
    </span>
  );
}

function StateIcon({ state }: { state: PullRequestState }) {
  switch (state) {
    case 'open':
      return (
        <>
          <circle cx="4.5" cy="3.75" r="1.5" />
          <circle cx="4.5" cy="12.25" r="1.5" />
          <circle cx="11.5" cy="12.25" r="1.5" />
          <path d="M4.5 5.25v5.5M11.5 10.75V6.5c0-1.1-.9-2-2-2H7.5M9 3 7.5 4.5 9 6" />
        </>
      );
    case 'draft':
      return (
        <>
          <circle cx="4.5" cy="3.75" r="1.5" />
          <circle cx="4.5" cy="12.25" r="1.5" />
          <circle cx="11.5" cy="12.25" r="1.5" />
          <path d="M4.5 5.25v5.5M11.5 3.5v.01M11.5 6.75v.01M11.5 9.5v.01" />
        </>
      );
    case 'merged':
      return (
        <>
          <circle cx="4.5" cy="3.75" r="1.5" />
          <circle cx="4.5" cy="12.25" r="1.5" />
          <circle cx="11.5" cy="8.75" r="1.5" />
          <path d="M4.5 5.25v5.5M4.5 5.25c0 2 1.5 3.5 3.5 3.5h2" />
        </>
      );
    case 'closed':
      return (
        <>
          <circle cx="4.5" cy="3.75" r="1.5" />
          <circle cx="4.5" cy="12.25" r="1.5" />
          <circle cx="11.5" cy="12.25" r="1.5" />
          <path d="M4.5 5.25v5.5M11.5 10.75V8.25M10 3l3 3M13 3l-3 3" />
        </>
      );
    default:
      state satisfies never;
      throw new Error(`A pull request state Lo doesn't know: ${String(state)}.`);
  }
}
