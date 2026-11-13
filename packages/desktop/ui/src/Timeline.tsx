import { cva } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';

import { Avatar } from './Avatar.tsx';
import { Button } from './Button.tsx';
import { Label } from './Label.tsx';
import { StateIcon } from './StatePill.tsx';
import { Tag } from './Tag.tsx';
import { CommentIcon } from './ThreadCount.tsx';

/** What a one-line event or a row's marker draws, on the 16 grid. */
export type TimelineGlyph =
  | 'comment'
  | 'changes'
  | 'check'
  | 'x'
  | 'ring'
  | 'eye'
  | 'person'
  | 'tag'
  | 'commits'
  | 'force'
  | 'link'
  | 'deploy'
  | 'queue'
  | 'merged'
  | 'closed'
  | 'reopened'
  | 'draft'
  | 'branch'
  | 'dismissed'
  | 'auto'
  | 'stack';

/** The color of a marker's disc: GitHub's own meanings, or none. */
export type TimelineTone = 'neutral' | 'ok' | 'fail' | 'warn' | 'merged';

/** Where a row's marker is: a glyph in a disc, or a person's avatar. */
export type TimelineMarker =
  | { glyph: TimelineGlyph; tone?: TimelineTone | undefined }
  | { login: string; image?: string | undefined };

const GLYPHS: Readonly<Record<TimelineGlyph, ReactNode>> = {
  comment: (
    <path d="M2.75 3.25c0-.55.45-1 1-1h8.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H7.5L4.75 13v-2.25h-1c-.55 0-1-.45-1-1Z" />
  ),
  changes: (
    <>
      <path d="M2.75 3.25c0-.55.45-1 1-1h8.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H7.5L4.75 13v-2.25h-1c-.55 0-1-.45-1-1Z" />
      <path d="M6 5l4 3.5M10 5 6 8.5" />
    </>
  ),
  check: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  // A ring, for something still running.
  ring: <circle cx="8" cy="8" r="3.25" />,
  eye: (
    <>
      <path d="M2 8s2.25-4.25 6-4.25S14 8 14 8s-2.25 4.25-6 4.25S2 8 2 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.25c0-2.4 2.25-4 5-4s5 1.6 5 4" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 2.5h5.25l6 6-5.25 5.25-6-6Z" />
      <path d="M5.25 5.25h.01" />
    </>
  ),
  commits: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h4M10.5 8h4" />
    </>
  ),
  force: <path d="M5 2.5v11M2.5 5 5 2.5 7.5 5M11 13.5v-11M8.5 11l2.5 2.5 2.5-2.5" />,
  link: (
    <path d="M6.5 9.5l3-3M7 4.5l1-1a2.47 2.47 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.47 2.47 0 0 1 4.5 9l1-1" />
  ),
  deploy: <path d="M8 13.5v-9M4.5 8 8 4.5 11.5 8M3 2.5h10" />,
  queue: <path d="M3 4h10M3 8h10M3 12h6" />,
  merged: <StateIcon state="merged" />,
  closed: <StateIcon state="closed" />,
  reopened: <StateIcon state="open" />,
  draft: <StateIcon state="draft" />,
  branch: (
    <>
      <circle cx="4.5" cy="3.75" r="1.5" />
      <circle cx="4.5" cy="12.25" r="1.5" />
      <circle cx="11.5" cy="5.75" r="1.5" />
      <path d="M4.5 5.25v5.5M11.5 7.25c0 2-1.5 3-4 3.25" />
    </>
  ),
  dismissed: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M3.75 12.25 12.25 3.75" />
    </>
  ),
  auto: <path d="M9 2 4 9h3.5L7 14l5-7H8.5Z" />,
  stack: <path d="M8 2.5 14 5.5 8 8.5 2 5.5ZM2 8.5l6 3 6-3M2 11.25l6 3 6-3" />,
};

const disc = cva('relative grid size-32 flex-none place-items-center rounded-pill inset-ring-2', {
  variants: {
    tone: {
      neutral: 'bg-bg text-icon-muted inset-ring-border',
      ok: 'bg-success-bg text-success inset-ring-success-border',
      fail: 'bg-danger-bg text-danger inset-ring-danger-border',
      warn: 'bg-warning-bg text-warning inset-ring-warning-border',
      merged: 'bg-state-merged-bg text-state-merged inset-ring-state-merged-border',
    },
  },
});

function Marker({ marker }: { marker: TimelineMarker }) {
  if ('login' in marker) {
    return (
      <span className="relative flex-none">
        <Avatar login={marker.login} image={marker.image} size="xl" />
      </span>
    );
  }
  return (
    <span className={disc({ tone: marker.tone ?? 'neutral' })} aria-hidden="true">
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16">
        {GLYPHS[marker.glyph]}
      </svg>
    </span>
  );
}

/** What every row takes beside its own: a `data-` attribute to find it by, a right-click, an id. */
export type TimelineRowAttributes = Omit<HTMLAttributes<HTMLLIElement>, 'children' | 'hidden'>;

export interface TimelineRowProps extends TimelineRowAttributes {
  marker: TimelineMarker;
  /** The keyboard is on it. */
  focused?: boolean | undefined;
  children: ReactNode;
}

/**
 * One row of the timeline: a marker on the rail, and what happened beside it. The other rows are
 * made of this one, and so is a box at the end of the timeline, which has its own avatar for a
 * marker.
 */
export function TimelineRow({
  marker,
  focused = false,
  children,
  className = '',
  ...rest
}: TimelineRowProps) {
  return (
    <li
      {...rest}
      className={`tl-row flex gap-12 rounded-md py-8 ${focused ? 'shadow-ring-inset' : ''} ${className}`}
    >
      <Marker marker={marker} />
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

export interface TimelineProps {
  /** The rows, each a {@link TimelineRow} or one of the kinds below. */
  children: ReactNode;
}

/** The pull request's history as one column of rows down a rail, oldest first. */
export function Timeline({ children }: TimelineProps) {
  return (
    <div className="px-32 py-24">
      <ol aria-label="Timeline" className="mx-auto flex max-w-read-measure list-none flex-col">
        {children}
      </ol>
    </div>
  );
}

/** Who did something, in a one-line event. */
export function TimelineName({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-fg">{children}</span>;
}

/** A revision's number, such as `r2`. */
function Revision({ children }: { children: string }) {
  return (
    <Tag>
      <span className="lo-num">{children}</span>
    </Tag>
  );
}

/** A commit's id, shortened. */
function Oid({ children }: { children: string }) {
  return <span className="text-fg-muted code-small">{children.slice(0, 7)}</span>;
}

/** The line of an event: what happened, and when, at the end. */
function Line({ children, when }: { children: ReactNode; when?: string | undefined }) {
  return (
    <div className="flex min-h-32 flex-wrap items-center gap-x-6 gap-y-4 text-fg-muted text-ui">
      {children}
      {when !== undefined && <time className="ms-auto flex-none text-small">{when}</time>}
    </div>
  );
}

export interface TimelineEventProps extends TimelineRowAttributes {
  glyph: TimelineGlyph;
  tone?: TimelineTone | undefined;
  /** How long ago, as the row says it: "3 days ago". */
  when?: string | undefined;
  focused?: boolean | undefined;
  /** The sentence: who did what, with {@link TimelineName} for the names and {@link Label}s. */
  children: ReactNode;
}

/**
 * A one-line event: a label added, someone assigned or asked for a review, a mention, a merge, a
 * queue change, a deployment, a draft changed, a pull request closed or reopened, its base
 * changed, a review dismissed, auto-merge, a stack. The sentence is the caller's; the glyph and
 * its tone say the kind.
 */
export function TimelineEvent({ glyph, tone, when, children, ...row }: TimelineEventProps) {
  return (
    <TimelineRow marker={{ glyph, tone }} {...row}>
      <Line when={when}>{children}</Line>
    </TimelineRow>
  );
}

/** What each state of a commit's checks says, and how its marker looks. */
const CHECKS = {
  passed: { words: 'Checks passed', glyph: 'check', tone: 'ok' },
  failed: { words: 'Checks failed', glyph: 'x', tone: 'fail' },
  running: { words: 'Checks running', glyph: 'ring', tone: 'warn' },
} as const satisfies Record<string, { words: string; glyph: TimelineGlyph; tone: TimelineTone }>;

export interface TimelineChecksProps extends TimelineRowAttributes {
  /** Where a commit's checks stand. */
  state: keyof typeof CHECKS;
  /** The revision they ran on: "r2". */
  revision?: string | undefined;
  when?: string | undefined;
  focused?: boolean | undefined;
}

/** A commit's checks, as their state and the revision they ran on: "Checks failed on r2". */
export function TimelineChecks({ state, revision, when, focused, ...row }: TimelineChecksProps) {
  const { words, glyph, tone } = CHECKS[state];
  return (
    <TimelineEvent glyph={glyph} tone={tone} when={when} focused={focused} {...row}>
      <span>
        {words}
        {revision !== undefined && ` on ${revision}`}
      </span>
    </TimelineEvent>
  );
}

export interface TimelinePushProps extends TimelineRowAttributes {
  actor: string;
  when: string;
  /** The revision the push made: "r2". */
  revision?: string | undefined;
  /** The commits, oldest first. Consecutive commits are one push. */
  commits: readonly { oid: string; headline: string }[];
  focused?: boolean | undefined;
}

/** Consecutive commits as one row: who pushed how many, the revision, and each commit's headline. */
export function TimelinePush({
  actor,
  when,
  revision,
  commits,
  focused,
  ...row
}: TimelinePushProps) {
  return (
    <TimelineRow marker={{ glyph: 'commits' }} focused={focused} {...row}>
      <Line when={when}>
        <TimelineName>{actor}</TimelineName>{' '}
        <span>
          pushed {commits.length} {commits.length === 1 ? 'commit' : 'commits'}
        </span>{' '}
        {revision !== undefined && <Revision>{revision}</Revision>}
      </Line>
      <ul className="mt-6 flex list-none flex-col gap-4">
        {commits.map((commit) => (
          <li key={commit.oid} className="flex items-center gap-8 text-fg text-small">
            <Oid>{commit.oid}</Oid>
            <span className="min-w-0 truncate">{commit.headline}</span>
          </li>
        ))}
      </ul>
    </TimelineRow>
  );
}

export interface TimelineForcePushProps extends TimelineRowAttributes {
  actor: string;
  when: string;
  /** The head branch, or the base branch. */
  branch?: 'head' | 'base' | undefined;
  /** The branch's commit before and after, when GitHub still has them. */
  before?: string | undefined;
  after?: string | undefined;
  /** The revision it made: "r3". */
  revision?: string | undefined;
  /** The comparison of what changed: "Compare r2 → r3", which the button sets. */
  compare?: { from: string; to: string; onCompare?: (() => void) | undefined } | undefined;
  focused?: boolean | undefined;
}

/**
 * A force-push, never folded into the pushes around it: the commit before and after it, its
 * revision, and a button that compares the revision before with it.
 */
export function TimelineForcePush({
  actor,
  when,
  branch = 'head',
  before,
  after,
  revision,
  compare,
  focused,
  ...row
}: TimelineForcePushProps) {
  return (
    <TimelineRow marker={{ glyph: 'force', tone: 'warn' }} focused={focused} {...row}>
      <Line when={when}>
        <TimelineName>{actor}</TimelineName>{' '}
        <span>force-pushed{branch === 'base' && ' the base branch'}</span>{' '}
        {before !== undefined && after !== undefined && (
          <span className="inline-flex items-center gap-4">
            <Oid>{before}</Oid>→<Oid>{after}</Oid>
          </span>
        )}{' '}
        {revision !== undefined && <Revision>{revision}</Revision>}
        {compare !== undefined && (
          <Button variant="ghost" size="sm" onClick={compare.onCompare}>
            Compare {compare.from} → {compare.to}
          </Button>
        )}
      </Line>
    </TimelineRow>
  );
}

/** A button that reads as a link, for what a card points to. */
function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
}) {
  return (
    <button
      type="button"
      className="rounded-xs text-link underline-offset-2 text-small hover:text-link-hover hover:underline focus-visible:shadow-ring"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const card = 'overflow-hidden rounded-md bg-bg-raised ring-1 ring-border';
const cardHead = cva('flex min-h-40 items-center gap-8 px-12 text-fg-muted text-small', {
  variants: {
    edge: {
      none: '',
      below: 'border-b border-border-subtle',
      above: 'border-t border-border-subtle',
    },
  },
  defaultVariants: { edge: 'below' },
});

/** What a card shows in place of a hidden comment's text. Its images load only once it's shown. */
export interface TimelineHidden {
  /** Why GitHub hid it, in a word: `outdated`, `resolved`, `spam`. */
  reason?: string | undefined;
  /** "Show comment" was pressed. */
  onShow?: (() => void) | undefined;
}

function HiddenBody({ hidden }: { hidden: TimelineHidden }) {
  return (
    <div className="flex items-center gap-8 px-12 py-8 text-fg-muted text-small">
      <span>
        {hidden.reason === undefined || hidden.reason === ''
          ? 'Hidden'
          : `Hidden as ${hidden.reason}`}
      </span>
      <Button size="sm" onClick={hidden.onShow}>
        Show comment
      </Button>
    </div>
  );
}

/** A post's text, already drawn: a card's body. */
function Text({ children }: { children: ReactNode }) {
  return <div className="lo-selectable px-12 py-12 text-fg read-comment">{children}</div>;
}

export interface TimelineCommentProps extends TimelineRowAttributes {
  author: string;
  image?: string | undefined;
  when: string;
  /** Written by the pull request's author. */
  byAuthor?: boolean | undefined;
  /** The comment's text, already drawn. It isn't drawn while the comment is hidden. */
  body: ReactNode;
  hidden?: TimelineHidden | undefined;
  focused?: boolean | undefined;
}

/** A comment on the pull request, as a card beside its author's avatar. */
export function TimelineComment({
  author,
  image,
  when,
  byAuthor,
  body,
  hidden,
  focused,
  ...row
}: TimelineCommentProps) {
  return (
    <TimelineRow marker={{ login: author, image }} focused={focused} {...row}>
      <div className={card}>
        <div className={cardHead({ edge: 'below' })}>
          <span>
            <TimelineName>{author}</TimelineName> commented
          </span>
          {byAuthor && <Tag>Author</Tag>}
          <time className="ms-auto">{when}</time>
        </div>
        {hidden === undefined ? <Text>{body}</Text> : <HiddenBody hidden={hidden} />}
      </div>
    </TimelineRow>
  );
}

/** What a review said. */
export type TimelineVerdict = 'approved' | 'changes' | 'commented' | 'dismissed';

const VERDICTS: Readonly<Record<TimelineVerdict, { words: string; marker: TimelineMarker }>> = {
  approved: { words: 'approved these changes', marker: { glyph: 'check', tone: 'ok' } },
  changes: { words: 'requested changes', marker: { glyph: 'changes', tone: 'fail' } },
  commented: { words: 'left a review', marker: { glyph: 'comment' } },
  dismissed: { words: 'left a review', marker: { glyph: 'comment' } },
};

export interface TimelineReviewProps extends TimelineRowAttributes {
  author: string;
  image?: string | undefined;
  when: string;
  verdict: TimelineVerdict;
  /** The revision it reviewed: "r2". */
  revision?: string | undefined;
  /** The review's summary, already drawn, if it has one. */
  body?: ReactNode;
  hidden?: TimelineHidden | undefined;
  /** How many comments it left, and where: "rate-limit.ts", or "3 files". */
  comments?: { count: number; on?: string | undefined } | undefined;
  /** "Show in the diff" was pressed. */
  onShowInDiff?: (() => void) | undefined;
  focused?: boolean | undefined;
}

/**
 * A review as a card: who reviewed, what they said and on which revision, their summary, and the
 * comments they left, with a way to see them in the diff.
 */
export function TimelineReview({
  author,
  image,
  when,
  verdict,
  revision,
  body,
  hidden,
  comments,
  onShowInDiff,
  focused,
  ...row
}: TimelineReviewProps) {
  const { words, marker } = VERDICTS[verdict];
  return (
    <TimelineRow marker={marker} focused={focused} {...row}>
      <div className={card}>
        <div
          className={cardHead({
            edge: hidden === undefined && body === undefined ? 'none' : 'below',
          })}
        >
          <Avatar login={author} image={image} size="sm" />
          <span>
            <TimelineName>{author}</TimelineName> {words}
            {revision !== undefined && ` on ${revision}`}
          </span>
          {verdict === 'dismissed' && <Tag>Dismissed</Tag>}
          <time className="ms-auto">{when}</time>
        </div>
        {hidden !== undefined ? (
          <HiddenBody hidden={hidden} />
        ) : (
          body !== undefined && <Text>{body}</Text>
        )}
        {comments !== undefined && comments.count > 0 && (
          <div className={cardHead({ edge: 'above' })}>
            <CommentIcon />
            <span>
              {comments.count} {comments.count === 1 ? 'comment' : 'comments'}
              {comments.on !== undefined && ` on ${comments.on}`}
            </span>
            <span className="ms-auto">
              <LinkButton onClick={onShowInDiff}>Show in the diff</LinkButton>
            </span>
          </div>
        )}
      </div>
    </TimelineRow>
  );
}

/** Where a requested reviewer stands. */
export type TimelineReviewerState =
  'requested' | 'approved' | 'changes' | 'commented' | 'dismissed';

/** A reviewer, as the description card lists them. */
export interface TimelineReviewer {
  login: string;
  image?: string | undefined;
  state: TimelineReviewerState;
}

const REVIEWER_STATES: Readonly<
  Record<TimelineReviewerState, { words: string; tone: string; shapes: ReactNode }>
> = {
  requested: { words: 'Review requested', tone: 'text-fg-muted', shapes: GLYPHS.ring },
  approved: { words: 'Approved', tone: 'text-success', shapes: GLYPHS.check },
  changes: { words: 'Requested changes', tone: 'text-danger', shapes: GLYPHS.x },
  commented: { words: 'Commented', tone: 'text-fg-muted', shapes: GLYPHS.comment },
  dismissed: { words: 'Review dismissed', tone: 'text-fg-muted', shapes: GLYPHS.dismissed },
};

function Reviewer({ reviewer }: { reviewer: TimelineReviewer }) {
  const { words, tone, shapes } = REVIEWER_STATES[reviewer.state];
  return (
    <li className="inline-flex items-center gap-4" title={`${reviewer.login}: ${words}`}>
      <Avatar login={reviewer.login} image={reviewer.image} size="sm" />
      <span className="text-fg">{reviewer.login}</span>
      <svg className={`lo-i lo-i--xs ${tone}`} viewBox="0 0 16 16" role="img" aria-label={words}>
        {shapes}
      </svg>
    </li>
  );
}

export interface TimelineDescriptionProps extends TimelineRowAttributes {
  author: string;
  image?: string | undefined;
  /** How long ago it was opened: "3 days ago". */
  when: string;
  /** The description, already drawn. A pull request with none says so. */
  body?: ReactNode;
  /** It's a draft. */
  draft?: boolean | undefined;
  labels?: readonly { name: string; color: string }[] | undefined;
  reviewers?: readonly TimelineReviewer[] | undefined;
  focused?: boolean | undefined;
}

/**
 * The pull request's description as the timeline's first card: who opened it and when, the text,
 * its labels in their own colors and its reviewers with where each stands. Lo reads all of it and
 * edits none, and the card says so.
 */
export function TimelineDescription({
  author,
  image,
  when,
  body,
  draft,
  labels = [],
  reviewers = [],
  focused,
  ...row
}: TimelineDescriptionProps) {
  return (
    <TimelineRow marker={{ login: author, image }} focused={focused} {...row}>
      <div className={card}>
        <div className={cardHead({ edge: 'below' })}>
          <span>
            <TimelineName>{author}</TimelineName> opened this {when}
          </span>
          <Tag>Author</Tag>
          {draft && <Tag>Draft</Tag>}
          <span className="ms-auto inline-flex items-center gap-4 text-fg-muted text-micro">
            <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            Read-only in Lo
          </span>
        </div>
        <Text>{body ?? <p className="text-fg-muted">No description.</p>}</Text>
        {(labels.length > 0 || reviewers.length > 0) && (
          <div className="flex flex-wrap items-center gap-8 px-12 pb-12">
            {labels.map((label) => (
              <Label key={label.name} color={label.color}>
                {label.name}
              </Label>
            ))}
            {reviewers.length > 0 && (
              <div className="ms-auto flex flex-wrap items-center gap-8 text-fg-muted text-small">
                <span>Reviewers</span>
                <ul className="flex list-none flex-wrap items-center gap-8">
                  {reviewers.map((reviewer) => (
                    <Reviewer key={reviewer.login} reviewer={reviewer} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </TimelineRow>
  );
}

export interface TimelineOlderProps {
  /** How many items are left out. */
  count: number;
  /** "See them on GitHub" was pressed. */
  onSee?: (() => void) | undefined;
}

/** Past the pages Lo reads, what's left out: "120 older items aren't shown. See them on GitHub." */
export function TimelineOlder({ count, onSee }: TimelineOlderProps) {
  return (
    <li className="flex flex-wrap items-center gap-6 py-8 text-fg-muted text-small">
      <span>
        {count} older {count === 1 ? "item isn't" : "items aren't"} shown.
      </span>
      <LinkButton onClick={onSee}>See {count === 1 ? 'it' : 'them'} on GitHub.</LinkButton>
    </li>
  );
}
