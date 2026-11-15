import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react';

import { showFormat } from './controls.ts';
import { FileIcon } from './FileTree.tsx';
import { ShownText } from './ShownText.tsx';
import { PathName, SourceMark, type AnswerSource } from './Source.tsx';

/** The word's references in one file: the rows the list shows under the file's name. */
export interface ReferencesGroup {
  key: string;
  /** The file's path in the repository. */
  path: string;
  rows: readonly ReferenceRow[];
}

/** One reference: the line it's on and that line's text, with the word marked in it. */
export interface ReferenceRow {
  /** What identifies it, and what `current`, `focused` and `onGo` name. */
  key: string;
  /** The line, from 1. */
  line: number;
  /** The line's text. Its indentation isn't shown. */
  text: string;
  /** The word's place in `text`, as the offsets of its first and last character, end excluded. */
  match: { from: number; to: number };
}

export interface ReferencesHeadProps {
  /** The word whose references these are. */
  name: string;
  /** How many references there are, and in how many files. */
  count: number;
  files: number;
  source: AnswerSource;
  /** The revision they're read at: "r5". */
  at?: string | undefined;
}

/** "1 file", "6 files". */
function filesIn(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/**
 * The head of the references panel: the word, how many references it has in how many files, and
 * where the answer came from: "14 in 6 files · TypeScript, at r5".
 */
export function ReferencesHead({ name, count, files, source, at }: ReferencesHeadProps) {
  return (
    <div className="flex flex-none flex-col gap-4 px-16 pb-8">
      <span className="min-w-0 truncate text-fg code-text" title={showFormat(name)}>
        <ShownText text={name} />
      </span>
      <span className="min-w-0 text-fg-muted text-small">
        <span className="lo-num">
          {count} in {filesIn(files)}
        </span>
        {' · '}
        <SourceMark source={source} />
        {at !== undefined && (
          <>
            , at <ShownText text={at} />
          </>
        )}
      </span>
    </div>
  );
}

/**
 * How far into a row its word can end before the row is cut: a panel of the usual width shows about
 * this many characters of code, and a word past them would be cut off with the rest.
 */
const REACH = 28;
/** How much of the line before the word stays, once the row starts at the word. */
const BEFORE = 10;

/**
 * A row's text split around its word, with its indentation dropped. A word further along than a
 * row can show would be cut off, so the row starts a little before it, at the start of a word of
 * its own and marked with an ellipsis.
 */
export function around(row: Pick<ReferenceRow, 'text' | 'match'>): {
  before: string;
  word: string;
  after: string;
} {
  // Only spaces and tabs are indentation: a format character there is part of the line.
  const lead = /^[ \t]*/.exec(row.text)?.[0].length ?? 0;
  const text = row.text.slice(lead);
  const from = Math.min(Math.max(row.match.from - lead, 0), text.length);
  const to = Math.min(Math.max(row.match.to - lead, from), text.length);
  let start = to > REACH ? Math.max(0, from - BEFORE) : 0;
  // Not in the middle of a word: back to where it starts, as far as the context was to go.
  for (let back = 0; back < BEFORE && start > 0; back += 1) {
    if (!/^\w{2}$/.test(text.slice(start - 1, start + 1))) break;
    start -= 1;
  }
  return {
    before: `${start > 0 ? '…' : ''}${text.slice(start, from)}`,
    word: text.slice(from, to),
    after: text.slice(to),
  };
}

export interface ReferencesListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  groups: readonly ReferencesGroup[];
  /** The reference on screen, by key: the one at the cursor, if it is one. */
  current?: string | undefined;
  /** The reference the keyboard is on, by key. */
  focused?: string | undefined;
  /** A row was clicked: its key. */
  onGo?: ((key: string) => void) | undefined;
  /** What shows when there are no references, such as why. */
  empty?: ReactNode;
  /** The list itself, which takes focus. */
  listRef?: Ref<HTMLDivElement> | undefined;
}

function GroupHead({ group }: { group: ReferencesGroup }) {
  return (
    <div
      role="presentation"
      className="flex items-center gap-6 ps-16 pe-12 pt-12 pb-4 text-fg-muted code-small"
    >
      <FileIcon />
      <PathName path={group.path} />
      <span className="ms-auto tree-badge">{group.rows.length}</span>
    </div>
  );
}

/**
 * The references panel's rows: a group for each file, with the line of each reference and its
 * text, the word marked. It's one focusable element, as the threads panel's list is: the reference
 * the keyboard is on is its active descendant. With no reference to list it stays, with `empty` in
 * it, so focus isn't lost when the references go.
 */
export function ReferencesList({
  groups,
  current,
  focused,
  onGo,
  empty,
  listRef,
  className = '',
  ...rest
}: ReferencesListProps) {
  const prefix = useId();
  const rows = groups.flatMap((group) => group.rows);
  const rowId = (key: string | undefined) =>
    `${prefix}-row-${rows.findIndex((row) => row.key === key)}`;
  return (
    <div
      ref={listRef}
      // With nothing to list it's a group holding the message, not a listbox without options. It's
      // the same element either way, so a list that has focus when the references go keeps it.
      role={rows.length === 0 ? 'group' : 'listbox'}
      aria-label="References"
      tabIndex={0}
      aria-activedescendant={rows.some((row) => row.key === focused) ? rowId(focused) : undefined}
      className={`group/list flex flex-col pb-12 ${className}`}
      {...rest}
    >
      {rows.length === 0 && empty !== undefined && (
        <div className="px-16 py-8 text-fg-muted text-small">{empty}</div>
      )}
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <div
            key={group.key}
            role="group"
            aria-label={showFormat(group.path)}
            className="flex flex-col"
          >
            <GroupHead group={group} />
            {group.rows.map((row) => {
              const { before, word, after } = around(row);
              return (
                <div
                  key={row.key}
                  id={rowId(row.key)}
                  role="option"
                  aria-selected={row.key === focused}
                  aria-current={row.key === current ? 'true' : undefined}
                  data-key={row.key}
                  className={`mx-6 refs-item cursor-default gap-8 rounded-sm px-8 py-2 text-fg code-small hover:bg-hover ${row.key === current ? 'bg-current-strong' : ''} ${row.key === focused ? 'group-focus-visible/list:shadow-ring-inset' : ''}`}
                  onClick={() => onGo?.(row.key)}
                >
                  <span className="lo-num text-end text-code-gutter">{row.line}</span>
                  <span className="min-w-0 truncate">
                    <ShownText text={before} />
                    <mark className="rounded-xs bg-code-bracket text-inherit ring-1 ring-accent-line">
                      <ShownText text={word} />
                    </mark>
                    <ShownText text={after} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
