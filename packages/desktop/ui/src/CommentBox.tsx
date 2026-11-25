import { cva } from 'class-variance-authority';
import {
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react';

import { Avatar } from './Avatar.tsx';
import type { BannerAction } from './Banner.tsx';
import { Button } from './Button.tsx';
import { useGiveUp } from './giveUp.ts';
import { onVim, vimOn } from './vim.ts';
import { Key } from './Key.tsx';
import { Meter } from './Meter.tsx';
import { useDetails } from './Problem.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';
import { Spinner } from './Spinner.tsx';

/** The acting account, which the box shows and never chooses. */
export interface CommentBoxAccount {
  login: string;
  image?: string | undefined;
}

export interface CommentBoxHead {
  /** Write or Preview was chosen: whether it's the preview. */
  onPreviewing?: ((previewing: boolean) => void) | undefined;
  /** The key that toggles them, as this system shows it. */
  previewKeys?: readonly string[] | undefined;
  /**
   * What the comment is on, as a label: "Line 3", "Lines 39–41", "Line 3, removed", "File",
   * "Pull request", "Reply", "Edit", "Summary".
   */
  where?: ReactNode;
  /**
   * Why it's on that and not on what was picked, one quiet line under the head: "Those lines aren’t
   * in the diff."
   */
  why?: ReactNode;
  /** Who it's from. Give it only while more than one account is signed in. */
  account?: CommentBoxAccount | undefined;
  /** Closes the box, keeping its draft. A box that never closes has none. */
  close?: CommentBoxClose | undefined;
  /** Write | Preview can't be changed now, as while the box's comment is sent: it's dimmed. */
  held?: boolean | undefined;
}

/** The control that closes a box. */
export interface CommentBoxClose {
  /** The key that closes it, as this system shows it. */
  keys?: readonly string[] | undefined;
  onClick: () => void;
}

/** A note over the editor: a restored draft, why a send was refused, or what to know about uploads. */
export interface CommentBoxNote {
  /** What identifies it. */
  key: string;
  /**
   * `danger` for what failed, `warning` for what needs care, as a send nobody can confirm; `info`
   * for the rest.
   */
  tone: 'info' | 'warning' | 'danger';
  /** In place of the tone's own: a clock for a restored draft, a cross for a refusal. */
  icon?: 'clock' | 'blocked' | undefined;
  /**
   * What went wrong, for one that says so: "Couldn’t send the comment". It has a line of its own,
   * and `text`, why, is under it, if there's any.
   */
  title?: string | undefined;
  text?: ReactNode;
  /** What it offers to do, each starting with a verb: "Show latest", "Comment on file". */
  actions?: readonly BannerAction[] | undefined;
  /**
   * What came back, as it came, for one that says what failed: GitHub's own words, a read's error.
   * It stays behind a Details button, with Copy, as a `Problem`'s does.
   */
  details?: string | undefined;
}

/** A quiet line over the foot's buttons, such as a restored draft's "Draft from 12 min ago". */
export interface CommentBoxLine {
  /** What identifies it. */
  key: string;
  text: ReactNode;
  /** The one thing it offers to do. */
  action?: BannerAction | undefined;
}

/** One file in the box, uploading or uploaded. Its row is as tall in each. */
export interface CommentBoxUpload {
  key: string;
  name: string;
  /** As the row says it: "3.4 MB". */
  size: string;
  /**
   * How far it is, from 0 to 1, while it uploads. Without it the row says only that it's
   * uploading, since not every upload can report how far.
   */
  progress?: number | undefined;
  uploaded?: boolean | undefined;
  onCancel?: (() => void) | undefined;
  /**
   * For a file uploaded whose placeholder went from the text meanwhile, so it isn't in the comment:
   * "Insert" puts it at the cursor.
   */
  onInsert?: (() => void) | undefined;
}

/** The editor's Vim mode, as its chip names it. */
export interface CommentBoxMode {
  /** `NORMAL`, `INSERT`, `VISUAL`, `V-LINE`. */
  name: string;
  kind: 'normal' | 'insert' | 'visual';
}

export interface CommentBoxAttach {
  /** The key that opens the file picker, as this system shows it. */
  keys?: readonly string[] | undefined;
  /** It can't be used here. */
  disabled?: boolean | undefined;
  /** Why it can't, as its tooltip says while it's off: "Sign in to attach files". */
  why?: string | undefined;
  onClick?: (() => void) | undefined;
}

/** The control that discards a box's draft and closes it. */
export interface CommentBoxDiscard {
  /** There's nothing to discard, or it can't be discarded now. */
  disabled?: boolean | undefined;
  /** Why it can't, as its tooltip says while it's off. */
  why?: string | undefined;
  onClick?: (() => void) | undefined;
}

/** A button at the end of the foot. */
export interface CommentBoxAction {
  label: string;
  keys?: readonly string[] | undefined;
  /** The box's main button: one at most. */
  primary?: boolean | undefined;
  /** It can't be pressed now. */
  disabled?: boolean | undefined;
  /**
   * Why it can't, as its tooltip says while it's off: "Offline", "Write a comment first". The box
   * has no line for it.
   */
  why?: string | undefined;
  /** It's doing what it was pressed for. */
  busy?: boolean | undefined;
  /** What it says while busy: "Sending…", "Saving…". */
  working?: string | undefined;
  /**
   * Its icon, which it's drawn as alone, with its label as its tooltip, in a box too narrow for its
   * words. One without keeps its words.
   */
  icon?: 'send' | 'review' | 'save' | undefined;
  onClick?: (() => void) | undefined;
}

export interface CommentBoxFoot {
  /** The editor's Vim mode. Its chip shows only with Vim keys on, in the box that has focus. */
  mode?: CommentBoxMode | undefined;
  /** A hint beside the controls, the second thing a narrow foot gives up, after its key chips. */
  text?: ReactNode;
  attach?: CommentBoxAttach | undefined;
  discard?: CommentBoxDiscard | undefined;
  /** Quiet lines over the buttons. */
  lines?: readonly CommentBoxLine[] | undefined;
  /** The secondary button first, then the main one. */
  actions?: readonly CommentBoxAction[] | undefined;
}

export interface CommentBoxProps {
  /**
   * The editor. The code view hosts it, so this is only where it goes. It stays in the box, out of
   * sight, while the preview shows, so nothing in it is lost.
   */
  children: ReactNode;
  /** What the box is, for screen readers: "New comment", "Reply". */
  label?: string | undefined;
  /** The editor has focus: the box takes the focus ring, and shows its mode with Vim keys on. */
  focused?: boolean | undefined;
  head?: CommentBoxHead | undefined;
  notes?: readonly CommentBoxNote[] | undefined;
  uploads?: readonly CommentBoxUpload[] | undefined;
  /** The rendered Markdown, which shows while `previewing`. */
  preview?: ReactNode;
  /** The preview shows in place of the editor, and the head's switch says Preview. */
  previewing?: boolean | undefined;
  /** Files are being dragged over it: how many. */
  dropping?: number | undefined;
  foot?: CommentBoxFoot | undefined;
  /** More classes for the box, such as the space the code view leaves around it. */
  className?: string | undefined;
  /**
   * The box's element, for whoever answers for its keys. It's the `box` scope: its head, preview
   * and foot are in it as well as the editor, so keys keep working wherever focus is in the box.
   */
  frameRef?: Ref<HTMLDivElement> | undefined;
}

const box = cva('overflow-hidden rounded-md bg-bg-raised text-ui', {
  variants: {
    focused: { true: 'shadow-ring', false: 'ring-1 ring-border' },
  },
});

const note = cva(
  'flex flex-wrap gap-x-8 border-b border-border-subtle px-12 py-6 text-fg text-small',
  {
    variants: {
      tone: { info: 'bg-info-bg', warning: 'bg-warning-bg', danger: 'bg-danger-bg' },
      // With a title, why is on a line under it, and the icon and buttons stay on the title's line.
      titled: { true: 'items-start', false: 'items-center' },
    },
  },
);

const noteIcon = cva('flex-none', {
  variants: {
    tone: { info: 'text-info', warning: 'text-warning', danger: 'text-danger' },
    titled: { true: 'mt-2', false: '' },
  },
});

const mode = cva('flex-none', {
  variants: {
    kind: {
      normal: 'mode-chip mode-chip-normal',
      insert: 'mode-chip mode-chip-insert',
      visual: 'mode-chip',
    },
  },
});

/**
 * What a box's foot gives up, in order, as the box narrows, so it stays one line: its key chips;
 * the words of "Discard draft", which keeps its icon; its hint; then the actions' words, each for
 * its icon with its words as its tooltip, the filled one's last (`useGiveUp`).
 */
const FOOT_STEPS = ['keys', 'labels', 'hint', 'actions', 'fill'];

/**
 * What a box's head gives up, in order, as the box narrows: who it's from, the switch's key chip,
 * then Write's and Preview's words, each for its icon with its words as its tooltip. Only then is
 * what the comment is on cut short.
 */
const HEAD_STEPS = ['hint', 'keys', 'labels'];

/** The actions' icons, on the 16 grid. */
const ACTION_ICONS = {
  // A paper plane.
  send: 'M2.5 7.5 13.5 2.5 9 13.5 7.25 8.75 2.5 7.5ZM7.25 8.75 13.5 2.5',
  // A plus beside the lines of the review it goes in.
  review: 'M2.5 4h6M2.5 8h6M2.5 12h4M12 9v5M9.5 11.5h5',
  // A tick.
  save: 'M3 8.5 6.5 12 13 4.5',
} as const;

/** What a box's head and foot give up so far: whether each of `steps` is given up, of `given`. */
function givenUp(steps: readonly string[], given: number): (step: string) => boolean {
  return (step) => steps.indexOf(step) < given;
}

/** The icons a note takes, on the 16 grid. */
function NoteIcon({
  tone,
  icon,
  titled,
}: Pick<CommentBoxNote, 'tone' | 'icon'> & { titled: boolean }) {
  const shapes =
    icon === 'clock' ? (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 4.75V8l2 1.5" />
      </>
    ) : icon === 'blocked' ? (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
      </>
    ) : tone !== 'info' ? (
      <>
        <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
        <path d="M8 6.25v3M8 11.25v.01" />
      </>
    ) : (
      <>
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 7.25v4M8 4.75v.01" />
      </>
    );
  return (
    <svg
      className={`lo-i lo-i--sm ${noteIcon({ tone, titled })}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {shapes}
    </svg>
  );
}

/**
 * A note: what it says, and what it offers. One with a title says what went wrong on a line of its
 * own and why under it, as a `Problem` does. It's said to a screen reader by whoever shows it, as
 * it comes: it's drawn with its text, which a live region here wouldn't read.
 */
function Note({ each, id }: { each: CommentBoxNote; id?: string | undefined }) {
  const titled = each.title !== undefined;
  const { more, shown } = useDetails(each.details, 'pt-6');
  const acts = each.actions ?? [];
  return (
    <div id={id} data-note={each.tone} className={note({ tone: each.tone, titled })}>
      <NoteIcon tone={each.tone} icon={each.icon} titled={titled} />
      {titled ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <b className="font-semibold text-fg">{each.title}</b>
          {each.text !== undefined && each.text !== '' && (
            <span className="text-fg-muted">{each.text}</span>
          )}
        </span>
      ) : (
        <span className="min-w-0 flex-1">{each.text}</span>
      )}
      {(acts.length > 0 || more) && (
        // On the first line, and no taller than it.
        <span className={`flex flex-none items-center gap-6 ${titled ? 'h-1lh' : ''}`}>
          {more}
          {acts.map((action) => (
            <Button key={action.label} variant="secondary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </span>
      )}
      {/* What came back, on a row of its own under the note's words. */}
      {shown && <div className="min-w-0 basis-full">{shown}</div>}
    </div>
  );
}

/** A small picture, the mark of a file in the uploads. */
function FileIcon() {
  return (
    <svg className="lo-i lo-i--sm flex-none text-icon-muted" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.25" y="3" width="11.5" height="10" rx="1.5" />
      <path d="M2.5 11 6 7.5l3 3 2-2 2.5 2.5" />
    </svg>
  );
}

/**
 * How far an upload is, as its row says it: "Uploading · 62%" while its bytes go, and "Uploading…"
 * where that isn't known, or once they've all gone and GitHub hasn't answered: it isn't done at
 * 100%.
 */
function uploading(progress: number | undefined): { percent: number | undefined; text: string } {
  if (progress === undefined || progress >= 1) return { percent: undefined, text: 'Uploading…' };
  const percent = Math.round(Math.max(progress, 0) * 100);
  return { percent, text: `Uploading · ${percent}%` };
}

function Upload({ each }: { each: CommentBoxUpload }) {
  const going = uploading(each.progress);
  return (
    // As tall as its buttons, so it doesn't change height as it lands.
    <li className="flex h-control-h-sm items-center gap-8 text-small">
      <FileIcon />
      <span className="flex min-w-0 flex-1 items-baseline gap-6">
        <span className="truncate">{each.name}</span>
        <span className="lo-num flex-none text-fg-muted">{each.size}</span>
      </span>
      {each.uploaded === true && each.onInsert !== undefined ? (
        <>
          <span className="flex-none text-fg-muted">Not in comment</span>
          <Button variant="ghost" size="sm" onClick={each.onInsert}>
            Insert
          </Button>
        </>
      ) : each.uploaded === true ? null : (
        <>
          {going.percent === undefined ? (
            // In the meter's room where there was one, so the row's words stay where they were.
            <span
              className={
                each.progress === undefined ? 'flex-none' : 'flex w-1/4 flex-none justify-end'
              }
            >
              <Spinner />
            </span>
          ) : (
            <span className="w-1/4 flex-none">
              <Meter value={going.percent} max={100} label={`Uploading ${each.name}`} />
            </span>
          )}
          <span className="lo-num flex-none text-fg-muted">{going.text}</span>
          <Button variant="ghost" size="sm" onClick={each.onCancel}>
            Cancel
          </Button>
        </>
      )}
    </li>
  );
}

function Attach({ attach }: { attach: CommentBoxAttach }) {
  const off = attach.disabled === true;
  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-label="Attach files…"
      aria-disabled={off || undefined}
      hint={off && attach.why !== undefined ? attach.why : 'Attach files…'}
      hintKeys={off ? undefined : attach.keys}
      onClick={() => {
        if (!off) attach.onClick?.();
      }}
    >
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M10.5 4.5 5.75 9.25a1.25 1.25 0 0 0 1.77 1.77l5.3-5.3a2.5 2.5 0 0 0-3.54-3.54L3.9 7.6a3.75 3.75 0 0 0 5.3 5.3l3.55-3.55" />
      </svg>
    </Button>
  );
}

/**
 * "Discard draft": its label beside its icon, and the icon alone, with a tooltip, in a narrow foot.
 * Off, as in a box with no text, its tooltip says why, and that text describes it.
 */
function Discard({
  discard,
  reason,
}: {
  discard: CommentBoxDiscard;
  /** The id of the text that says why it's off. */
  reason?: string | undefined;
}) {
  const off = discard.disabled === true;
  return (
    <Button
      variant="ghost"
      size="sm"
      data-squares="labels"
      aria-label="Discard draft"
      aria-disabled={off || undefined}
      aria-describedby={off ? reason : undefined}
      hint={off && discard.why !== undefined ? discard.why : 'Discard draft'}
      onClick={() => {
        if (!off) discard.onClick?.();
      }}
    >
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5h10M6.5 4.5V3.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V4.5M4.5 4.5l.5 8a1 1 0 0 0 1 .95h4a1 1 0 0 0 1-.95l.5-8" />
      </svg>
      <span data-gives="labels">Discard draft</span>
    </Button>
  );
}

function ActionButton({
  action,
  reason,
  iconic,
}: {
  action: CommentBoxAction;
  /** The id of the text that says why it's off. */
  reason?: string | undefined;
  /** The foot has given up its words for its icon. */
  iconic: boolean;
}) {
  const busy = action.busy === true;
  const off = action.disabled === true && !busy;
  const primary = action.primary === true;
  // What the foot gives up to draw it as its icon: the filled one's words go last.
  const step = action.icon === undefined ? undefined : primary ? 'fill' : 'actions';
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      data-squares={step}
      // As its icon alone, its words are still its name.
      aria-label={iconic ? action.label : undefined}
      aria-disabled={off || undefined}
      aria-describedby={off ? reason : undefined}
      // As its icon alone, its words are its tooltip, with its key.
      hint={off ? (action.why ?? null) : iconic ? action.label : null}
      hintKeys={iconic ? action.keys : undefined}
      {...(action.working === undefined
        ? {}
        : { busy, working: <span data-gives={step}>{action.working}</span> })}
      onClick={() => {
        if (!off) action.onClick?.();
      }}
    >
      {action.icon !== undefined && (
        <span data-takes={step} className="inline-flex">
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d={ACTION_ICONS[action.icon]} />
          </svg>
        </span>
      )}
      <span data-gives={step}>{action.label}</span>
      {action.keys && <Key keys={action.keys} decorative />}
    </Button>
  );
}

/** What takes the keyboard in an editor: a field, or editable content like CodeMirror's. */
const EDITABLE = 'textarea, input, select, [contenteditable]';

/** The first of those that is really editable: `contenteditable="false"` marks content that isn't. */
function firstEditable(within: HTMLElement | null): HTMLElement | undefined {
  return [...(within?.querySelectorAll<HTMLElement>(EDITABLE) ?? [])].find(
    (each) => each.getAttribute('contenteditable') !== 'false',
  );
}

/** Why each of a foot's controls that's off is off, once for each reason, in order. */
function reasonsOf(foot: CommentBoxFoot | undefined): string[] {
  return [
    ...new Set(
      [foot?.discard, ...(foot?.actions ?? [])].flatMap((each) =>
        each?.disabled === true && each.why !== undefined ? [each.why] : [],
      ),
    ),
  ];
}

/**
 * The id of the text that says `why` a button is off, among `reasons`, for a box whose id is `id`.
 */
function reasonId(id: string, reasons: readonly string[], why: string | undefined) {
  return why === undefined ? undefined : `${id}-why-${reasons.indexOf(why)}`;
}

/**
 * A box's head: what the comment is on at one end; who it's from, the Write and Preview switch and
 * the control that closes the box at the other; and, under them, why it's on that, if it's not on
 * what was picked. It's one line, giving up what it must as it narrows (`HEAD_STEPS`). For a frame
 * a code view hosts, drawn in the head it makes; `CommentBox` draws it itself.
 */
export function CommentBoxHeadBar({
  head,
  previewing = false,
}: {
  head: CommentBoxHead;
  previewing?: boolean | undefined;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const iconic = givenUp(HEAD_STEPS, useGiveUp(row, HEAD_STEPS))('labels');
  // Each with its icon, which it's drawn as alone in a narrow head, its words then its tooltip.
  const segment = (value: 'write' | 'preview', label: string, path: string) => ({
    value,
    name: label,
    tip: iconic ? label : null,
    label: (
      <>
        <span data-takes="labels" className="inline-flex">
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d={path} />
          </svg>
        </span>
        <span data-gives="labels">{label}</span>
      </>
    ),
  });
  return (
    <div className="border-b border-border-subtle">
      {/* One line: a narrow head gives up who it's from, the switch's key chip, then the switch's
          words, before what the comment is on is cut short. */}
      <div
        ref={row}
        className="give-up flex items-center gap-8 py-4 ps-12 pe-4 whitespace-nowrap text-small"
      >
        {head.where !== undefined && (
          <span data-fit className="min-w-0 truncate text-small-medium text-fg">
            {head.where}
          </span>
        )}
        <span className="flex-1" />
        {head.account !== undefined && (
          <span
            data-gives="hint"
            className="inline-flex min-w-0 shrink-first items-center gap-6 text-fg"
          >
            <Avatar login={head.account.login} image={head.account.image} size="sm" />
            <span data-fit className="min-w-0 truncate">
              <span className="text-fg-muted">as</span> {head.account.login}
            </span>
          </span>
        )}
        <span className="inline-flex flex-none items-center gap-8 text-fg-muted">
          <SegmentedControl
            label="Write or preview"
            kind="views"
            size="sm"
            value={previewing ? 'preview' : 'write'}
            onChange={(value) => head.onPreviewing?.(value === 'preview')}
            keys={head.previewKeys}
            disabled={head.held}
            items={[
              // A pencil.
              segment(
                'write',
                'Write',
                'M10.25 3.25 12.75 5.75M3 13l.6-2.9 7.15-7.15a1.06 1.06 0 0 1 1.5 0l1 1a1.06 1.06 0 0 1 0 1.5L6.1 12.4 3 13Z',
              ),
              // An eye.
              segment(
                'preview',
                'Preview',
                'M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
              ),
            ]}
          />
        </span>
        {head.close !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Close comment box"
            hint="Close comment box"
            hintKeys={head.close.keys}
            onClick={head.close.onClick}
          >
            <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </Button>
        )}
      </div>
      {head.why !== undefined && <p className="px-12 pb-6 text-fg-muted text-small">{head.why}</p>}
    </div>
  );
}

/** A box's notes: what went wrong, or what to know before sending. `id` is the box's. */
export function CommentBoxNotes({
  id,
  notes = [],
}: {
  id: string;
  notes?: readonly CommentBoxNote[] | undefined;
}) {
  return (
    <>
      {notes.map((each) => (
        <Note key={each.key} id={`${id}-note-${each.key}`} each={each} />
      ))}
    </>
  );
}

/** What shows over the editor while files are dragged over the box: how many it would attach. */
export function CommentBoxDropzone({ dropping }: { dropping: number }) {
  return (
    <div className="pointer-events-none absolute inset-6 grid place-items-center rounded-sm border-2 border-dashed border-accent bg-accent-soft text-fg-accent text-ui-strong">
      {dropping > 0
        ? `Drop to attach ${dropping} ${dropping === 1 ? 'file' : 'files'}`
        : 'Drop to attach files'}
    </div>
  );
}

/** A box's uploads: each file, uploading or uploaded. */
export function CommentBoxUploads({ uploads }: { uploads: readonly CommentBoxUpload[] }) {
  return (
    <ul
      aria-label="Attached files"
      className="flex list-none flex-col gap-6 border-t border-border-subtle px-12 py-8"
    >
      {uploads.map((each) => (
        <Upload key={each.key} each={each} />
      ))}
    </ul>
  );
}

/**
 * A box's foot, on one line: "Attach files…" and "Discard draft" at one end, the Vim mode with Vim
 * keys on, a hint, and the buttons at the other end, in the order given. It never wraps or runs past
 * the box: narrow, it gives up its key chips, then the words of "Discard draft", which keeps its
 * icon, then its hint, then the buttons' words, each for its icon with its words as its tooltip,
 * the filled one's last. It measures what fits, never taking a width to give each up at. A button
 * that's off says why in its tooltip, and names that text as what describes it: `id` is the box's.
 */
export function CommentBoxFootBar({
  id,
  foot,
  focused = false,
}: {
  id: string;
  foot: CommentBoxFoot;
  /** The editor has focus: with Vim keys on, the foot shows its mode. */
  focused?: boolean | undefined;
}) {
  const vim = useSyncExternalStore(onVim, vimOn, () => false);
  const reasons = reasonsOf(foot);
  const row = useRef<HTMLDivElement | null>(null);
  const gave = givenUp(FOOT_STEPS, useGiveUp(row, FOOT_STEPS));
  return (
    <div className="border-t border-border-subtle">
      {foot.lines?.map((line) => (
        <p key={line.key} className="flex items-center gap-8 px-12 pt-6 text-fg-muted text-small">
          <span className="min-w-0 truncate">{line.text}</span>
          {line.action !== undefined && (
            <Button variant="ghost" size="sm" onClick={line.action.onClick}>
              {line.action.label}
            </Button>
          )}
        </p>
      ))}
      <div
        ref={row}
        className="give-up flex items-center gap-4 p-6 whitespace-nowrap text-fg-muted text-small"
      >
        {foot.attach !== undefined && <Attach attach={foot.attach} />}
        {foot.discard !== undefined && (
          <Discard discard={foot.discard} reason={reasonId(id, reasons, foot.discard.why)} />
        )}
        {vim && focused && foot.mode !== undefined && (
          <span className={`ms-4 ${mode({ kind: foot.mode.kind })}`}>{foot.mode.name}</span>
        )}
        {foot.text !== undefined && (
          <span data-fit data-gives="hint" className="ms-4 min-w-0 flex-1 basis-0 truncate">
            {foot.text}
          </span>
        )}
        <span className="ms-auto flex flex-none items-center gap-6">
          {foot.actions?.map((action) => (
            <ActionButton
              key={action.label}
              action={action}
              reason={reasonId(id, reasons, action.why)}
              iconic={
                action.icon !== undefined && gave(action.primary === true ? 'fill' : 'actions')
              }
            />
          ))}
        </span>
      </div>
      {reasons.map((why) => (
        <span key={why} id={reasonId(id, reasons, why)} className="sr-only">
          {why}
        </span>
      ))}
    </div>
  );
}

/**
 * The frame around a comment's editor, the same wherever one is written: a line's, a reply, an
 * edit, the pull request's and the review summary. A head says what the comment is on, with the
 * Write and Preview switch and the control that closes the box; then notes; the editor, or its
 * preview; the files attached; and a foot with "Attach files…", "Discard draft" and the buttons.
 * One ring goes round the box and none inside it. It draws what it's given and decides nothing, but
 * for where focus goes when the preview takes the editor's place:
 * the preview, and back to the editor when it goes, so the keys of the box (`box` scope) work
 * throughout. A box a code view hosts has its parts made for it, and its frame draws each part on
 * its own: `CommentBoxHeadBar`, `CommentBoxNotes`, `CommentBoxDropzone`, `CommentBoxUploads` and
 * `CommentBoxFootBar`.
 */
export function CommentBox({
  children,
  label = 'Comment',
  focused = false,
  head,
  notes = [],
  uploads = [],
  preview,
  previewing = false,
  dropping,
  foot,
  className = '',
  frameRef,
}: CommentBoxProps) {
  const id = useId();
  const slot = useRef<HTMLDivElement | null>(null);
  const pane = useRef<HTMLDivElement | null>(null);
  // Whether focus is in the box, and hasn't gone to something else: when the editor is hidden or
  // the preview is removed, the browser drops focus to the page without a word.
  const held = useRef(false);
  const was = useRef(previewing);

  useLayoutEffect(() => {
    if (was.current === previewing) return;
    was.current = previewing;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (previewing) {
      // The editor has gone: focus goes to the preview, still inside the box.
      if (slot.current?.contains(active) || (lost && held.current)) pane.current?.focus();
    } else if (lost && held.current) {
      firstEditable(slot.current)?.focus();
    }
  }, [previewing]);

  return (
    <div
      ref={frameRef}
      role="group"
      aria-label={label}
      data-lo-scope="box"
      data-focused={focused ? '' : undefined}
      className={`${box({ focused })} ${className}`}
      onFocus={() => {
        held.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) held.current = false;
      }}
    >
      {head !== undefined && <CommentBoxHeadBar head={head} previewing={previewing} />}
      <CommentBoxNotes id={id} notes={notes} />
      <div ref={slot} hidden={previewing} className="relative bg-code-bg text-code-fg code-text">
        {children}
        {dropping !== undefined && !previewing && <CommentBoxDropzone dropping={dropping} />}
      </div>
      {previewing && (
        <div
          ref={pane}
          role="region"
          aria-label="Preview"
          tabIndex={0}
          // The box's one ring is its focus: the preview, in the editor's place, draws none.
          className="lo-selectable px-12 py-12 text-fg shadow-none outline-none read-comment"
        >
          {preview ?? <p className="text-fg-muted">Nothing to preview</p>}
        </div>
      )}
      {uploads.length > 0 && <CommentBoxUploads uploads={uploads} />}
      {foot !== undefined && <CommentBoxFootBar id={id} foot={foot} focused={focused} />}
    </div>
  );
}
