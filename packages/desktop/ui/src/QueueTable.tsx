import { cva } from 'class-variance-authority';
import {
  useId,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { Avatar } from './Avatar.tsx';
import { CheckIcon } from './Checklist.tsx';
import { withoutBidi } from './controls.ts';
import { LinkButton } from './LinkButton.tsx';
import { Spinner } from './Spinner.tsx';
import { StateIcon } from './StatePill.tsx';
import { Tag } from './Tag.tsx';

/** How an entry stands in the queue: its checks run, it waits its turn, or it's leaving. */
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
  /** When it's expected to merge: "about 2 min". */
  merges: string;
  /** The account Lo acts as opened it, which a "you" tag by the author says. */
  yours?: boolean | undefined;
  /** It's a GitHub stack queued as one: how many layers, and which: "#4818–#4821". */
  stack?: { layers: number; range: string } | undefined;
  /**
   * What to do about it, such as removing it, at the row's end. They show on the row the keyboard
   * is on, and on one under the pointer or with focus in it.
   */
  actions?: ReactNode;
  /** A line under the row, across it, such as why what was asked of it didn't go. */
  note?: ReactNode;
}

/** Entries the queue tests together, as one: "Testing together · 3 pull requests". */
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
  /** What it waits on: "needs approval", "checks running". Nothing when it waits on nothing more. */
  until: string;
  /** What to do about it, such as turning auto-merge off, as an entry's actions show. */
  actions?: ReactNode;
  /** A line under the row, across it. */
  note?: ReactNode;
}

/** Why a pull request left the queue. */
export type LeftReason =
  | { kind: 'merged' }
  /** The checks failed in the queue, with the one that did, linked to its run when it's known. */
  | { kind: 'failed'; check?: { name: string; onOpen: () => void } | undefined }
  | { kind: 'conflict' }
  | { kind: 'timedOut' }
  /** Someone removed it. */
  | { kind: 'removed'; by?: string | undefined }
  /** GitHub gave a reason Lo has no word for: its own word. */
  | { kind: 'other'; word: string }
  /** It left without merging, and why isn't known. */
  | { kind: 'unknown' };

/** A pull request Lo saw leave the queue while it ran. */
export interface LeftEntry {
  key: string;
  title: string;
  number: number;
  reason: LeftReason;
  /** When it left: "5 h ago". */
  when: string;
  /** How long it was in the queue: "23 min". */
  inQueue?: string | undefined;
  /** GitHub left part of why it left out. */
  partial?: boolean | undefined;
  /** What to do about it, as an entry's actions show. */
  actions?: ReactNode;
  /** A line under the row, across it. */
  note?: ReactNode;
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
  /**
   * What the table says while it lists no entries: that there are none in the queue. `null` says
   * nothing, where the entries couldn't all be read, and what's above the table says so.
   */
  empty?: ReactNode;
  /** The row the keyboard is on, by key. */
  focused?: string | undefined;
  /** A row was clicked, by key. */
  onRowClick?: ((key: string) => void) | undefined;
  /** A row was double-clicked, to open it, by key. */
  onRowOpen?: ((key: string) => void) | undefined;
  /** The table itself, which takes focus: its keys and scope go on it as attributes. */
  tableRef?: Ref<HTMLDivElement> | undefined;
}

const row = cva(
  'group/row queue-columns min-h-48 cursor-default rounded-sm px-12 text-ui hover:bg-hover',
  {
    variants: {
      // The keyboard's row is the one tinted; its ring shows only while the table has keyboard
      // focus: opened with a click, it has none to show.
      focused: { true: 'bg-selected group-focus-visible/list:shadow-ring-inset', false: '' },
    },
  },
);

/** The last cell of a row: its actions, on the keyboard's row, under the pointer or with focus. */
const actionsCell =
  'invisible flex min-w-0 items-center justify-end gap-4 group-hover/row:visible group-focus-within/row:visible group-data-focused/row:visible';

const STATES: Readonly<Record<QueueState, { word: string; tone: string }>> = {
  running: { word: 'Checks running', tone: 'text-queue' },
  waiting: { word: 'Waiting', tone: 'text-fg-muted' },
  removal: { word: 'Leaving', tone: 'text-danger' },
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
      return { word: 'Removed', tone: 'text-fg-muted' };
    case 'other':
    case 'unknown':
      return { word: 'Left', tone: 'text-fg-muted' };
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn’t know: ${JSON.stringify(reason)}.`);
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
    case 'unknown':
      return (
        <span className={tone}>
          <CheckIcon glyph="unknown" />
        </span>
      );
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn’t know: ${JSON.stringify(reason)}.`);
  }
}

/**
 * What happened to a pull request that left, and when: "Left 5 h ago · checks failed". It "left"
 * unless a person removed it.
 */
function Why({ entry }: { entry: LeftEntry }) {
  const { reason, when } = entry;
  switch (reason.kind) {
    case 'merged':
      return <>Merged {when}</>;
    case 'failed':
      return reason.check === undefined ? (
        <>Left {when} · checks failed</>
      ) : (
        <>
          Left {when} ·{' '}
          <LinkButton
            onClick={reason.check.onOpen}
            label={`Open ${withoutBidi(reason.check.name)} on GitHub`}
          >
            {withoutBidi(reason.check.name)}
          </LinkButton>{' '}
          failed
        </>
      );
    case 'conflict':
      return <>Left {when} · conflict</>;
    case 'timedOut':
      return <>Left {when} · checks timed out</>;
    case 'removed':
      return reason.by === undefined ? (
        <>Removed {when}</>
      ) : (
        <>
          Removed {when} by {withoutBidi(reason.by)}
        </>
      );
    case 'other':
      return (
        <>
          Left {when} · {withoutBidi(reason.word)}
        </>
      );
    case 'unknown':
      return <>Left {when}</>;
    default:
      reason satisfies never;
      throw new Error(`A reason for leaving the queue Lo doesn’t know: ${JSON.stringify(reason)}.`);
  }
}

/** Where a pull request is, then who, with "you" by the author when it's the account's own. */
function Byline({
  number,
  author,
  image,
  yours,
  notes = [],
}: {
  number: number;
  author: string;
  image?: string | undefined;
  yours?: boolean | undefined;
  notes?: readonly string[];
}) {
  return (
    <span className="flex min-w-0 items-center gap-6 text-fg-muted text-small">
      <span className="lo-num flex-none">#{number}</span>
      <Avatar login={author} size="sm" image={image} />
      <span className="min-w-0 truncate">{withoutBidi(author)}</span>
      {yours === true && <Tag>you</Tag>}
      {notes.length > 0 && <span className="min-w-0 truncate">· {notes.join(' · ')}</span>}
    </span>
  );
}

function Title({ text }: { text: string }) {
  const shown = withoutBidi(text);
  return (
    <span className="min-w-0 truncate" title={shown}>
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
  onOpen?: ((key: string) => void) | undefined;
  children: ReactNode;
}

/** Whether a click landed on a control inside a row, which takes it for itself. */
function onControl(event: ReactMouseEvent): boolean {
  return event.target instanceof Element && event.target.closest('button, a') !== null;
}

function Row({ id, rowKey, yours, focused, onClick, onOpen, children }: RowProps) {
  return (
    <div
      id={id}
      role="row"
      data-key={rowKey}
      data-yours={yours === true ? '' : undefined}
      // Its actions' key chips show on the keyboard's row alone.
      data-key-scope=""
      data-focused={focused ? '' : undefined}
      className={row({ focused })}
      onClick={() => onClick?.(rowKey)}
      onDoubleClick={(event) => {
        if (!onControl(event)) onOpen?.(rowKey);
      }}
    >
      {children}
    </div>
  );
}

/** A line under a row, across the columns after its first. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div role="row" className="queue-columns px-12 pb-6">
      <div role="gridcell" aria-colspan={6} className="col-span-5 col-start-2 min-w-0">
        {children}
      </div>
    </div>
  );
}

interface RowOf<T> {
  entry: T;
  ids: (key: string) => string;
  focused: string | undefined;
  onClick: ((key: string) => void) | undefined;
  onOpen: ((key: string) => void) | undefined;
}

function EntryRow({ entry, ids, focused, onClick, onOpen }: RowOf<QueueEntry>) {
  const state = STATES[entry.state];
  return (
    <>
      <Row
        id={ids(entry.key)}
        rowKey={entry.key}
        yours={entry.yours}
        focused={focused === entry.key}
        onClick={onClick}
        onOpen={onOpen}
      >
        <span role="gridcell" className="lo-num text-fg-muted read-h3">
          {entry.position}
        </span>
        <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
          <span className="flex min-w-0 items-center gap-6">
            <Title text={entry.title} />
            {entry.stack !== undefined && <Tag>{entry.stack.layers} layers</Tag>}
          </span>
          <Byline
            number={entry.number}
            author={entry.author}
            image={entry.authorImage}
            yours={entry.yours}
            notes={entry.stack === undefined ? [] : [`stack ${entry.stack.range}`]}
          />
        </span>
        <span role="gridcell" className={`${cell} truncate ${state.tone}`}>
          {state.word}
        </span>
        <span role="gridcell" className="lo-num truncate">
          {entry.inQueue}
        </span>
        <span role="gridcell" className="lo-num truncate">
          {entry.merges}
        </span>
        <span role="gridcell" className={actionsCell}>
          {entry.actions}
        </span>
      </Row>
      {entry.note !== undefined && <Note>{entry.note}</Note>}
    </>
  );
}

function WaitingRow({ entry, ids, focused, onClick, onOpen }: RowOf<WaitingEntry>) {
  return (
    <>
      <Row
        id={ids(entry.key)}
        rowKey={entry.key}
        yours={entry.yours}
        focused={focused === entry.key}
        onClick={onClick}
        onOpen={onOpen}
      >
        <span role="gridcell" className="text-fg-muted read-h3">
          <span aria-label="Waiting to join">—</span>
        </span>
        <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
          <Title text={entry.title} />
          <Byline
            number={entry.number}
            author={entry.author}
            image={entry.authorImage}
            yours={entry.yours}
          />
        </span>
        <span role="gridcell" className={`${cell} truncate text-fg-muted`}>
          Auto-merge is on
        </span>
        {/* What it waits on, across the two columns of times it has none of yet. */}
        <span role="gridcell" className={`${cell} col-span-2 truncate text-fg-muted text-small`}>
          {entry.until}
        </span>
        <span role="gridcell" className={actionsCell}>
          {entry.actions}
        </span>
      </Row>
      {entry.note !== undefined && <Note>{entry.note}</Note>}
    </>
  );
}

function LeftRow({ entry, ids, focused, onClick, onOpen }: RowOf<LeftEntry>) {
  const state = leftState(entry.reason);
  return (
    <>
      <Row
        id={ids(entry.key)}
        rowKey={entry.key}
        focused={focused === entry.key}
        onClick={onClick}
        onOpen={onOpen}
      >
        <span role="gridcell">
          <LeftIcon reason={entry.reason} />
        </span>
        <span role="gridcell" className={`${cell} flex flex-col gap-2`}>
          <Title text={entry.title} />
          <span className="flex min-w-0 items-center gap-6 text-fg-muted text-small">
            <span className="lo-num flex-none">#{entry.number}</span>
            <span className="min-w-0 truncate">
              <Why entry={entry} />
            </span>
          </span>
        </span>
        <span role="gridcell" className={`${cell} truncate ${state.tone}`}>
          {state.word}
        </span>
        <span role="gridcell" className="lo-num truncate">
          {entry.inQueue}
        </span>
        <span role="gridcell" />
        <span role="gridcell" className={actionsCell}>
          {entry.actions}
        </span>
      </Row>
      {entry.note !== undefined && <Note>{entry.note}</Note>}
    </>
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

/** "2 pull requests", or "1 pull request". */
function pullRequests(count: number): string {
  return count === 1 ? '1 pull request' : `${count} pull requests`;
}

/**
 * A branch's merge queue as a table: each entry's place, title and author, how it stands, how long
 * it's been queued and when it should merge, with entries tested together boxed as a group and the
 * account's own tagged. Under it, the pull requests waiting to join with auto-merge on, and those
 * Lo saw leave, each with why. It's one focusable element, as the threads panel's list is: the row
 * the keyboard is on is its active descendant, tinted, and has a ring while the table has keyboard
 * focus. A double click opens a row. Its keys and key scope go on it as attributes, such as
 * `onKeyDown` and `data-lo-scope`.
 *
 * It's the container its rows fit to (`queue-columns`): narrower, the rows' actions give up their
 * key chips (`queue-chip`), then their labels (`queue-label`), so a row never wraps or clips.
 */
export function QueueTable({
  label,
  items,
  waiting = [],
  left = [],
  more,
  empty = 'No pull requests in the queue',
  focused,
  onRowClick,
  onRowOpen,
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
  const rowOf = { ids, focused, onClick: onRowClick, onOpen: onRowOpen };
  return (
    <div
      ref={tableRef}
      role="grid"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={active === undefined ? undefined : ids(active.key)}
      className={`group/list @container flex flex-col gap-6 ${className}`}
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

      {items.length === 0 && empty !== null && (
        <div role="row">
          <div role="gridcell" aria-colspan={6} className="px-12 py-16 text-fg-muted text-ui">
            {empty}
          </div>
        </div>
      )}
      {items.map((item) =>
        item.kind === 'entry' ? (
          <EntryRow key={item.entry.key} entry={item.entry} {...rowOf} />
        ) : (
          <div
            key={item.group.key}
            role="rowgroup"
            aria-label={`Testing together, ${pullRequests(item.group.entries.length)}`}
            className="relative rounded-md py-6 inset-ring inset-ring-state-merged-border"
          >
            <div role="row">
              <div
                role="rowheader"
                aria-colspan={6}
                className="flex items-center gap-6 px-12 pb-4 text-small-medium text-queue"
              >
                <Spinner size="xs" />
                Testing together · {pullRequests(item.group.entries.length)}
              </div>
            </div>
            {item.group.entries.map((entry) => (
              <EntryRow key={entry.key} entry={entry} {...rowOf} />
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
            <span>
              {more.count === 1 ? '1 more pull request' : `${more.count} more pull requests`}
            </span>
            <LinkButton onClick={more.onOpen}>Open on GitHub</LinkButton>
          </div>
        </div>
      )}

      {waiting.length > 0 && (
        <div role="rowgroup" aria-label="Waiting to join">
          <Heading>Waiting to join</Heading>
          {waiting.map((entry) => (
            <WaitingRow key={entry.key} entry={entry} {...rowOf} />
          ))}
        </div>
      )}

      {left.length > 0 && (
        <div role="rowgroup" aria-label="Left">
          <Heading>Left</Heading>
          {left.map((entry) => (
            <LeftRow key={entry.key} entry={entry} {...rowOf} />
          ))}
        </div>
      )}
    </div>
  );
}
