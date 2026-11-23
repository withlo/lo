import { cva } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode, Ref } from 'react';

import { withoutBidi, withoutBidiNode } from './controls.ts';
import { LinkButton } from './LinkButton.tsx';
import { Spinner } from './Spinner.tsx';
import { StateIcon } from './StatePill.tsx';
import { Tooltip } from './Tooltip.tsx';

/**
 * How a row stands, which tints its icon: `fail` is in the way and waiting won't fix it, `wait`
 * is in the way and waiting may, `ok` is as it should be, `todo` hasn't begun, and `info` is only
 * to know.
 */
export type CheckKind = 'fail' | 'wait' | 'ok' | 'todo' | 'info';

/** What a row's icon draws: the thing a reason is about. */
export type CheckGlyph =
  | 'ok'
  | 'review'
  | 'failed'
  | 'running'
  | 'pending'
  | 'conversation'
  | 'behind'
  | 'conflict'
  | 'draft'
  | 'rule'
  | 'unknown';

/** A link that opens a page of GitHub's, such as a check's run. */
export interface CheckLink {
  /** What it says, ending in `↗`: "Open the run ↗". */
  label: string;
  onOpen: () => void;
}

/** One check or reason a row is about, under it: its name, how it stands, and where to open it. */
export interface CheckSub {
  /** What tells it from the others, for React. */
  key: string;
  /** The check's name, in code type: "test (node 20)". */
  name: string;
  /** How it stands, at the end: "3 failed of 412", "6 min". */
  note?: string | undefined;
  /** `fail` draws the note in the failing color; otherwise it's quiet. */
  tone?: 'fail' | 'quiet' | undefined;
  link?: CheckLink | undefined;
}

/** One reason, step or result. */
export interface CheckItem {
  /** What tells it from the others, and names its id: see {@link checkRowId}. */
  key: string;
  kind: CheckKind;
  glyph: CheckGlyph;
  /**
   * What it is, in a few words: "Review required", "2 checks running". Text is drawn without the
   * characters that turn text around; what's built from elements is the caller's to clean.
   */
  title: ReactNode;
  /** More: who or what is involved, and what fixes it. Cleaned as the title is. */
  detail?: ReactNode;
  /**
   * The page where it's mended, as a link of its own under the detail: "See it on GitHub ↗". It's
   * what a key that opens the row's page opens.
   */
  link?: CheckLink | undefined;
  /** The checks or reasons it holds, one under another, each linked to where it's fixed. */
  subs?: readonly CheckSub[] | undefined;
  /** At its end: people, or a button for what to do about it, with its key. */
  end?: ReactNode;
}

export interface ChecklistProps extends Omit<
  HTMLAttributes<HTMLUListElement>,
  'children' | 'role' | 'aria-label' | 'aria-activedescendant'
> {
  /** What the list is, for screen readers: "Why it can't merge". */
  label: string;
  /** What its rows' ids start with, so that no two lists on a page share one: see {@link checkRowId}. */
  id: string;
  rows: readonly CheckItem[];
  /**
   * The row the keyboard is on, by key: the list names it as its active descendant and rings it
   * while the list has keyboard focus. A key that is none of the rows names no row.
   */
  focused?: string | undefined;
  /** The list itself, which takes focus: give it to a panel to focus as it opens. */
  listRef?: Ref<HTMLUListElement> | undefined;
}

/** The id of the row with this key in the list with this `id`, for an `aria-activedescendant`. */
export function checkRowId(list: string, key: string): string {
  return `${list}-row-${key}`;
}

const row = cva('check-row grid items-start', {
  variants: {
    focused: { true: 'group-focus-visible/list:shadow-ring-inset', false: '' },
  },
});

const icon = cva('flex-none', {
  variants: {
    kind: {
      fail: 'text-danger',
      wait: 'text-warning',
      ok: 'text-success',
      todo: 'text-fg-dim',
      info: 'text-fg-muted',
    },
  },
});

/** The shapes of an icon, for an `svg` on a 16 grid. */
function Shape({ glyph }: { glyph: Exclude<CheckGlyph, 'running' | 'pending' | 'draft'> }) {
  switch (glyph) {
    case 'ok':
      return <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />;
    case 'review':
      return (
        <>
          <circle cx="8" cy="5.25" r="2.75" />
          <path d="M3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
        </>
      );
    case 'failed':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
        </>
      );
    case 'conversation':
      return (
        <path d="M2.75 3.25c0-.55.45-1 1-1h8.5c.55 0 1 .45 1 1v6.5c0 .55-.45 1-1 1H7.5L4.75 13v-2.25h-1c-.55 0-1-.45-1-1Z" />
      );
    case 'behind':
      return (
        <>
          <path d="M13 3.5v3h-3M3 12.5v-3h3" />
          <path d="M12.6 6.5A5 5 0 0 0 3.6 5.2M3.4 9.5a5 5 0 0 0 9 1.3" />
        </>
      );
    case 'conflict':
      return (
        <>
          <path d="M5 2.5v6.5a2 2 0 0 0 2 2h4M11 11l-2-2M11 11l-2 2" />
          <circle cx="5" cy="13" r="1.25" />
        </>
      );
    case 'rule':
      return <path d="M8 1.75 13 3.5v4c0 3.2-2.1 5.6-5 6.75C5.1 13.1 3 10.7 3 7.5v-4Z" />;
    case 'unknown':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.25 6.25a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.75.6-.75 1.15M8 11.25v.01" />
        </>
      );
    default:
      glyph satisfies never;
      throw new Error(`A checklist icon Lo doesn't know: ${String(glyph)}.`);
  }
}

/**
 * A row's icon. A check still running is a ring turning, and one that hasn't reported a hollow
 * ball, as the design draws "not yet".
 */
export function CheckIcon({ glyph }: { glyph: CheckGlyph }) {
  if (glyph === 'running') return <Spinner />;
  if (glyph === 'pending') {
    return (
      <span className="inline-block size-12 flex-none rounded-pill hollow" aria-hidden="true" />
    );
  }
  return (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      {glyph === 'draft' ? <StateIcon state="draft" /> : <Shape glyph={glyph} />}
    </svg>
  );
}

/** The words of a link's label without its arrow, for a screen reader to say with the check's name. */
function said(link: CheckLink, name: string): string {
  return `${link.label.replace(/\s*↗$/, '')}: ${withoutBidi(name)}`;
}

function Sub({ sub }: { sub: CheckSub }) {
  const name = withoutBidi(sub.name);
  return (
    <li className="flex items-center gap-8 text-fg text-small">
      <Tooltip label={name} cut>
        <span className="min-w-0 flex-1 truncate code-small">{name}</span>
      </Tooltip>
      {sub.note !== undefined && (
        <span
          className={`lo-num flex-none ${sub.tone === 'fail' ? 'text-danger' : 'text-fg-muted'}`}
        >
          {sub.note}
        </span>
      )}
      {sub.link !== undefined && (
        <LinkButton onClick={sub.link.onOpen} label={said(sub.link, sub.name)}>
          {sub.link.label}
        </LinkButton>
      )}
    </li>
  );
}

/**
 * Rows of reasons, steps or progress, one thing each: why a pull request can't merge, what a
 * merge waits for. A row has an icon in the color of how it stands, a title, a line of detail,
 * the checks it holds as sub-rows, each linked to where it's fixed, and an action at its end.
 *
 * It's a listbox that holds focus itself, as the timeline and the references are, with the row the
 * keyboard is on as its active descendant, and a ring on that row while it has keyboard focus.
 * Focus is where the keyboard is, not what's current or selected, so no row says it's either. Like
 * the other lists it takes what a focusable list takes: a ref, a key handler and the rest.
 */
export function Checklist({
  label,
  id,
  rows,
  focused,
  listRef,
  className = '',
  ...rest
}: ChecklistProps) {
  const active = focused !== undefined && rows.some((item) => item.key === focused);
  return (
    <ul
      ref={listRef}
      // With nothing to list it's a group holding nothing, not a listbox without options.
      role={rows.length === 0 ? 'group' : 'listbox'}
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={active ? checkRowId(id, focused) : undefined}
      {...rest}
      className={`group/list m-0 flex list-none flex-col p-0 ${className}`}
    >
      {rows.map((item) => (
        <li
          key={item.key}
          id={checkRowId(id, item.key)}
          role="option"
          data-key={item.key}
          data-kind={item.kind}
          data-focused={item.key === focused ? '' : undefined}
          className={row({ focused: item.key === focused })}
        >
          <span className={icon({ kind: item.kind })}>
            <CheckIcon glyph={item.glyph} />
          </span>
          <span className="min-w-0 text-fg text-ui-strong">{withoutBidiNode(item.title)}</span>
          {item.detail !== undefined && (
            <span className="col-start-2 min-w-0 text-fg-muted text-small">
              {withoutBidiNode(item.detail)}
            </span>
          )}
          {item.link !== undefined && (
            <span className="col-start-2 flex min-w-0">
              <LinkButton
                onClick={item.link.onOpen}
                label={
                  typeof item.title === 'string'
                    ? said(item.link, item.title)
                    : item.link.label.replace(/\s*↗$/, '')
                }
              >
                {item.link.label}
              </LinkButton>
            </span>
          )}
          {item.subs !== undefined && item.subs.length > 0 && (
            <ul className="col-start-2 m-0 mt-6 flex list-none flex-col gap-4 p-0">
              {item.subs.map((sub) => (
                <Sub key={sub.key} sub={sub} />
              ))}
            </ul>
          )}
          {item.end !== undefined && (
            <span className="col-start-3 row-span-2 row-start-1 flex items-center gap-6">
              {item.end}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
