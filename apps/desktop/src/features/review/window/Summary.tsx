// The submit dialog's summary: a comment box outside any code view (`createComposer`), drawn in the
// parts the box makes with the comment box's own anatomy. The head says what it is, "Summary", who
// it's from where that could be someone else, and Write | Preview; the notes say what to know about
// the files attached to it, as to any comment box; the foot has "Attach files…" at its start, Vim's
// mode with Vim keys on, and a summary kept from before as its line. While it's sent, the box stays
// as it is, in the room it took: its text is read-only and muted, "No summary" where there's none,
// and Write | Preview and "Attach files…" dim, so nothing typed then is lost and nothing under it
// moves. The dialog takes `⌘⏎` before the box hears it, and `Esc Esc` in the box closes the dialog,
// keeping the summary.

import {
  CommentBoxFootBar,
  CommentBoxHeadBar,
  CommentBoxNotes,
  type CommentBoxAccount,
} from '@lo/ui';
import { createComposer, type BoxParts, type Composer, type Mode } from '@lo/ui/code';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import {
  attachFiles,
  boxKeys,
  draggingOver,
  Dropzone,
  pickFiles,
  Preview,
  takeAddresses,
  UploadRows,
  useUploads,
} from '../../comments/window/shared.ts';
import { closeDialog, summaryBox, typed } from './actions.ts';
import { useNonce } from './page.ts';

/** What the summary says, held, where it has no text. */
const HELD = { empty: 'No summary' } as const;

/** Why "Attach files…" is dimmed while the summary is held. */
const SENT = 'The review is sent';

const MODES: Readonly<Record<Mode, { name: string; kind: Mode }>> = {
  normal: { name: 'NORMAL', kind: 'normal' },
  insert: { name: 'INSERT', kind: 'insert' },
  visual: { name: 'VISUAL', kind: 'visual' },
};

export interface SummaryProps {
  readonly view: string;
  readonly pull: { readonly owner: string; readonly repo: string; readonly number: number };
  /** The text it starts with: the summary kept from before. */
  readonly initial: string;
  /** The line over the foot for a summary kept from before Lo started: "Draft from 12 min ago". */
  readonly line: string | undefined;
  /** Who it's from, given only where it could be someone else. */
  readonly account: CommentBoxAccount | undefined;
  /** The text is held as it is, as while it's sent. */
  readonly held: boolean;
  /** Where the dialog puts focus as it opens: the editor, once it's made. */
  readonly editor: RefObject<HTMLElement | null>;
}

export function Summary({ view, pull, initial, line, account, held, editor }: SummaryProps) {
  const host = useRef<HTMLDivElement>(null);
  const nonce = useNonce();
  const id = useId();
  const box = useRef<Composer>(undefined);
  const [parts, setParts] = useState<BoxParts>();
  const [mode, setMode] = useState<Mode>('insert');
  const [previewing, setPreviewing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState(initial);
  const [edited, setEdited] = useState(false);
  // What it starts with is read once, as it's made: a summary main sends later doesn't replace
  // what's typed.
  const start = useRef(initial);
  // What files are attached to: the view's summary, which outlives the dialog.
  const attached = summaryBox(view);
  const uploads = useUploads(attached, boxKeys('attach'), text);
  const holding = useRef(held);
  holding.current = held;

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent || nonce === undefined) return undefined;
    const made = createComposer(
      parent,
      { draft: start.current, nonce, label: 'Summary' },
      {
        change(next) {
          setText(next);
          setEdited(true);
          typed(next);
        },
        // `⌘⏎` is the dialog's, which takes it before the box hears it; `⌥⏎` does nothing here.
        submit() {},
        close: () => closeDialog(),
        mode: setMode,
        preview: setPreviewing,
        // Nothing is attached while its text is held, as while it's sent.
        attach() {
          if (!holding.current) pickFiles(attached);
        },
        files(files) {
          if (!holding.current) attachFiles(attached, files);
        },
        dragging: (count) => draggingOver(attached, count),
      },
      (given) => {
        setParts(given);
        return { destroy: () => setParts(undefined) };
      },
    );
    box.current = made;
    attached.composer = made;
    attached.heard(start.current);
    editor.current = parent.querySelector<HTMLElement>('.cm-content');
    // In insert mode at the end of the text, as a box opened to write in is.
    const frame = requestAnimationFrame(() => made.focus());
    return () => {
      cancelAnimationFrame(frame);
      box.current = undefined;
      if (attached.composer === made) attached.composer = undefined;
      editor.current = null;
      made.dismiss();
    };
  }, [nonce, editor, attached]);

  useEffect(() => box.current?.hold(held, HELD), [held, parts]);

  // Focus in the box lights its mode chip.
  useEffect(() => {
    const frame = parts?.foot.parentElement;
    if (!frame) return undefined;
    const into = () => setFocused(true);
    const out = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || !frame.contains(to)) setFocused(false);
    };
    frame.addEventListener('focusin', into);
    frame.addEventListener('focusout', out);
    if (frame.contains(document.activeElement)) setFocused(true);
    // An image's address pasted or dropped where the view takes no uploads goes in as an image.
    const stopAddresses = takeAddresses(frame, attached);
    return () => {
      frame.removeEventListener('focusin', into);
      frame.removeEventListener('focusout', out);
      stopAddresses();
    };
  }, [parts, attached]);

  const show = (on: boolean) => {
    box.current?.preview(on);
    setPreviewing(on);
  };
  return (
    <div ref={host} className="flex flex-col">
      {parts &&
        createPortal(
          <CommentBoxHeadBar
            previewing={previewing}
            head={{
              where: 'Summary',
              onPreviewing: show,
              previewKeys: boxKeys('preview'),
              account,
              held,
            }}
          />,
          parts.head,
          'head',
        )}
      {parts && createPortal(<CommentBoxNotes id={id} notes={uploads.notes} />, parts.note, 'note')}
      {parts &&
        previewing &&
        createPortal(<Preview view={view} text={text} pull={pull} />, parts.preview, 'preview')}
      {parts && createPortal(<Dropzone box={attached} />, parts.dropzone, 'dropzone')}
      {parts && createPortal(<UploadRows box={attached} />, parts.uploads, 'uploads')}
      {parts &&
        createPortal(
          <CommentBoxFootBar
            id={id}
            focused={focused}
            foot={{
              mode: MODES[mode],
              attach: held ? { ...uploads.attach, disabled: true, why: SENT } : uploads.attach,
              lines: line === undefined || edited ? undefined : [{ key: 'restored', text: line }],
            }}
          />,
          parts.foot,
          'foot',
        )}
    </div>
  );
}
