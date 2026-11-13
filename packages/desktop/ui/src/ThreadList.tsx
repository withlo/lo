import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { Avatar } from './Avatar.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';
import { Tag } from './Tag.tsx';

/** Which threads the panel lists: the unresolved ones, every one, or those you wrote or are in. */
export type ThreadsFilter = 'unresolved' | 'all' | 'yours';

export interface ThreadFilterProps {
  value: ThreadsFilter;
  /** How many threads each choice would list. */
  counts: Readonly<Record<ThreadsFilter, number>>;
  onChange: (value: ThreadsFilter) => void;
  /** The key that steps through the choices, as this system shows it. */
  keys?: readonly string[] | undefined;
}

function Counted({ word, count }: { word: string; count: number }) {
  return (
    <>
      {word} <span className="lo-num text-fg-muted">{count}</span>
    </>
  );
}

/** The panel's filter: "Unresolved 6 · All 9 · Yours 3", with the key that steps through them. */
export function ThreadFilter({ value, counts, onChange, keys }: ThreadFilterProps) {
  return (
    <SegmentedControl
      label="Show"
      kind="views"
      size="sm"
      value={value}
      onChange={onChange}
      keys={keys}
      items={[
        { value: 'unresolved', label: <Counted word="Unresolved" count={counts.unresolved} /> },
        { value: 'all', label: <Counted word="All" count={counts.all} /> },
        { value: 'yours', label: <Counted word="Yours" count={counts.yours} /> },
      ]}
    />
  );
}

/** One thread, as the panel's row shows it. */
export interface ThreadListRow {
  /** What identifies the thread, and what `onShow` names. */
  key: string;
  /** The first comment's author, by login. */
  author: string;
  image?: string | undefined;
  /** Where it is: "new 41", "old 30", "On the file", or for an outdated one "r2 · line 22". */
  where: string;
  /** How many replies it has. */
  replies: number;
  resolved: boolean;
  /** It's only in your review, not sent. */
  pending?: boolean | undefined;
  /** Its line has changed since it was written. */
  outdated?: boolean | undefined;
  /** The first comment's opening, as plain text. The row shows two lines of it. */
  excerpt: string;
}

/** A group of threads under a heading: a file, or "Drafts on other revisions". */
export interface ThreadListGroup {
  key: string;
  label: string;
  /** The label is a file's path, whose name stands out from the folders before it. */
  file?: boolean | undefined;
  rows: readonly ThreadListRow[];
}

export interface ThreadListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  groups: readonly ThreadListGroup[];
  /** The thread on screen, by key. */
  current?: string | undefined;
  /** The thread the keyboard is on, by key. */
  focused?: string | undefined;
  /** A row was clicked: its thread's key. */
  onShow?: ((key: string) => void) | undefined;
  /** What shows when no group has a thread, such as why the filter lists none. */
  empty?: ReactNode;
  /** The list itself, which takes focus. */
  listRef?: Ref<HTMLDivElement> | undefined;
}

function Heading({ group }: { group: ThreadListGroup }) {
  const at = group.label.lastIndexOf('/');
  return (
    <div
      role="presentation"
      className="flex items-center gap-6 px-8 pt-12 pb-4 text-fg-muted code-small"
    >
      {group.file === true ? (
        <span className="min-w-0 truncate">
          {group.label.slice(0, at + 1)}
          <span className="text-fg">{group.label.slice(at + 1)}</span>
        </span>
      ) : (
        <span className="min-w-0 truncate">{group.label}</span>
      )}
    </div>
  );
}

function Row({
  row,
  id,
  current,
  focused,
  onShow,
}: {
  row: ThreadListRow;
  id: string;
  current: boolean;
  focused: boolean;
  onShow?: ((key: string) => void) | undefined;
}) {
  const state = row.pending === true ? 'pending' : row.resolved ? 'resolved' : 'unresolved';
  return (
    <div
      id={id}
      role="option"
      aria-selected={focused}
      aria-current={current ? 'true' : undefined}
      data-key={row.key}
      className={`flex items-start gap-8 rounded-sm px-8 py-8 hover:bg-hover ${current ? 'bg-on-screen' : ''} ${focused ? 'group-focus-visible/list:shadow-ring-inset' : ''}`}
      onClick={() => onShow?.(row.key)}
    >
      <span className={`mt-2 flex-none ${row.resolved ? 'opacity-60' : ''}`}>
        <Avatar login={row.author} image={row.image} size="sm" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-6">
          <span className="min-w-0 truncate text-fg-muted code-small">{row.where}</span>
          <span className="ms-auto flex flex-none items-center gap-6 text-fg-muted text-micro">
            {row.replies > 0 && (
              <span className="lo-num">
                {row.replies} {row.replies === 1 ? 'reply' : 'replies'}
              </span>
            )}
            {row.outdated === true && <Tag>Outdated</Tag>}
            {state === 'pending' && <Tag tone="warning">Pending</Tag>}
            {state === 'resolved' && <Tag tone="ok">Resolved</Tag>}
            {state === 'unresolved' && <Tag tone="warning">Unresolved</Tag>}
          </span>
        </div>
        <p className={`line-clamp-2 text-small ${row.resolved ? 'text-fg-muted' : 'text-fg'}`}>
          <span className="font-semibold">{row.author}</span> {row.excerpt}
        </p>
      </div>
    </div>
  );
}

/**
 * The threads panel's rows: a group for each file, with a row for each thread: who started it,
 * where, its replies, its state and the opening of what was said. It's one focusable element:
 * the thread the keyboard is on is its active descendant. Move and filter with the keys the panel
 * gives, and say which filter is on with {@link ThreadFilter}.
 */
export function ThreadList({
  groups,
  current,
  focused,
  onShow,
  empty,
  listRef,
  className = '',
  ...rest
}: ThreadListProps) {
  const prefix = useId();
  const rows = groups.flatMap((group) => group.rows);
  if (rows.length === 0 && empty !== undefined) {
    return <div className="px-12 py-8 text-fg-muted text-small">{empty}</div>;
  }
  const rowId = (key: string | undefined) =>
    `${prefix}-row-${rows.findIndex((row) => row.key === key)}`;
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Threads"
      tabIndex={0}
      aria-activedescendant={rows.some((row) => row.key === focused) ? rowId(focused) : undefined}
      className={`group/list flex flex-col gap-2 px-6 pb-12 ${className}`}
      {...rest}
    >
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <div key={group.key} role="group" aria-label={group.label}>
            <Heading group={group} />
            {group.rows.map((row) => (
              <Row
                key={row.key}
                row={row}
                id={rowId(row.key)}
                current={row.key === current}
                focused={row.key === focused}
                onShow={onShow}
              />
            ))}
          </div>
        ))}
    </div>
  );
}
