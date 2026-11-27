import { cva } from 'class-variance-authority';
import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { Branch } from './Branch.tsx';
import { besideIn, handOffFocus } from './focus.ts';
import { useGiveUp } from './giveUp.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Popover } from './Popover.tsx';
import { Skeleton } from './Spinner.tsx';
import { StatePill, type PullRequestState } from './StatePill.tsx';

/**
 * How what's shown stands with GitHub, when it isn't as usual, in a word or two: "Offline", "Rate
 * limit reached", or "Signed out", in danger. A click on it opens its details under it.
 */
export interface HeaderConnection {
  /**
   * What's wrong, which picks its icon: GitHub can't be reached (`offline`), the account is signed
   * out, the rate limit is reached, or a read failed.
   */
  kind: 'offline' | 'signedOut' | 'rateLimited' | 'failed';
  tone: 'warn' | 'danger';
  /** One or two words: "Offline", "GitHub error". */
  label: string;
  /**
   * What a click on the chip opens: the line that says why, when the tab last heard from GitHub,
   * and the one thing to do about it.
   */
  details?: ReactNode;
  /** Where the details are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

export interface PRHeaderProps {
  number: number;
  /** Its title and state, once known. Until then the header holds their places. */
  title?: string | undefined;
  /**
   * The pull request can't be shown, so what isn't known won't come: the header holds no places,
   * and names it by `repo` and its number, as text, where it has no title.
   */
  missing?: { repo: string } | undefined;
  state?: PullRequestState | undefined;
  /** The author's login: null for an account GitHub deleted, and nothing while it isn't known. */
  author?: string | null | undefined;
  /** The branch it merges from, with the fork it's in, if it's in one. */
  head?: { branch: string; fork?: string | null | undefined } | undefined;
  /** The branch it merges into. */
  base?: { branch: string } | undefined;
  /** The account Lo acts as, or nobody for a public repository read without signing in. */
  acting?: { login: string } | 'anonymous' | undefined;
  /** Shown only when the connection isn't as usual. */
  connection?: HeaderConnection | undefined;
  /**
   * Whether the pull request can merge: the merge status, a dot and one line. It goes on the first
   * row, between the connection chip and the account.
   */
  status?: ReactNode;
  /** What goes on the second row after the branches: what's on screen, its controls. */
  children?: ReactNode;
}

const chip = cva(
  'inline-flex h-row-h flex-none items-center gap-6 rounded-pill ps-8 pe-12 font-medium whitespace-nowrap text-small',
  {
    variants: {
      tone: { warn: 'chip-warn', danger: 'chip-danger' },
      button: { true: 'move-tint hover:text-fg focus-visible:shadow-ring', false: '' },
    },
    defaultVariants: { button: false },
  },
);

/**
 * The two rows above a pull request: its state, title and number, how the connection stands when
 * it isn't as usual, whether it can merge, and who Lo acts as; then who wants to merge which branch
 * into which, or merged it, or wanted to once it's closed, and what other features put after them.
 */
export function PRHeader({
  number,
  title,
  missing,
  state,
  author,
  head,
  base,
  acting,
  connection,
  status,
  children,
}: PRHeaderProps) {
  const top = useRef<HTMLDivElement>(null);
  useGiveUp(top, TOP_STEPS);
  const merges = useRef<HTMLSpanElement>(null);
  useGiveUp(merges, BRANCH_STEPS);
  return (
    <header className="pr-header h-header-h min-w-0 flex-none bg-bg-chrome ps-16 pe-12 pb-6">
      <div ref={top} className="give-up flex min-w-0 items-center gap-12">
        {state !== undefined ? (
          <StatePill state={state} />
        ) : (
          missing === undefined && <Skeleton className="w-48 flex-none" />
        )}
        {title !== undefined || missing !== undefined ? (
          // Whole until the key chips and the merge status's detail have gone (`cut`).
          <h1 data-cuts className="lo-selectable min-w-cut truncate text-fg text-title">
            {title ?? missing?.repo}
          </h1>
        ) : (
          <Skeleton className="w-tab-w max-w-full min-w-0" />
        )}
        <span className="lo-num flex-none pr-number text-fg-muted">#{number}</span>
        <span className="min-w-8 flex-1" />
        {connection !== undefined && <ConnectionChip connection={connection} />}
        {status}
        {acting !== undefined && (
          <span className="inline-flex h-control-h flex-none items-center gap-6 px-6 whitespace-nowrap text-fg text-small">
            {acting === 'anonymous' ? (
              <span className="text-fg-muted">Not signed in</span>
            ) : (
              <span>
                <span className="text-fg-muted">as</span> {acting.login}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-12">
        <span
          ref={merges}
          className="give-up flex min-w-0 items-center gap-6 whitespace-nowrap text-fg-muted text-small"
        >
          {head === undefined || base === undefined ? (
            missing === undefined && <Skeleton className="w-tab-w" />
          ) : (
            <>
              {author === undefined ? (
                // Its room, held until GitHub names the author, who is never assumed deleted.
                <Skeleton className="w-48 flex-none" />
              ) : (
                <strong className="font-semibold text-fg">
                  {author ?? 'Deleted account'}
                  {/* Merged, its branch is the subject: who merged it isn't always its author. */}
                  {state === 'merged' && <span data-gives="branches">’s</span>}
                </strong>
              )}
              {state !== 'merged' && <span data-gives="branches"> {mergeWords(state)}</span>}
              <BranchAtLeast name={head.fork ? `${head.fork}:${head.branch}` : head.branch} />
              {state === 'merged' ? (
                <span data-gives="branches" className="flex-none">
                  merged into
                </span>
              ) : (
                <span data-gives="branches" className="flex flex-none text-fg-subtle">
                  <Icon name="arrow-right" size={12} label="into" />
                </span>
              )}
              <BranchAtLeast name={base.branch} base />
            </>
          )}
        </span>
        {children}
      </div>
    </header>
  );
}

/**
 * What the author asks of the branches, as the pull request stands: "wants to merge", or "wanted
 * to merge" once it's closed. A merged one says its branch "merged into" the base instead, naming
 * no one, since Lo doesn't read who merged it.
 */
function mergeWords(state: Exclude<PullRequestState, 'merged'> | undefined): string {
  return state === 'closed' ? 'wanted to merge' : 'wants to merge';
}

/**
 * What the header's first row gives up as soon as its title would otherwise be cut, a step at a
 * time: the key chips, as on "Submit review…"; then the merge status's detail; then its title's end,
 * which is cut down to `min-w-cut` (`cut`); then the merge status's words, which leave its dot alone,
 * with the verdict and the reasons as its tooltip (`MergeStatus`). Nothing in it is ever drawn over
 * another.
 */
const TOP_STEPS = ['keys', 'detail', 'cut', 'title'] as const;

/**
 * What the header's second row gives up where its branches can't show a few letters each: "wants
 * to merge" and both branches, whole, so a branch is never cut to a letter. Its author stays.
 */
const BRANCH_STEPS = ['branches'] as const;

/** A branch in the header: cut short no further than a few letters, and given up whole after. */
function BranchAtLeast({ name, base = false }: { name: string; base?: boolean }) {
  return (
    <span data-gives="branches" className="flex min-w-cut shrink">
      <Branch name={name} base={base} />
    </span>
  );
}

/** The chip for how the tab stands with GitHub: a button that opens its details, if it has any. */
function ConnectionChip({ connection }: { connection: HeaderConnection }) {
  const [open, setOpen] = useState(false);
  // The chip as it's drawn now, for focus to come back to as its details end.
  const self = useRef<HTMLElement | null>(null);
  const face = (
    <>
      <Icon name={CONNECTION_ICONS[connection.kind]} size={12} />
      {connection.label}
    </>
  );
  if (connection.details === undefined) {
    return (
      <span ref={self} className={chip({ tone: connection.tone })}>
        {face}
      </span>
    );
  }
  return (
    <ChipDetails
      open={open}
      onOpenChange={setOpen}
      chip={self}
      trigger={
        <button
          type="button"
          ref={(element) => {
            self.current = element;
          }}
          className={chip({ tone: connection.tone, button: true })}
        >
          {face}
        </button>
      }
      connection={connection}
    />
  );
}

/**
 * The chip's details. Ended while they hold focus, as by a Try again that brings the tab back
 * online, which takes the chip too, focus goes to the chip as it's drawn now, else to the header's
 * next control, else its previous one, not to the page.
 */
function ChipDetails({
  open,
  onOpenChange,
  chip: self,
  trigger,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chip: RefObject<HTMLElement | null>;
  trigger: ReactElement<Record<string, unknown>>;
  connection: HeaderConnection;
}) {
  const popup = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(
    () => () => {
      const leaving = [self.current, popup.current];
      const stops = besideIn(self.current?.parentElement, leaving);
      handOffFocus(leaving, () => [self.current, ...stops]);
    },
    [self],
  );
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      align="end"
      label={connection.label}
      scope="dialog"
      popupRef={popup}
      container={connection.container}
      className="flex status-details flex-col gap-8 p-12"
    >
      {connection.details}
    </Popover>
  );
}

/**
 * The chip's icon for what's wrong: a struck cloud offline, a clock for the rate limit, a triangle
 * for a failure, and a ring with a mark when signed out.
 */
const CONNECTION_ICONS: Readonly<Record<HeaderConnection['kind'], IconName>> = {
  offline: 'cloud-off',
  signedOut: 'circle-exclamation-point',
  rateLimited: 'clock',
  failed: 'triangle-exclamation-point',
};
