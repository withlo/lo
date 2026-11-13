import { cva } from 'class-variance-authority';
import { useId, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';

import { Avatar } from './Avatar.tsx';
import type { BannerAction } from './Banner.tsx';
import { Button } from './Button.tsx';
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
  /** Where the comment goes: "On lines 39–41, new side", "On the file", "Reply to tess-okafor's thread". */
  where?: ReactNode;
  /** Who it's from. */
  account?: CommentBoxAccount | undefined;
}

/** A note over the editor: a restored draft, why a send was refused, or what to know about uploads. */
export interface CommentBoxNote {
  /** What identifies it. */
  key: string;
  /** `warning` for what needs care or went wrong; `info` for the rest. */
  tone: 'info' | 'warning';
  /** In place of the tone's own: a clock for a restored draft, a cross for a refusal. */
  icon?: 'clock' | 'blocked' | undefined;
  text: ReactNode;
  /** What it offers to do, each starting with a verb: "Discard", "Load the newer push". */
  actions?: readonly BannerAction[] | undefined;
}

/** One file in the box, uploading or uploaded. */
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
  /** It can't be used here. The note says why. */
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  /** After the button; "or drop or paste files" when there isn't one. */
  hint?: ReactNode;
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
   * Why it can't, in the box's own words: "Offline. Lo keeps this as a draft until you send it."
   * The box says it in a note while the button is off, so the reason is never only a tooltip.
   */
  why?: string | undefined;
  onClick?: (() => void) | undefined;
}

export interface CommentBoxFoot {
  mode?: CommentBoxMode | undefined;
  /** What the comment is, beside the mode, when the box has no head: "Reply to tess-okafor's thread". */
  text?: ReactNode;
  attach?: CommentBoxAttach | undefined;
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
  /** The editor has focus: the box takes the focus ring, and its mode chip is lit. */
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
    lit: { true: '', false: 'opacity-60' },
  },
});

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
      <span className="min-w-0 flex-1">{each.text}</span>
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

function Upload({ each }: { each: CommentBoxUpload }) {
  return (
    <li className="flex items-center gap-8 text-small">
      <FileIcon />
      <span className="flex min-w-0 flex-1 items-baseline gap-6">
        <span className="truncate">{each.name}</span>
        <span className="lo-num flex-none text-fg-muted">{each.size}</span>
      </span>
      {each.uploaded === true ? (
        <span className="inline-flex items-center gap-4 text-success">
          <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
          Uploaded
        </span>
      ) : (
        <>
          {each.progress === undefined ? (
            <span className="inline-flex items-center gap-6 text-fg-muted">
              <Spinner />
              Uploading
            </span>
          ) : (
            <span className="w-1/4 flex-none">
              <Meter
                value={Math.round(Math.min(Math.max(each.progress, 0), 1) * 100)}
                max={100}
                label={`Uploading ${each.name}`}
              />
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Cancel uploading ${each.name}`}
            onClick={each.onCancel}
          >
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
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-disabled={off || undefined}
        onClick={() => {
          if (!off) attach.onClick?.();
        }}
      >
        <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10.5 4.5 5.75 9.25a1.25 1.25 0 0 0 1.77 1.77l5.3-5.3a2.5 2.5 0 0 0-3.54-3.54L3.9 7.6a3.75 3.75 0 0 0 5.3 5.3l3.55-3.55" />
        </svg>
        Attach
        {attach.keys && <Key keys={attach.keys} decorative />}
      </Button>
      {!off && <span>{attach.hint ?? 'or drop or paste files'}</span>}
    </>
  );
}

function ActionButton({
  action,
  reason,
}: {
  action: CommentBoxAction;
  /** The id of the note that says why it's off. */
  reason?: string | undefined;
}) {
  const off = action.disabled === true;
  return (
    <Button
      variant={action.primary === true ? 'primary' : 'secondary'}
      size="sm"
      aria-disabled={off || undefined}
      aria-describedby={off ? reason : undefined}
      onClick={() => {
        if (!off) action.onClick?.();
      }}
    >
      {action.label}
      {action.keys && (
        <Key
          keys={action.keys}
          decorative
          className={action.primary === true && !off ? 'text-on-accent' : undefined}
        />
      )}
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

/** Why each of a foot's buttons that's off is off, once for each reason, in order. */
function reasonsOf(foot: CommentBoxFoot | undefined): string[] {
  return [
    ...new Set(
      (foot?.actions ?? []).flatMap((each) =>
        each.disabled === true && each.why !== undefined ? [each.why] : [],
      ),
    ),
  ];
}

/**
 * The id of the note that says `why` a button is off, among `reasons`, for a box whose id is `id`.
 */
function reasonId(id: string, reasons: readonly string[], why: string | undefined) {
  return why === undefined ? undefined : `${id}-why-${reasons.indexOf(why)}`;
}

/**
 * A box's head: the Write and Preview switch, where the comment goes and who it's from. For a frame
 * a code view hosts, drawn in the head it makes; `CommentBox` draws it itself.
 */
export function CommentBoxHeadBar({
  head,
  previewing = false,
}: {
  head: CommentBoxHead;
  previewing?: boolean | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border-b border-border-subtle py-6 ps-12 pe-8 text-fg-muted text-small">
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
      {head.where !== undefined && <span className="min-w-0 truncate">{head.where}</span>}
      {head.account !== undefined && (
        <span
          className="ms-auto inline-flex h-24 min-w-0 shrink-first items-center gap-6 rounded-pill ps-4 pe-8 whitespace-nowrap text-fg"
          title={`Commenting as ${head.account.login}`}
        >
          <Avatar login={head.account.login} image={head.account.image} size="sm" />
          <span className="min-w-0 truncate">
            <span className="text-fg-muted">as</span> {head.account.login}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * A box's notes, and a note for each reason one of its foot's buttons is off, which the button
 * names as what describes it. `id` is the box's, as its foot is given it.
 */
export function CommentBoxNotes({
  id,
  notes = [],
  foot,
}: {
  id: string;
  notes?: readonly CommentBoxNote[] | undefined;
  foot?: CommentBoxFoot | undefined;
}) {
  const reasons = reasonsOf(foot);
  return (
    <>
      {notes.map((each) => (
        <Note key={each.key} each={each} />
      ))}
      {reasons.map((why) => (
        <Note
          key={why}
          id={reasonId(id, reasons, why)}
          each={{ key: why, tone: 'info', text: why }}
        />
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
      aria-label="Uploads"
      className="flex list-none flex-col gap-6 border-t border-border-subtle px-12 py-8"
    >
      {uploads.map((each) => (
        <Upload key={each.key} each={each} />
      ))}
    </ul>
  );
}

/**
 * A box's foot: the Vim mode, Attach, and the buttons, the main one last. A button that's off
 * names the note that says why as what describes it: `id` is the box's, as its notes are given it.
 */
export function CommentBoxFootBar({
  id,
  foot,
  focused = false,
}: {
  id: string;
  foot: CommentBoxFoot;
  /** The editor has focus: the mode chip is lit. */
  focused?: boolean | undefined;
}) {
  const reasons = reasonsOf(foot);
  return (
    <div className="flex flex-wrap items-center gap-8 border-t border-border-subtle py-8 ps-12 pe-8 text-fg-muted text-small">
      {foot.mode !== undefined && (
        <span className={mode({ kind: foot.mode.kind, lit: focused })}>{foot.mode.name}</span>
      )}
      {foot.text !== undefined && <span>{foot.text}</span>}
      {foot.attach !== undefined && <Attach attach={foot.attach} />}
      <span className="flex-1" />
      {foot.actions?.map((action) => (
        <ActionButton
          key={action.label}
          action={action}
          reason={reasonId(id, reasons, action.why)}
        />
      ))}
    </div>
  );
}

/**
 * The frame around a comment's editor: a head with the Write and Preview switch, where the comment
 * goes and who it's from; notes; the editor, or its preview; the files being uploaded; and a foot
 * with the Vim mode, Attach and the buttons. The same frame goes round every box: a line's, a
 * reply, the timeline's and the review summary, each with the parts it needs. It draws what it's
 * given and decides nothing, but for where focus goes when the preview takes the editor's place:
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
      <CommentBoxNotes id={id} notes={notes} foot={foot} />
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
          className="lo-selectable px-12 py-12 text-fg read-comment focus-visible:shadow-ring-inset"
        >
          {preview ?? <p className="text-fg-muted">Nothing to preview.</p>}
        </div>
      )}
      {uploads.length > 0 && <CommentBoxUploads uploads={uploads} />}
      {foot !== undefined && <CommentBoxFootBar id={id} foot={foot} focused={focused} />}
    </div>
  );
}
