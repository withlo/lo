import { cva } from 'class-variance-authority';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { Key } from './Key.tsx';
import { Spinner } from './Spinner.tsx';
import { Tag } from './Tag.tsx';
import { ThreadCount } from './ThreadCount.tsx';

declare module 'react' {
  interface CSSProperties {
    /** A tree row's depth, which indents it. */
    '--depth'?: number;
  }
}

/** How a pull request changes a file: added, deleted, modified, renamed, or a path that changed type. */
export type FileTreeChange = 'added' | 'deleted' | 'modified' | 'renamed' | 'typeChanged';

/** A changed file's viewed mark: viewed, not yet, or changed since it was viewed. */
export type FileTreeViewed = 'viewed' | 'unviewed' | 'dismissed';

/** A folder, or a chain of folders with one folder in each, on one row. */
export interface FileTreeFolder {
  kind: 'folder';
  key: string;
  /** The chain's names, outermost first: one for a folder alone. */
  names: readonly string[];
  depth: number;
  open: boolean;
  /** How many changed files it holds, however deep. A closed folder shows it. */
  changes: number;
  /** Open, with what's in it still on its way. */
  loading?: boolean | undefined;
}

/** A file, symlink or submodule. */
export interface FileTreeFile {
  kind: 'file';
  key: string;
  name: string;
  depth: number;
  entry: 'file' | 'symlink' | 'submodule';
  /** How the pull request changes it; nothing for an unchanged file, which shows dimmed. */
  change?: FileTreeChange | undefined;
  /** A rename's old name, or old path. */
  previous?: string | undefined;
  /** Generated or a lockfile. */
  generated?: boolean | undefined;
  viewed?: FileTreeViewed | undefined;
  /** Its review threads on screen: how many, and how many of them are unresolved. */
  threads?: { total: number; unresolved: number } | undefined;
  /** In review order, the folder it's in, after its name. */
  folder?: string | undefined;
  /** The whole path, as the name's tooltip, when the name shows only part of it. */
  title?: string | undefined;
  /** While two revisions are compared, whether it changed between them. */
  hit?: boolean | undefined;
}

/** A label over a group of files, in review order. */
export interface FileTreeGroup {
  kind: 'group';
  key: string;
  label: string;
}

export type FileTreeRow = FileTreeFolder | FileTreeFile | FileTreeGroup;

const LETTERS: Record<FileTreeChange, { letter: string; tone: string; word: string }> = {
  added: { letter: 'A', tone: 'text-change-added', word: 'Added' },
  deleted: { letter: 'D', tone: 'text-change-deleted', word: 'Deleted' },
  modified: { letter: 'M', tone: 'text-change-modified', word: 'Modified' },
  renamed: { letter: 'R', tone: 'text-change-renamed', word: 'Renamed' },
  typeChanged: { letter: 'T', tone: 'text-change-modified', word: 'Changed type' },
};

const BALLS: Record<FileTreeViewed, { className: string; title: string }> = {
  viewed: { className: 'ball ball-viewed', title: 'Viewed' },
  unviewed: { className: 'ball', title: 'Not viewed' },
  dismissed: { className: 'ball ball-stale', title: 'Changed since you viewed it' },
};

const row = cva(
  'relative flex h-row-h items-center gap-6 rounded-sm tree-row whitespace-nowrap text-small hover:bg-hover',
  {
    variants: {
      tone: {
        changed: 'text-fg',
        dim: 'text-fg-dim',
        viewed: 'text-fg-muted',
      },
      current: { true: 'tree-current', false: '' },
      // Only while the tree itself has keyboard focus: a click gives it focus too, with no ring.
      focused: { true: 'group-focus-visible/tree:shadow-ring-inset', false: '' },
    },
  },
);

/** The twisty of a folder: it turns down when the folder opens. */
function Twisty({ open }: { open: boolean }) {
  return (
    <svg
      className={`lo-i lo-i--xs text-fg-subtle transition-transform ease-out ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function FolderIcon({ open, dim }: { open: boolean; dim: boolean }) {
  return (
    <svg
      className={`lo-i lo-i--sm ${dim ? 'text-fg-disabled' : 'text-icon-muted'}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M1.75 12V4.25c0-.69.56-1.25 1.25-1.25h2.9l1.5 1.5H12c.69 0 1.25.56 1.25 1.25V7" />
          <path d="M1.75 12 3.7 7.65c.2-.4.6-.65 1.05-.65h9c.5 0 .85.52.66.98l-1.55 3.77c-.2.47-.65.78-1.16.78H2.25" />
        </>
      ) : (
        <path d="M1.75 4.25c0-.69.56-1.25 1.25-1.25h2.9l1.5 1.5H13c.69 0 1.25.56 1.25 1.25v6.25c0 .69-.56 1.25-1.25 1.25H3c-.69 0-1.25-.56-1.25-1.25Z" />
      )}
    </svg>
  );
}

/** A file's icon: a page, with a mark for a symlink or a submodule. */
export function FileIcon({
  entry = 'file',
  dim = false,
}: {
  entry?: FileTreeFile['entry'];
  /** Set back, as an unchanged file is beside changed ones. */
  dim?: boolean;
}) {
  return (
    <svg
      className={`lo-i lo-i--sm ${dim ? 'text-fg-disabled' : 'text-icon-muted'}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M4.5 1.75h4.75l3 3v8.75c0 .41-.34.75-.75.75h-7c-.41 0-.75-.34-.75-.75V2.5c0-.41.34-.75.75-.75Z" />
      <path d="M9 1.75V5h3.25" />
      {entry === 'symlink' && <path d="M6.25 11.25 9.75 7.75M7.25 7.75h2.5v2.5" />}
      {entry === 'submodule' && <path d="M6 9.5h4M6 11.5h4" />}
    </svg>
  );
}

/**
 * A changed file's marks: that it's generated, how the pull request changes it and whether it's
 * viewed, as the tree and the file finder show them.
 */
export function FileMarks({
  change,
  viewed,
  generated = false,
}: {
  change: FileTreeChange;
  viewed?: FileTreeViewed | undefined;
  generated?: boolean | undefined;
}) {
  const letter = LETTERS[change];
  const ball = viewed && BALLS[viewed];
  return (
    <>
      {generated && <Tag>gen</Tag>}
      <span className={`change-letter ${letter.tone}`} title={letter.word}>
        {letter.letter}
      </span>
      {ball && <span className={ball.className} title={ball.title} />}
    </>
  );
}

/** Each row's height, in pixels: the design's `lo-row-h`. Rows are drawn only near the view. */
export const ROW_HEIGHT = 24;

/** Rows drawn beyond each end of what's in view, so scrolling never shows a gap. */
const OVERSCAN = 12;

export interface FileTreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  rows: readonly FileTreeRow[];
  /** The row the keyboard is on, by key. */
  focused?: string | undefined;
  /** The file on screen, by key. */
  current?: string | undefined;
  /** A row was clicked: its key, and whether the click was on a folder's twisty. */
  onRowClick?: ((key: string, twisty: boolean) => void) | undefined;
  /** A right-click on a file's row. */
  onFileMenu?: ((key: string, event: MouseEvent<HTMLElement>) => void) | undefined;
  /** Scrolls the row with this key into view, each time the count changes. */
  reveal?: { key: string; count: number } | undefined;
  /**
   * Whether two revisions are compared: the files that changed between them stand out, and the
   * pull request's other changes step back.
   */
  comparing?: boolean | undefined;
  /** The scrolling element, which is the tree and takes focus. */
  treeRef?: Ref<HTMLDivElement> | undefined;
}

function treeItemId(prefix: string, index: number): string {
  return `${prefix}-row-${index}`;
}

/**
 * The file tree's rows: folders with their twisties and changed-file counts, files with their
 * marks, and in review order, groups' labels. It's one focusable element with `role="tree"`: the
 * row the keyboard is on is its active descendant, and only rows near the view are drawn.
 */
export function FileTree({
  rows,
  focused,
  current,
  onRowClick,
  onFileMenu,
  reveal,
  comparing = false,
  treeRef,
  className = '',
  ...rest
}: FileTreeProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const shown = useRef(rows);
  shown.current = rows;
  const [view, setView] = useState({ top: 0, height: 0 });
  const [hasFocus, setHasFocus] = useState(false);
  const [prefix] = useState(() => `lo-tree-${Math.random().toString(36).slice(2, 8)}`);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return undefined;
    const measure = () => setView({ top: element.scrollTop, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Brings a row into view when asked.
  useEffect(() => {
    const element = scroller.current;
    if (!element || reveal === undefined) return;
    const index = shown.current.findIndex((each) => each.key === reveal.key);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
    }
    setView({ top: element.scrollTop, height: element.clientHeight });
  }, [reveal]);

  // A tree too short to measure (or measured before it's laid out) draws a screenful.
  const height = view.height > 0 ? view.height : ROW_HEIGHT * 40;
  const first = Math.max(0, Math.floor(view.top / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((view.top + height) / ROW_HEIGHT) + OVERSCAN);
  const focusedIndex = focused === undefined ? -1 : rows.findIndex((each) => each.key === focused);

  const setRefs = (element: HTMLDivElement | null) => {
    scroller.current = element;
    if (typeof treeRef === 'function') treeRef(element);
    else if (treeRef) treeRef.current = element;
  };

  return (
    <div
      ref={setRefs}
      role="tree"
      tabIndex={0}
      aria-activedescendant={focusedIndex < 0 ? undefined : treeItemId(prefix, focusedIndex)}
      className={`group/tree relative min-h-0 flex-1 overflow-auto px-6 pb-12 outline-none ${className}`}
      onScroll={(event) =>
        setView({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })
      }
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
      {...rest}
    >
      <div className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.slice(first, last).map((each, offset) => {
          const index = first + offset;
          return (
            <div key={each.key} className="absolute inset-x-0" style={{ top: index * ROW_HEIGHT }}>
              <Row
                row={each}
                id={treeItemId(prefix, index)}
                focused={hasFocus && index === focusedIndex}
                current={each.key === current}
                comparing={comparing}
                onClick={onRowClick}
                onFileMenu={onFileMenu}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Row({
  row: each,
  id,
  focused,
  current,
  comparing,
  onClick,
  onFileMenu,
}: {
  row: FileTreeRow;
  id: string;
  focused: boolean;
  current: boolean;
  comparing: boolean;
  onClick?: ((key: string, twisty: boolean) => void) | undefined;
  onFileMenu?: ((key: string, event: MouseEvent<HTMLElement>) => void) | undefined;
}): ReactNode {
  if (each.kind === 'group') {
    return (
      <div
        role="presentation"
        className="flex h-row-h items-end px-8 pb-2 label-caps text-fg-muted text-label"
      >
        {each.label}
      </div>
    );
  }
  if (each.kind === 'folder') {
    const dim = each.changes === 0;
    return (
      <div
        id={id}
        role="treeitem"
        aria-level={each.depth + 1}
        aria-expanded={each.open}
        aria-selected={focused}
        data-key={each.key}
        className={row({ tone: dim ? 'dim' : 'changed', current: false, focused })}
        style={{ '--depth': each.depth }}
        onClick={(event) => {
          const twisty = event.target instanceof Element && event.target.closest('svg') !== null;
          onClick?.(each.key, twisty);
        }}
      >
        <Twisty open={each.open} />
        <FolderIcon open={each.open} dim={dim} />
        <span className="min-w-0 overflow-hidden text-ellipsis">
          {each.names.map((name, index) => (
            <span key={index}>
              {index > 0 && <span className="px-2 text-fg-subtle">/</span>}
              {name}
            </span>
          ))}
        </span>
        <span className="ms-auto flex flex-none items-center gap-6 ps-6">
          {each.loading && <Spinner size="xs" />}
          {!each.open && each.changes > 0 && (
            <span
              className="tree-badge"
              title={`${each.changes} changed ${each.changes === 1 ? 'file' : 'files'}`}
            >
              {each.changes}
            </span>
          )}
        </span>
      </div>
    );
  }
  const dim = each.change === undefined;
  // Comparing two revisions, the pull request's changes that aren't between them step back.
  const aside = comparing && !dim && each.hit !== true;
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={each.depth + 1}
      aria-selected={focused}
      aria-current={current ? 'true' : undefined}
      aria-description={
        comparing && each.hit ? 'Changed between the revisions compared' : undefined
      }
      data-key={each.key}
      data-hit={comparing && each.hit ? '' : undefined}
      className={row({
        tone: dim || aside ? 'dim' : each.viewed === 'viewed' ? 'viewed' : 'changed',
        current,
        focused,
      })}
      style={{ '--depth': each.depth }}
      onClick={() => onClick?.(each.key, false)}
      onContextMenu={(event) => onFileMenu?.(each.key, event)}
    >
      <span className="lo-i lo-i--xs" aria-hidden="true" />
      <FileIcon entry={each.entry} dim={dim} />
      <span
        className={`min-w-0 overflow-hidden text-ellipsis ${each.change === 'deleted' ? 'text-fg-muted line-through decoration-fg-subtle' : ''}`}
        title={each.title}
      >
        {each.name}
      </span>
      {each.folder !== undefined && each.folder !== '' && (
        <span className="min-w-0 shrink-first overflow-hidden text-ellipsis text-fg-muted text-micro">
          {each.folder}
        </span>
      )}
      {each.previous !== undefined && (
        <span
          className="min-w-0 shrink-first overflow-hidden text-ellipsis text-fg-muted text-micro"
          title={`Renamed from ${each.previous}`}
        >
          ← {each.previous}
        </span>
      )}
      <span
        className={`ms-auto flex flex-none items-center gap-6 ps-6 ${aside ? 'opacity-45' : ''}`}
      >
        {each.threads && (
          <ThreadCount total={each.threads.total} unresolved={each.threads.unresolved} />
        )}
        {each.change && (
          <FileMarks change={each.change} viewed={each.viewed} generated={each.generated} />
        )}
      </span>
      {comparing && each.hit && (
        <span
          className="absolute -end-4 top-6 bottom-6 w-2 rounded-xs bg-accent"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export interface FileTreePanelProps {
  /** How many of the changed files are viewed, of how many, once GitHub has said. */
  viewed?: { viewed: number; total: number } | undefined;
  /** Whether the files show as the tree, or the changed ones in review order. */
  mode: 'tree' | 'review';
  onMode?: ((mode: 'tree' | 'review') => void) | undefined;
  /** The key that switches between them, as this system shows it. */
  modeKeys?: readonly string[] | undefined;
  changedOnly: boolean;
  onChangedOnly?: ((changedOnly: boolean) => void) | undefined;
  changedOnlyKeys?: readonly string[] | undefined;
  /** A note over the files, such as why only the changed files show. */
  note?: ReactNode;
  /** The tree. */
  children?: ReactNode;
}

const segment = cva(
  'inline-flex h-20 items-center rounded-pill px-8 text-small-medium whitespace-nowrap focus-visible:shadow-ring',
  {
    variants: {
      pressed: {
        true: 'bg-bg-element text-fg ring-1 ring-border-strong',
        false: 'text-fg-muted hover:text-fg',
      },
    },
  },
);

/**
 * The left panel's files: its head with the viewed count, the switch between the tree and review
 * order and the "Changed only" chip, each with its key, then any note, then the tree.
 */
export function FileTreePanel({
  viewed,
  mode,
  onMode,
  modeKeys,
  changedOnly,
  onChangedOnly,
  changedOnlyKeys,
  note,
  children,
}: FileTreePanelProps) {
  return (
    <section aria-label="Files" className="flex min-h-0 flex-1 flex-col bg-bg-chrome">
      <div className="flex flex-none items-center gap-6 ps-16 pe-8 pt-12 pb-8">
        <h2 className="label-caps text-fg-muted text-label">Files</h2>
        {viewed && (
          <span className="ms-auto text-fg-muted text-small">
            <span className="lo-num">
              {viewed.viewed} / {viewed.total}
            </span>{' '}
            viewed
          </span>
        )}
      </div>
      <div className="flex flex-none items-center gap-6 ps-12 pe-8 pb-8">
        <div
          role="group"
          aria-label="File list"
          className="inline-flex items-center gap-2 rounded-pill bg-bg-well p-2 inset-ring inset-ring-border"
        >
          <button
            type="button"
            aria-pressed={mode === 'tree'}
            className={segment({ pressed: mode === 'tree' })}
            onClick={() => onMode?.('tree')}
          >
            Tree
          </button>
          <button
            type="button"
            aria-pressed={mode === 'review'}
            className={segment({ pressed: mode === 'review' })}
            onClick={() => onMode?.('review')}
          >
            Review order
          </button>
        </div>
        {modeKeys && <Key keys={modeKeys} decorative />}
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={changedOnly}
          className={`inline-flex h-control-h-sm items-center gap-4 rounded-pill px-8 text-small-medium whitespace-nowrap focus-visible:shadow-ring ${changedOnly ? 'bg-accent-soft text-fg-accent inset-ring inset-ring-accent-line' : 'text-fg-muted inset-ring inset-ring-border hover:bg-hover hover:text-fg'}`}
          onClick={() => onChangedOnly?.(!changedOnly)}
        >
          <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 3.5h11l-4.25 5v3.75L6.75 13.5V8.5Z" />
          </svg>
          Changed only
        </button>
        {changedOnlyKeys && <Key keys={changedOnlyKeys} decorative />}
      </div>
      {note !== undefined && note !== null && (
        <div
          role="note"
          className="mx-8 mb-8 flex-none rounded-sm bg-hover px-8 py-8 text-fg-muted text-small"
        >
          {note}
        </div>
      )}
      {children}
    </section>
  );
}
