// The submit dialog's summary: a comment box outside any code view (`createComposer`), with Vim's
// keys, Markdown and a preview, drawn in the frame the box makes: a note when it was kept from
// before Lo started, the preview, and a foot with Vim's mode and the preview's switch. The dialog
// takes `⌘⏎` before the box hears it, and `Esc Esc` in the box closes the dialog, keeping the
// summary. Files dropped or pasted into it aren't attached yet: the box takes none.

import { CommentBoxFootBar, CommentBoxNotes, type CommentBoxNote } from '@lo/ui';
import { createComposer, type BoxParts, type Composer, type Mode } from '@lo/ui/code';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { registry } from '../../../window/commands/registry.ts';
import { Preview } from '../../comments/window/shared.ts';
import { closeDialog, typed } from './actions.ts';
import { useNonce } from './page.ts';

/** A key, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

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
  /** What the note says of a summary kept from before Lo started, if it was. */
  readonly restored: string | undefined;
  /** The text is held as it is, as while it's sent. */
  readonly held: boolean;
  /** Where the dialog puts focus as it opens: the editor, once it's made. */
  readonly editor: RefObject<HTMLElement | null>;
}

export function Summary({ view, pull, initial, restored, held, editor }: SummaryProps) {
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
      },
      (given) => {
        setParts(given);
        return { destroy: () => setParts(undefined) };
      },
    );
    box.current = made;
    editor.current = parent.querySelector<HTMLElement>('.cm-content');
    // In insert mode at the end of the text, as a box opened to write in is.
    const frame = requestAnimationFrame(() => made.focus());
    return () => {
      cancelAnimationFrame(frame);
      box.current = undefined;
      editor.current = null;
      made.dismiss();
    };
  }, [nonce, editor]);

  useEffect(() => box.current?.hold(held), [held, parts]);

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
    return () => {
      frame.removeEventListener('focusin', into);
      frame.removeEventListener('focusout', out);
    };
  }, [parts]);

  const notes: CommentBoxNote[] =
    restored !== undefined && !edited
      ? [{ key: 'restored', tone: 'info', icon: 'clock', text: restored }]
      : [];
  const toggle = () => {
    const now = !previewing;
    box.current?.preview(now);
    setPreviewing(now);
  };
  return (
    <div ref={host} className="flex flex-col">
      {parts && createPortal(<CommentBoxNotes id={id} notes={notes} />, parts.note, 'note')}
      {parts &&
        previewing &&
        createPortal(<Preview view={view} text={text} pull={pull} />, parts.preview, 'preview')}
      {parts &&
        createPortal(
          <CommentBoxFootBar
            id={id}
            focused={focused}
            foot={{
              mode: MODES[mode],
              text: 'Summary · Markdown',
              actions: [
                {
                  label: previewing ? 'Write' : 'Preview',
                  keys: labels('cmd+shift+v'),
                  onClick: toggle,
                },
              ],
            }}
          />,
          parts.foot,
          'foot',
        )}
    </div>
  );
}
