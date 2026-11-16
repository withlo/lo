import { cva } from 'class-variance-authority';
import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { Avatar } from './Avatar.tsx';
import { CheckIcon } from './Checklist.tsx';
import { withoutBidi } from './controls.ts';
import { LinkButton } from './LinkButton.tsx';
import { Spinner } from './Spinner.tsx';
import { StateIcon } from './StatePill.tsx';
import { Tag } from './Tag.tsx';

/** How an entry stands in the queue: its checks run, it waits its turn, or it's about to go. */
export type QueueState = 'running' | 'waiting' | 'removal';

/** A pull request in the queue. */
export interface QueueEntry {
  /** What tells it from the others. */
  key: string;
  /** Its place in the queue, from 1. */
  position: number;
  title: string;
  number: number;
  author: string;
  /** The address of the author's picture, if they have one. */
  authorImage?: string | undefined;
  state: QueueState;
  /** How long it's been in the queue: "14 min". */
  inQueue: string;
  /** When it's expected to merge: "~2 min". */
  merges: string;
  /** The account Lo acts as queued it. */
  yours?: boolean | undefined;
  /** It's a GitHub stack queued as one: how many layers, and which: "#4818–#4821". */
  stack?: { layers: number; range: string } | undefined;
  /** What to do about it, such as removing it, with each action's key. */
  actions?: ReactNode;
}

/** Entries the queue tests together, as one: "Testing together · 3 PRs". */
export interface QueueGroup {
  key: string;
  entries: readonly QueueEntry[];
}

/** What the queue lists, in its order: an entry on its own, or entries tested together. */
export type QueueItem = { kind: 'entry'; entry: QueueEntry } | { kind: 'group'; group: QueueGroup };

/** A pull request into the branch that turned on auto-merge, and isn't in the queue yet. */
export interface WaitingEntry {
  key: string;
  title: string;
  number: number;
  author: string;
  authorImage?: string | undefined;
  yours?: boolean | undefined;
  /** What it waits for: "when approved", "when checks pass". */
  until: string;
  /** What to do about it, such as turning auto-merge off. */
  actions?: ReactNode;
}

/** Why a pull request left the queue. */
export type LeftReason =
  | { kind: 'merged' }
  /** The checks failed in the queue, with the one that did, linked to its run when it's known. */
  | { kind: 'failed'; check?: { name: string; onOpen: () => void } | undefined }
  | { kind: 'conflict' }
  | { kind: 'timedOut' }
  /** Someone took it out. */
  | { kind: 'removed'; by?: string | undefined }
  /** GitHub gave a reason Lo has no word for: its own word. */
  | { kind: 'other'; word: string };

/** A pull request Lo saw leave the queue while it ran. */
export interface LeftEntry {
  key: string;
  title: string;
  number: number;
  reason: LeftReason;
  /** When it left: "5 h ago", "this morning". */
  when: string;
  /** How long it was in the queue: "23 min". */
  inQueue?: string | undefined;
}

export interface QueueTableProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'role' | 'aria-label' | 'aria-activedescendant'
> {
  /** What the table is, for screen readers: "Merge queue for main". */
  label: string;
  items: readonly QueueItem[];
  /** Pull requests waiting to join, under the queue. */
  waiting?: readonly WaitingEntry[] | undefined;
  /** Pull requests Lo saw leave, under those waiting. */
  left?: readonly LeftEntry[] | undefined;
  /** The queue has more entries than it lists: how many, and a way to see them on GitHub. */
  more?: { count: number; onOpen: () => void } | undefined;
  /** The row the keyboard is on, by key. */
  focused?: string | undefined;
  /** A row was clicked, by key. */
  onRowClick?: ((key: string) => void) | undefined;
  /** The table itself, which takes focus: its keys and scope go on it as attributes. */
  tableRef?: Ref<HTMLDivElement> | undefined;
}

const row = cva('queue-columns min-h-48 cursor-default rounded-sm px-12 text-ui hover:bg-hover', {
  variants: {
    yours: { true: 'bg-on-screen', false: '' },
    // Only while the table has keyboard focus: opened with a click, it has none to show.
    focused: { true: 'group-focus-visible/list:shadow-ring-inset', false: '' },
  },
});

const STATES: Readonly<Record<QueueState, { word: string; tone: string }>> = {
  running: { word: 'Checks running', tone: 'text-queue' },
  waiting: { word: 'Waiting', tone: 'text-fg-muted' },
  removal: { word: 'Will be removed', tone: 'text-danger' },
};

/** What the state column says of a pull request that left, and the color that goes with it. */
function leftState(reason: LeftReason): { word: string; tone: string } {
  switch (reason.kind) {
    case 'merged':
      return { word: 'Merged', tone: 'text-state-merged' };
    case 'failed':
      return { word: 'Checks failed', tone: 'text-danger' };
    case 'conflict':
      return { word: 'Conflict', tone: 'text-warning' };
    case 'timedOut':
      return { word: 'Timed out', tone: 'text-fg-muted' };
    case 'removed':
    case 'other':
      return { word: 'Removed', tone: 'text-fg-muted' };
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn't know: ${JSON.stringify(reason)}.`);
  }
}

/** The mark in a left row's first column, in the color of how it ended. */
function LeftIcon({ reason }: { reason: LeftReason }) {
  const tone = leftState(reason).tone;
  switch (reason.kind) {
    case 'merged':
      return (
        <span className={tone}>
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <StateIcon state="merged" />
          </svg>
        </span>
      );
    case 'failed':
      return (
        <span className={tone}>
          <CheckIcon glyph="failed" />
        </span>
      );
    case 'conflict':
      return (
        <span className={tone}>
          <CheckIcon glyph="conflict" />
        </span>
      );
    case 'timedOut':
      return (
        <span className={tone}>
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75V8l2 1.5" />
          </svg>
        </span>
      );
    case 'removed':
      return (
        <span className={tone}>
          <CheckIcon glyph="review" />
        </span>
      );
    case 'other':
      return (
        <span className={tone}>
          <CheckIcon glyph="unknown" />
        </span>
      );
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn't know: ${JSON.stringify(reason)}.`);
  }
}

/** What happened to a pull request that left, after when it did: "removed 5 h ago: …". */
function Why({ entry }: { entry: LeftEntry }) {
  const { reason, when } = entry;
  switch (reason.kind) {
    case 'merged':
      return <>merged {when}</>;
    case 'failed':
      return reason.check === undefined ? (
        <>removed {when}: its checks failed</>
      ) : (
        <>
          removed {when}:{' '}
          <LinkButton
            onClick={reason.check.onOpen}
            label={`Open ${withoutBidi(reason.check.name)} on GitHub`}
          >
            {withoutBidi(reason.check.name)}
          </LinkButton>{' '}
          failed with its group
        </>
      );
    case 'conflict':
      return <>removed {when}: it conflicts with the branch or an entry ahead of it</>;
    case 'timedOut':
      return <>removed {when}: its checks ran past the queue's time limit</>;
    case 'removed':
      return reason.by === undefined ? (
        <>removed {when}</>
      ) : (
        <>
          removed {when} by {withoutBidi(reason.by)}
        </>
      );
    case 'other':
      return (
        <>
          removed {when}: {withoutBidi(reason.word)}
        </>
      );
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn't know: ${JSON.stringify(reason)}.`);
  }
}

/** Where a pull request is, then who: "#4810 [avatar] tess-okafor · yours". */
function Byline({
  number,
  author,
  image,
  notes = [],
}: {
  number: number;
  author: string;
  image?: string | undefined;
  notes?: readonly string[];
}) {
  return (
    <span className="flex min-w-0 items-center gap-6 text-fg-muted text-small">
      <span className="lo-num flex-none">#{number}</span>
      <Avatar login={author} size="sm" image={image} />
      <span className="min-w-0 truncate">{[withoutBidi(author), ...notes].join(' · ')}</span>
    </span>
  );
}

function Title({ text, strong }: { text: string; strong?: boolean | undefined }) {
  const shown = withoutBidi(text);
  return (
    <span className={`min-w-0 truncate ${strong ? 'font-semibold' : ''}`} title={shown}>
      {shown}
    </span>
  );
}

const cell = 'min-w-0';

interface RowProps {
  id: string;
  rowKey: string;
  yours?: boolean | undefined;
  focused: boolean;
  onClick?: ((key: string) => void) | undefined;
  children: ReactNode;
}

function Row({ id, rowKey, yours, focused, onClick, children }: RowProps) {
  return (
    <div
      id={id}
      role="row"
      data-key={rowKey}
      aria-selected={focused}
      data-yours={yours === true ? '' : undefined}
      className={row({ yours: yours === true, focused })}
      onClick={() => onClick?.(rowKey)}
    >
      {children}
    </div>
  );
}

function EntryRow({
  entry,
  ids,
  focused,
  onClick,
}: {
  entry: QueueEntry;
  ids: (key: string) => string;
  focused: string | undefined;
  onClick: ((key: string) => void) | undefined;
}) {
  const state = STATES[entry.state];
  const notes = [
    ...(entry.yours === true ? [entry.stack === undefined ? 'yours' : 'queued by you'] : []),
    ...(entry.stack === undefined ? [] : [`stack ${entry.stack.range}`]),
  ];
  return (
    <Row
      id={ids(entry.key)}
      rowKey={entry.key}
      yours={entry.yours}
      focused={focused === entry.key}
      onClick={onClick}
    >
      <span
        role="gridcell"
        className={`lo-num read-h3 ${entry.yours === true ? 'text-fg-accent' : 'text-fg-muted'}`}
      >
        {entry.position}
      </span>
      <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
        <span className="flex min-w-0 items-center gap-6">
          <Title text={entry.title} strong={entry.yours} />
          {entry.stack !== undefined && <Tag>{entry.stack.layers} layers</Tag>}
        </span>
        <Byline
          number={entry.number}
          author={entry.author}
          image={entry.authorImage}
          notes={notes}
        />
      </span>
      <span role="gridcell" className={`${cell} ${state.tone}`}>
        {state.word}
      </span>
      <span role="gridcell" className="lo-num">
        {entry.inQueue}
      </span>
      <span role="gridcell" className="lo-num">
        {entry.merges}
      </span>
      <span role="gridcell" className="flex justify-end gap-4">
        {entry.actions}
      </span>
    </Row>
  );
}

function WaitingRow({
  entry,
  ids,
  focused,
  onClick,
}: {
  entry: WaitingEntry;
  ids: (key: string) => string;
  focused: string | undefined;
  onClick: ((key: string) => void) | undefined;
}) {
  return (
    <Row
      id={ids(entry.key)}
      rowKey={entry.key}
      yours={entry.yours}
      focused={focused === entry.key}
      onClick={onClick}
    >
      <span role="gridcell" className="text-fg-muted read-h3">
        <span aria-label="Not in the queue yet">—</span>
      </span>
      <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
        <Title text={entry.title} strong={entry.yours} />
        <Byline
          number={entry.number}
          author={entry.author}
          image={entry.authorImage}
          notes={entry.yours === true ? ['yours'] : []}
        />
      </span>
      <span role="gridcell" className={`${cell} text-fg-accent`}>
        Auto-merge on
      </span>
      <span role="gridcell" className="text-fg-muted">
        not yet
      </span>
      <span role="gridcell" className="text-fg-muted">
        {entry.until}
      </span>
      <span role="gridcell" className="flex justify-end gap-4">
        {entry.actions}
      </span>
    </Row>
  );
}

function LeftRow({
  entry,
  ids,
  focused,
  onClick,
}: {
  entry: LeftEntry;
  ids: (key: string) => string;
  focused: string | undefined;
  onClick: ((key: string) => void) | undefined;
}) {
  const state = leftState(entry.reason);
  return (
    <Row id={ids(entry.key)} rowKey={entry.key} focused={focused === entry.key} onClick={onClick}>
      <span role="gridcell">
        <LeftIcon reason={entry.reason} />
      </span>
      <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
        <Title text={entry.title} />
        <span className="flex min-w-0 flex-wrap items-center gap-x-6 text-fg-muted text-small">
          <span className="lo-num flex-none">#{entry.number}</span>
          <span className="min-w-0">
            <Why entry={entry} />
          </span>
        </span>
      </span>
      <span role="gridcell" className={`${cell} ${state.tone}`}>
        {state.word}
      </span>
      <span role="gridcell" className="lo-num">
        {entry.inQueue}
      </span>
      <span role="gridcell" />
      <span role="gridcell" />
    </Row>
  );
}

/** A heading over a part of the table. */
function Heading({ children }: { children: ReactNode }) {
  return (
    <div role="row" className="px-12 pt-16 pb-4">
      <div role="rowheader" aria-colspan={6} className="label-caps text-fg-muted text-label">
        {children}
      </div>
    </div>
  );
}

/**
 * A branch's merge queue as a table: each entry's place, title and author, how it stands, how long
 * it's been queued and when it should merge, with entries tested together boxed as a group and the
 * account's own marked. Under it, the pull requests waiting to join with auto-merge on, and those
 * Lo saw leave, each with why. It's one focusable element, as the threads panel's list is: the row
 * the keyboard is on is its active descendant and has a ring while the table has keyboard focus.
 * Its keys and key scope go on it as attributes, such as `onKeyDown` and `data-lo-scope`.
 */
export function QueueTable({
  label,
  items,
  waiting = [],
  left = [],
  more,
  focused,
  onRowClick,
  tableRef,
  className = '',
  ...rest
}: QueueTableProps) {
  const prefix = useId();
  const ids = (key: string) => `${prefix}-${key}`;
  const active = [
    ...items.flatMap((item) => (item.kind === 'entry' ? [item.entry] : item.group.entries)),
    ...waiting,
    ...left,
  ].find((each) => each.key === focused);
  return (
    <div
      ref={tableRef}
      role="grid"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={active === undefined ? undefined : ids(active.key)}
      className={`group/list flex flex-col gap-6 ${className}`}
      {...rest}
    >
      <div
        role="row"
        className="queue-columns h-32 border-b border-border px-12 label-caps text-fg-muted text-label"
      >
        <span role="columnheader">#</span>
        <span role="columnheader">Pull request</span>
        <span role="columnheader">State</span>
        <span role="columnheader">In queue</span>
        <span role="columnheader">Merges</span>
        <span role="columnheader">
          <span className="sr-only">Actions</span>
        </span>
      </div>

      {items.length === 0 && (
        <div role="row">
          <div role="gridcell" aria-colspan={6} className="px-12 py-16 text-fg-muted text-ui">
            Nothing is in the merge queue.
          </div>
        </div>
      )}
      {items.map((item) =>
        item.kind === 'entry' ? (
          <EntryRow
            key={item.entry.key}
            entry={item.entry}
            ids={ids}
            focused={focused}
            onClick={onRowClick}
          />
        ) : (
          <div
            key={item.group.key}
            role="rowgroup"
            aria-label={`Testing together, ${item.group.entries.length} PRs`}
            className="relative rounded-md py-6 inset-ring inset-ring-state-merged-border"
          >
            <div role="row">
              <div
                role="rowheader"
                aria-colspan={6}
                className="flex items-center gap-6 px-12 pb-4 text-small-medium text-queue"
              >
                <Spinner size="xs" />
                Testing together · {item.group.entries.length} PRs
              </div>
            </div>
            {item.group.entries.map((entry) => (
              <EntryRow
                key={entry.key}
                entry={entry}
                ids={ids}
                focused={focused}
                onClick={onRowClick}
              />
            ))}
          </div>
        ),
      )}
      {more !== undefined && (
        <div role="row">
          <div
            role="gridcell"
            aria-colspan={6}
            className="flex items-center gap-6 px-12 pt-6 text-fg-muted text-small"
          >
            <span>{more.count} more aren&apos;t shown.</span>
            <LinkButton onClick={more.onOpen}>See the queue on GitHub.</LinkButton>
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div role="rowgroup" aria-label="Waiting to join">
          <Heading>Waiting to join</Heading>
          {waiting.map((entry) => (
            <WaitingRow
              key={entry.key}
              entry={entry}
              ids={ids}
              focused={focused}
              onClick={onRowClick}
            />
          ))}
        </div>
      )}

      {left.length > 0 && (
        <div role="rowgroup" aria-label="Left the queue">
          <Heading>Left the queue</Heading>
          {left.map((entry) => (
            <LeftRow
              key={entry.key}
              entry={entry}
              ids={ids}
              focused={focused}
              onClick={onRowClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
