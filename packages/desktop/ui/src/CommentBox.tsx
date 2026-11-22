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
import { onVim, vimOn } from './vim.ts';
import { Key } from './Key.tsx';
import { Meter } from './Meter.tsx';
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
  /** `warning` for what needs care or went wrong; `info` for the rest. */
  tone: 'info' | 'warning';
  /** In place of the tone's own: a clock for a restored draft, a cross for a refusal. */
  icon?: 'clock' | 'blocked' | undefined;
  /** What went wrong, for one that says so: "Couldn’t send the comment". `text` is then why. */
  title?: string | undefined;
  text: ReactNode;
  /** What it offers to do, each starting with a verb: "Show latest", "Comment on file". */
  actions?: readonly BannerAction[] | undefined;
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
  /**
   * The comment as its card will draw it (`SentPost`), from the moment it's sent until GitHub
   * answers: the box draws only this, with the editor kept out of sight, so the text never leaves
   * the screen and is there to come back to if the send fails.
   */
  sent?: ReactNode;
  foot?: CommentBoxFoot | undefined;
  /** More classes for the box, such as the space the code view leaves around it. */
  className?: string | undefined;
  /**
   * The box's element, for whoever answers for its keys. It's the `box` scope: its head, preview
   * and foot are in it as well as the editor, so keys keep working wherever focus is in the box.
   */
  frameRef?: Ref<HTMLDivElement> | undefined;
}

const box = cva('max-w-read-measure overflow-hidden rounded-md bg-bg-raised text-ui', {
  variants: {
    focused: { true: 'shadow-ring', false: 'ring-1 ring-border' },
  },
});

const note = cva(
  'flex items-center gap-8 border-b border-border-subtle px-12 py-6 text-fg text-small',
  {
    variants: { tone: { info: 'bg-info-bg', warning: 'bg-warning-bg' } },
  },
);

const noteIcon = cva('flex-none', {
  variants: { tone: { info: 'text-info', warning: 'text-warning' } },
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
 * What the foot gives up as it narrows, each narrower than the last: its key chips, then the labels
 * of the controls that aren't its buttons, then its hint. The foot's own box is the container.
 */
const NARROW = {
  chips: 'box-chip',
  hint: 'box-hint',
  labels: 'box-label',
} as const;

/** The icons a note takes, on the 16 grid. */
function NoteIcon({ tone, icon }: Pick<CommentBoxNote, 'tone' | 'icon'>) {
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
    ) : tone === 'warning' ? (
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
    <svg className={`lo-i lo-i--sm ${noteIcon({ tone })}`} viewBox="0 0 16 16" aria-hidden="true">
      {shapes}
    </svg>
  );
}

function Note({ each, id }: { each: CommentBoxNote; id?: string | undefined }) {
  return (
    <div id={id} role="status" className={note({ tone: each.tone })}>
      <NoteIcon tone={each.tone} icon={each.icon} />
      <span className="min-w-0 flex-1">
        {each.title !== undefined && <b className="text-ui-strong">{each.title} </b>}
        {each.text}
      </span>
      {each.actions !== undefined && each.actions.length > 0 && (
        <span className="flex flex-none items-center gap-2">
          {each.actions.map((action) => (
            <Button key={action.label} variant="ghost" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </span>
      )}
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

/** How far an upload is, as its row says it: "Uploading…", or "Uploading · 62%" where it's known. */
function uploading(progress: number | undefined): { percent: number | undefined; text: string } {
  if (progress === undefined) return { percent: undefined, text: 'Uploading…' };
  const percent = Math.round(Math.min(Math.max(progress, 0), 1) * 100);
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
            <Spinner />
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
      <span className={NARROW.labels}>Discard draft</span>
    </Button>
  );
}

function ActionButton({
  action,
  reason,
}: {
  action: CommentBoxAction;
  /** The id of the text that says why it's off. */
  reason?: string | undefined;
}) {
  const busy = action.busy === true;
  const off = action.disabled === true && !busy;
  const primary = action.primary === true;
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size="sm"
      aria-disabled={off || undefined}
      aria-describedby={off ? reason : undefined}
      hint={off ? action.why : undefined}
      {...(action.working === undefined ? {} : { busy, working: action.working })}
      onClick={() => {
        if (!off) action.onClick?.();
      }}
    >
      {action.label}
      {action.keys && <Key keys={action.keys} decorative className={NARROW.chips} />}
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
 * what was picked. For a frame a code view hosts, drawn in the head it makes; `CommentBox` draws it
 * itself.
 */
export function CommentBoxHeadBar({
  head,
  previewing = false,
}: {
  head: CommentBoxHead;
  previewing?: boolean | undefined;
}) {
  return (
    <div className="@container border-b border-border-subtle">
      <div className="flex box-row items-center gap-8 py-4 ps-12 pe-4 text-small">
        {head.where !== undefined && (
          <span className="min-w-0 truncate text-small-medium text-fg">{head.where}</span>
        )}
        <span className="flex-1" />
        {head.account !== undefined && (
          <span className="box-hint inline-flex min-w-0 shrink-first items-center gap-6 whitespace-nowrap text-fg">
            <Avatar login={head.account.login} image={head.account.image} size="sm" />
            <span className="min-w-0 truncate">
              <span className="text-fg-muted">as</span> {head.account.login}
            </span>
          </span>
        )}
        {/* A narrow head gives up who it's from, then the switch's key chip. */}
        <span className="box-keys inline-flex flex-none box-row items-center gap-8 text-fg-muted">
          <SegmentedControl
            label="Write or preview"
            kind="views"
            size="sm"
            value={previewing ? 'preview' : 'write'}
            onChange={(value) => head.onPreviewing?.(value === 'preview')}
            keys={head.previewKeys}
            items={[
              { value: 'write', label: 'Write' },
              { value: 'preview', label: 'Preview' },
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
 * keys on, a hint, and the buttons at the other end, the main one last. It never runs past the box:
 * narrow, it gives up its key chips, then the labels of the controls that aren't its buttons, which
 * stay icons with tooltips, then its hint. Whatever still doesn't fit wraps: the buttons go to a
 * row of their own, at its end, and under that one under the other. A button that's off says why in
 * its tooltip, and names that text as what describes it: `id` is the box's.
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
  return (
    <div className="@container border-t border-border-subtle">
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
      <div className="flex flex-wrap items-center gap-4 p-6 text-fg-muted text-small">
        {foot.attach !== undefined && <Attach attach={foot.attach} />}
        {foot.discard !== undefined && (
          <Discard discard={foot.discard} reason={reasonId(id, reasons, foot.discard.why)} />
        )}
        {vim && focused && foot.mode !== undefined && (
          <span className={`ms-4 ${mode({ kind: foot.mode.kind })}`}>{foot.mode.name}</span>
        )}
        {foot.text !== undefined && (
          <span className={`ms-4 min-w-0 flex-1 basis-0 truncate ${NARROW.hint}`}>{foot.text}</span>
        )}
        <span className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-6">
          {foot.actions?.map((action) => (
            <ActionButton
              key={action.label}
              action={action}
              reason={reasonId(id, reasons, action.why)}
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
  sent,
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
      // A sent comment is a card, with no ring of the box's.
      className={`${box({ focused: focused && sent === undefined })} ${className}`}
      onFocus={() => {
        held.current = true;
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) held.current = false;
      }}
    >
      {sent !== undefined && sent}
      {sent === undefined && head !== undefined && (
        <CommentBoxHeadBar head={head} previewing={previewing} />
      )}
      {sent === undefined && <CommentBoxNotes id={id} notes={notes} />}
      <div
        ref={slot}
        hidden={previewing || sent !== undefined}
        className="relative bg-code-bg text-code-fg code-text"
      >
        {children}
        {dropping !== undefined && !previewing && <CommentBoxDropzone dropping={dropping} />}
      </div>
      {previewing && sent === undefined && (
        <div
          ref={pane}
          role="region"
          aria-label="Preview"
          tabIndex={0}
          className="lo-selectable px-12 py-12 text-fg outline-none read-comment"
        >
          {preview ?? <p className="text-fg-muted">Nothing to preview</p>}
        </div>
      )}
      {sent === undefined && uploads.length > 0 && <CommentBoxUploads uploads={uploads} />}
      {sent === undefined && foot !== undefined && (
        <CommentBoxFootBar id={id} foot={foot} focused={focused} />
      )}
    </div>
  );
}
