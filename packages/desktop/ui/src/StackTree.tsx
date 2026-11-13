import { cva } from 'class-variance-authority';
import {
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { Avatar } from './Avatar.tsx';
import { StateIcon, type PullRequestState } from './StatePill.tsx';
import { Tag } from './Tag.tsx';

/** What a layer's reviews say. */
export type StackReview = 'approved' | 'changes' | 'required';

/** Where a layer's checks stand: all passing, some running, or one failing. */
export type StackChecks = 'passing' | 'running' | 'failing';

/**
 * Whether a layer has an overview: for the newest push, for an older one, one that can't be shown,
 * or none. A layer that can't have one, such as a layer from a fork, has no value at all.
 */
export type StackOverview = 'current' | 'stale' | 'error' | 'none';

/**
 * A layer's place in a run chosen to view as one diff: the run's first layer, one between, its last,
 * or the only one.
 */
export type StackRun = 'start' | 'middle' | 'end' | 'only';

/**
 * How Lo found a layer to sit on the one below, which the head says: as the next layer up in a
 * GitHub stack, by base branch, or by shared commits.
 */
export type StackTreeLink = 'github' | 'base' | 'commits';

/** One layer of the stack: a pull request, as its row shows it. */
export interface StackTreeLayer {
  /** What identifies the row, such as the layer's view. */
  key: string;
  number: number;
  title: string;
  state: PullRequestState;
  /** Who opened it, by login. A deleted account has none. */
  author?: string | undefined;
  /** Shown for an open layer; any other says its state in its place ("Draft", "Merged"). */
  review?: StackReview | undefined;
  checks?: StackChecks | undefined;
  /** Its place in the merge queue, counting from 1. */
  queue?: number | undefined;
  /** A layer whose lower layer was squash-merged. */
  needsRebase?: boolean | undefined;
  overview?: StackOverview | undefined;
  /**
   * How many of its files are viewed, of how many. `partial` when GitHub said only of the first
   * ones, so there may be more.
   */
  viewed?: { viewed: number; total: number; partial?: boolean | undefined } | undefined;
  /** How long ago it merged or closed, as the row says it: "40 min ago". */
  when?: string | undefined;
  /**
   * On a branch's own rail, one step in: a later child of a branching layer, and the layers that
   * sit on it.
   */
  branch?: boolean | undefined;
  /**
   * The layer it sits on, when that isn't the row above. It starts a branch: its rail bends off the
   * trunk, and its meta says "on #4819".
   */
  sitsOn?: number | undefined;
  /** In the run being chosen, and where. While one is, the layers outside it step back. */
  run?: StackRun | undefined;
}

/** A note under the rows: what Lo looked at, and why the tree may be missing layers. */
export interface StackTreeNote {
  key: string;
  /** Plain text and `<strong>`, as React draws them. */
  text: ReactNode;
}

export interface StackTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The layers in the order `]s` walks them: the bottom first, each branch finished in turn. */
  layers: readonly StackTreeLayer[];
  /** The branch the bottom layer sits on. */
  root: string;
  /**
   * Every layer is in one GitHub stack, which the head says in place of how Lo found them to sit on
   * each other.
   */
  githubStack?: boolean | undefined;
  /**
   * How Lo found the layers to sit on each other, each kind of link once. Nothing for a layer alone,
   * which none sits on.
   */
  found?: readonly StackTreeLink[] | undefined;
  /** The layer the keyboard is on, by key. */
  focused?: string | undefined;
  /** The layer on screen, by key. */
  current?: string | undefined;
  /**
   * A run is being chosen: the head says so, as Vim names its line-wise selection, in place of how
   * many layers there are.
   */
  choosing?: boolean | undefined;
  /** A layer was clicked, by key. */
  onShow?: ((key: string) => void) | undefined;
  /** A right-click on a layer. */
  onMenu?: ((key: string, event: MouseEvent<HTMLElement>) => void) | undefined;
  /** What goes between the head and the rows, such as the offer to make the chain a GitHub stack. */
  callout?: ReactNode;
  /** Under the rows. */
  notes?: readonly StackTreeNote[] | undefined;
  /** The scrolling element, which is the tree and takes focus. */
  treeRef?: Ref<HTMLDivElement> | undefined;
}

/** The longest a branch's name shows before its middle gives way to an ellipsis. */
const BRANCH_SHOWN = 30;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * `text`, with its middle cut out for an ellipsis when it's longer than `length` characters, and no
 * character cut in two. The end is the part of a branch name that tells it from the others, so it
 * keeps more.
 */
function middleOut(text: string, length: number): string {
  const letters = Array.from(GRAPHEMES.segment(text), (each) => each.segment);
  if (letters.length <= length) return text;
  const start = Math.ceil((length - 1) / 3);
  return `${letters.slice(0, start).join('')}…${letters.slice(letters.length - (length - 1 - start)).join('')}`;
}

const ORDINALS = new Intl.PluralRules('en', { type: 'ordinal' });
const SUFFIXES: Record<Intl.LDMLPluralRule, string> = {
  zero: 'th',
  one: 'st',
  two: 'nd',
  few: 'rd',
  many: 'th',
  other: 'th',
};

/** 1st, 2nd, 3rd, 4th. */
function ordinal(position: number): string {
  return `${position}${SUFFIXES[ORDINALS.select(position)]}`;
}

/** Each kind of link, as the head names it. */
const LINK_WORDS: Readonly<Record<StackTreeLink, string>> = {
  github: 'GitHub stack',
  base: 'base branch',
  commits: 'shared commits',
};

/** The kinds of link, in the order the head names them. */
const LINK_ORDER: readonly StackTreeLink[] = ['github', 'base', 'commits'];

/**
 * "GitHub stack · 4 layers" when every layer is in one GitHub stack, else each kind of link, in
 * order: "4 layers · by GitHub stack and base branch".
 */
function headText(
  count: number,
  githubStack: boolean,
  found: readonly StackTreeLink[] | undefined,
): string {
  const layers = `${count} ${count === 1 ? 'layer' : 'layers'}`;
  if (githubStack) return `GitHub stack · ${layers}`;
  const words = LINK_ORDER.filter((link) => found?.includes(link)).map((link) => LINK_WORDS[link]);
  const last = words.pop();
  if (last === undefined) return layers;
  return `${layers} · by ${words.length === 0 ? last : `${words.join(', ')} and ${last}`}`;
}

/** Whether a layer is on a branch's own rail: one that starts a branch, or sits above one. */
function onBranch(layer: StackTreeLayer): boolean {
  return layer.branch === true || layer.sitsOn !== undefined;
}

const row = cva('stack-layer', {
  variants: {
    branch: { true: 'stack-branch', false: '' },
    sprout: { true: 'stack-sprout', false: '' },
    // The trunk the later children branch off, running down past the branch's rows to the last.
    trunk: { true: 'stack-trunk', false: '' },
    // A run shares one band, rounded at its ends. The layer on screen, outside a run, has the
    // ground of what's on screen; any other layer takes the pointer's.
    ground: {
      start: 'rounded-t-sm bg-accent-soft',
      middle: 'bg-accent-soft',
      end: 'rounded-b-sm bg-accent-soft',
      only: 'rounded-sm bg-accent-soft',
      current: 'rounded-sm bg-on-screen',
      rest: 'rounded-sm hover:bg-hover',
    },
    // Only while the tree itself has keyboard focus: a click gives it focus too, with no ring.
    focused: { true: 'group-focus-visible/tree:shadow-ring-inset', false: '' },
  },
});

const rail = cva('stack-rail', {
  variants: {
    sprout: { true: 'stack-rail-sprout', false: '' },
    last: { true: 'stack-rail-last', false: '' },
    ball: {
      rest: '',
      current: 'stack-ball-current',
      run: 'stack-ball-run',
      merged: 'stack-ball-merged',
      closed: 'stack-ball-closed',
    },
  },
});

const title = cva('truncate', {
  variants: {
    weight: { regular: 'text-ui', medium: 'text-ui-medium', strong: 'text-ui-strong' },
    tone: { normal: 'text-fg', muted: 'text-fg-muted' },
  },
});

/** What each review says, in a word and the color GitHub gives it. */
const REVIEWS: Record<StackReview, { word: string; tone: string }> = {
  approved: { word: 'Approved', tone: 'text-review-approved' },
  changes: { word: 'Changes requested', tone: 'text-review-changes' },
  required: { word: 'Review required', tone: 'text-review-required' },
};

const CHECKS: Record<StackChecks, { words: string; tone: string; icon: ReactNode }> = {
  passing: {
    words: 'Checks passing',
    tone: 'text-check-pass',
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.5 8.25 7.25 10l3.25-3.75" />
      </>
    ),
  },
  running: {
    words: 'Checks running',
    tone: 'text-check-running',
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.75V8l2 1.5" />
      </>
    ),
  },
  failing: {
    words: 'Checks failing',
    tone: 'text-check-fail',
    icon: (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
      </>
    ),
  },
};

const OVERVIEWS: Record<StackOverview, { words: string; className: string }> = {
  current: { words: 'Overview', className: 'lo-ovmark' },
  stale: { words: 'Overview, out of date', className: 'lo-ovmark lo-ovmark--stale' },
  error: { words: "Overview, can't be shown", className: 'lo-ovmark lo-ovmark--error' },
  none: { words: 'No overview yet', className: 'lo-ovmark lo-ovmark--none' },
};

/** A small icon on the 16 grid. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

/** One thing in a layer's meta, which wraps as a whole and never runs wider than the row. */
function Item({
  tone = 'text-fg-muted',
  title: hint,
  children,
}: {
  tone?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full min-w-0 items-center gap-4 whitespace-nowrap ${tone}`}
      title={hint}
    >
      {children}
    </span>
  );
}

/** What a layer's state says in place of a review: a finished layer's, or a draft's. */
const FINISHED: Partial<Record<PullRequestState, { word: string; tone: string }>> = {
  draft: { word: 'Draft', tone: 'text-fg-muted' },
  merged: { word: 'Merged', tone: 'text-state-merged' },
  closed: { word: 'Closed', tone: 'text-state-closed' },
};

function Meta({ layer }: { layer: StackTreeLayer }) {
  const { state, review, checks, viewed, overview, queue } = layer;
  const said = FINISHED[state];
  const reviewed = state === 'open' && review !== undefined ? REVIEWS[review] : undefined;
  const checked = checks === undefined ? undefined : CHECKS[checks];
  const mark = overview === undefined ? undefined : OVERVIEWS[overview];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-8 gap-y-2 text-fg-muted text-micro">
      <span className="lo-num">#{layer.number}</span>
      {layer.author !== undefined && (
        <Item>
          <Avatar login={layer.author} size="sm" />
          <span className="min-w-0 truncate">{layer.author}</span>
        </Item>
      )}
      {said !== undefined && (
        <Item tone={said.tone}>
          <Icon>
            <StateIcon state={state} />
          </Icon>
          {said.word}
          {state !== 'draft' && layer.when !== undefined && ` ${layer.when}`}
        </Item>
      )}
      {reviewed !== undefined && <Item tone={reviewed.tone}>{reviewed.word}</Item>}
      {checked !== undefined && (
        <span
          className={`inline-flex ${checked.tone}`}
          role="img"
          aria-label={checked.words}
          title={checked.words}
          data-checks={checks}
        >
          <Icon>{checked.icon}</Icon>
        </span>
      )}
      {queue !== undefined && (
        <Item tone="text-queue">
          <span className="size-6 flex-none rounded-pill bg-queue" aria-hidden="true" />
          Queued, {ordinal(queue)}
        </Item>
      )}
      {mark !== undefined && (
        <span
          className={mark.className}
          role="img"
          aria-label={mark.words}
          title={mark.words}
          data-overview={overview}
        />
      )}
      {viewed !== undefined && (
        <Item
          title={`${viewed.partial === true ? 'At least ' : ''}${viewed.viewed} of ${viewed.total} files viewed`}
        >
          <Icon>
            <circle cx="8" cy="8" r="5.75" />
            <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
          </Icon>
          <span className="sr-only">Viewed </span>
          <span className="lo-num">
            {viewed.viewed}
            {viewed.partial === true ? '+' : ''}/{viewed.total}
          </span>
        </Item>
      )}
      {layer.needsRebase === true && <Tag tone="warning">Needs rebase</Tag>}
      {layer.sitsOn !== undefined && <span className="lo-num">on #{layer.sitsOn}</span>}
    </div>
  );
}

/**
 * Brings the row with `key` into view in `tree`, scrolling no more than it takes. The first layer
 * brings the root above it too, so walking up to the top shows what the stack sits on.
 */
function reveal(tree: HTMLElement | null, key: string | undefined): void {
  if (tree === null || key === undefined) return;
  const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
  const found = items.find((each) => each.dataset['key'] === key);
  if (found === undefined) return;
  const top = found === items[0] ? 0 : found.offsetTop;
  const bottom = top + found.offsetHeight;
  if (top < tree.scrollTop) tree.scrollTop = top;
  else if (bottom > tree.scrollTop + tree.clientHeight) tree.scrollTop = bottom - tree.clientHeight;
}

/**
 * The stack, top of the left panel: a head that says how many layers and how Lo found them, any
 * offer under it, then a tree with the base branch as its root and a rail with a ball for each
 * layer. It's one focusable element with `role="tree"`: the layer the keyboard is on is its active
 * descendant, and the layer on screen is marked `aria-current` and a Powder ball, which is not the
 * same thing. A run of layers chosen to view as one diff, or on screen as one, shares a band, and
 * the rest step back; while it's being chosen, the head says `V-LINE`.
 *
 * It draws what it's given, as text, and asks for nothing: a click shows a layer, and a right-click
 * asks for its menu. The keys, and what a pull request's text is cleaned of, belong to the caller.
 */
export function StackTree({
  layers,
  root,
  githubStack = false,
  found,
  focused,
  current,
  choosing = false,
  onShow,
  onMenu,
  callout,
  notes = [],
  treeRef,
  className = '',
  ...rest
}: StackTreeProps) {
  const prefix = useId();
  const scroller = useRef<HTMLDivElement | null>(null);
  const banded = layers.some((each) => each.run !== undefined);
  const focusedIndex =
    focused === undefined ? -1 : layers.findIndex((each) => each.key === focused);
  // Whether a later layer starts a branch, for each layer: the trunk runs on down to its elbow.
  const branchesBelow: boolean[] = [];
  for (let index = layers.length - 1, below = false; index >= 0; index--) {
    branchesBelow[index] = below;
    if (layers[index]?.sitsOn !== undefined) below = true;
  }

  // The layer the keyboard moved to, and the one on screen when it changes, come into view.
  useEffect(() => reveal(scroller.current, focused), [focused]);
  useEffect(() => reveal(scroller.current, current), [current]);

  const setRefs = (element: HTMLDivElement | null) => {
    scroller.current = element;
    if (typeof treeRef === 'function') treeRef(element);
    else if (treeRef) treeRef.current = element;
  };

  return (
    <section aria-label="Stack" className="flex min-h-0 flex-col bg-bg-chrome">
      <span id={`${prefix}-root`} className="sr-only">
        Base branch {root}
      </span>
      <div className="flex flex-none items-center gap-6 ps-16 pe-8 pt-12 pb-8">
        <h2 className="label-caps text-fg-muted text-label">Stack</h2>
        <span className="ms-auto text-end text-fg-muted text-small">
          {choosing ? (
            <span className="mode-chip">V-LINE</span>
          ) : (
            <span className="lo-num">{headText(layers.length, githubStack, found)}</span>
          )}
        </span>
      </div>
      {callout !== undefined && callout !== null && (
        <div className="mx-8 mb-8 flex-none">{callout}</div>
      )}
      <div
        ref={setRefs}
        role="tree"
        tabIndex={0}
        aria-label="Layers"
        aria-describedby={`${prefix}-root`}
        aria-multiselectable={banded ? true : undefined}
        aria-activedescendant={
          focusedIndex < 0 ? undefined : `${prefix}-${layers[focusedIndex]?.key ?? ''}`
        }
        className={`group/tree relative min-h-0 overflow-auto px-6 pb-6 outline-none ${className}`}
        {...rest}
      >
        <div role="presentation" className="flex h-row-h items-center gap-8 px-8">
          <span className="flex w-16 flex-none justify-center text-fg-muted">
            <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="4.5" cy="3.75" r="1.5" />
              <circle cx="4.5" cy="12.25" r="1.5" />
              <circle cx="11.5" cy="5" r="1.5" />
              <path d="M4.5 5.25v5.5M11.5 6.5c0 2.75-4 2.5-6.6 4.4" />
            </svg>
          </span>
          <span
            aria-hidden="true"
            className="min-w-0 truncate text-fg-muted code-small"
            title={root}
          >
            {middleOut(root, BRANCH_SHOWN)}
          </span>
        </div>
        {layers.map((layer, index) => {
          const sprouts = layer.sitsOn !== undefined;
          const branch = onBranch(layer);
          const next = layers[index + 1];
          // A branch's rail ends at its last layer's ball; the trunk's goes on to whatever's below.
          const last =
            next === undefined || (branch && (next.sitsOn !== undefined || !onBranch(next)));
          const finished = layer.state === 'merged' || layer.state === 'closed';
          const onScreen = layer.key === current;
          const outside = banded && layer.run === undefined;
          return (
            <div
              key={layer.key}
              id={`${prefix}-${layer.key}`}
              role="treeitem"
              aria-level={branch ? 2 : 1}
              aria-current={onScreen ? 'true' : undefined}
              aria-selected={banded ? layer.run !== undefined : undefined}
              data-key={layer.key}
              data-state={layer.state}
              data-run={layer.run}
              data-dim={outside ? '' : undefined}
              data-focused={layer.key === focused ? '' : undefined}
              className={row({
                branch,
                sprout: sprouts,
                trunk: branch && branchesBelow[index] === true,
                ground: layer.run ?? (onScreen ? 'current' : 'rest'),
                focused: layer.key === focused,
              })}
              onClick={() => onShow?.(layer.key)}
              onContextMenu={(event) => onMenu?.(layer.key, event)}
            >
              <span
                aria-hidden="true"
                className={rail({
                  sprout: sprouts,
                  last,
                  ball:
                    layer.state === 'merged'
                      ? 'merged'
                      : layer.state === 'closed'
                        ? 'closed'
                        : layer.run !== undefined
                          ? 'run'
                          : onScreen
                            ? 'current'
                            : 'rest',
                })}
              />
              <div className="min-w-0">
                <div
                  className={title({
                    weight: onScreen ? 'strong' : outside ? 'regular' : 'medium',
                    tone: outside || finished ? 'muted' : 'normal',
                  })}
                  title={layer.title}
                >
                  {layer.title}
                </div>
                <Meta layer={layer} />
              </div>
            </div>
          );
        })}
      </div>
      {notes.map((note) => (
        <div
          key={note.key}
          role="note"
          className="mx-8 mb-8 flex-none rounded-sm bg-hover px-8 py-8 stack-note text-fg-muted text-small"
        >
          {note.text}
        </div>
      ))}
    </section>
  );
}
