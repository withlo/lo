// Edit term, in the tab feature's `tab.dialogs` slot: the term, which can't be renamed; its
// definition, one paragraph written in a field that grows from three lines to eight, with what it
// may hold and how long it is under it; the definition as it will read; its other forms; then the
// notes that dim Save, and a draft kept from before with "Discard draft". "Save" (`⌘⏎`) says
// "Saving…" while main writes it, when nothing leaves it; saved, the dialog closes and focus goes
// back where it was. A term changed since it opened comes back over the field, theirs as it reads,
// with "Save mine"; a failure says why, with "Try again"; and an answer lost, "Check again", which
// only looks.

import {
  Button,
  Callout,
  Dialog,
  Input,
  Ticks,
  type DialogAction,
  type ProblemProps,
} from '@lo/ui';
import { ariaShortcut, keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { DefinitionPreview } from '@lo/ui/overview';
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import { useTabState } from '../../tab/window/shared.ts';
import {
  changeAliases,
  changeDefinition,
  changedLine,
  charactersIn,
  checkEdit,
  closeEdit,
  DEFINITION_LIMIT,
  dialogStateOf,
  discardDraft,
  draftLine,
  EDIT_TITLE,
  editNotes,
  editStore,
  SAVE_FAILED,
  SAVE_UNCONFIRMED,
  saveEdit,
  saveLabel,
  saveOff,
  type EditConflict,
  type EditOpen,
} from './edit.ts';
import { useNow } from './hooks.ts';
import { terms } from './terms.ts';

/** A key written in Lo's notation as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** A key written in Lo's notation as `aria-keyshortcuts` says it, for a screen reader. */
function shortcut(keys: string): string | undefined {
  return ariaShortcut(systemStrokes(parseKeys(keys), registry().system));
}

/** What a definition may hold, as it's written. */
const HOLDS = ['`code`', '[words](code:src/cost.ts#L12)', '[words](term:bucket)'];

/** Whether `event` is `⌘⏎` on macOS, `Ctrl+⏎` elsewhere. */
function isSave(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.altKey || event.shiftKey) return false;
  return registry().system === 'mac'
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** The term changed since the dialog opened: who by and when, then theirs as it reads. */
function Conflict({ conflict, now }: { conflict: EditConflict; now: number }) {
  const { term } = conflict;
  if (!term) {
    return (
      <Callout tone="warning" role="status">
        This term was deleted elsewhere.
      </Callout>
    );
  }
  return (
    <Callout tone="warning" role="status">
      <p className="m-0 text-fg text-ui-strong">{changedLine(term, now)}</p>
      <div className="mt-4">
        {conflict.read?.ok ? (
          <DefinitionPreview blocks={conflict.read.blocks} />
        ) : (
          <p className="lo-selectable m-0 text-fg">{term.definition}</p>
        )}
      </div>
    </Callout>
  );
}

/**
 * The dialog's body: everything but its foot. `field` is the definition's field, which the dialog
 * focuses as it opens.
 */
function Body({
  open,
  notes,
  now,
  field,
}: {
  open: EditOpen;
  notes: readonly string[];
  now: number;
  field: RefObject<HTMLTextAreaElement | null>;
}) {
  const id = useId();
  const count = charactersIn(open.definition);
  const read = open.read?.value.definition;
  const held = open.step.kind === 'working';
  return (
    <>
      {open.conflict && <Conflict conflict={open.conflict} now={now} />}
      <div className="flex flex-col gap-6">
        <h3 id={`${id}-term`} className="lo-selectable m-0 text-fg read-h3">
          {open.term}
        </h3>
        <textarea
          id={`${id}-definition`}
          ref={(element) => {
            // Focused as it opens, with the caret at the end.
            if (element && field.current !== element) {
              const end = element.value.length;
              element.setSelectionRange(end, end);
            }
            field.current = element;
          }}
          aria-label="Definition"
          aria-describedby={`${id}-holds`}
          value={open.definition}
          readOnly={held}
          onChange={(event) => changeDefinition(event.currentTarget.value)}
          onKeyDown={(event) => {
            // One paragraph: `⏎` types nothing.
            if (event.key === 'Enter' && !isSave(event)) event.preventDefault();
          }}
          className="grow-3-8 w-full min-w-0 resize-none rounded-sm border border-border bg-bg-well px-8 py-6 text-fg read-comment placeholder:text-fg-subtle read-only:text-fg-muted hover:border-border-strong focus-visible:shadow-ring"
        />
        <div className="flex items-baseline gap-12 text-fg-subtle text-small">
          <span id={`${id}-holds`} className="min-w-0 flex-1">
            {HOLDS.map((each, index) => (
              <span key={each}>
                {index > 0 && ' '}
                <code className="code-small">{each}</code>
              </span>
            ))}
          </span>
          <span className={`lo-num flex-none ${count > DEFINITION_LIMIT ? 'text-danger' : ''}`}>
            {count} / {DEFINITION_LIMIT}
          </span>
        </div>
      </div>
      <section aria-label="Preview" className="flex flex-col gap-6">
        <h4 className="m-0 label-caps text-fg-muted text-label">Preview</h4>
        <DefinitionPreview blocks={read?.ok ? read.blocks : []} empty="Nothing to preview" />
      </section>
      <div className="flex flex-col gap-6">
        <label htmlFor={`${id}-aliases`} className="text-fg text-ui-strong">
          Also written as
        </label>
        <Input
          id={`${id}-aliases`}
          value={open.aliases}
          placeholder="buckets, token bucket"
          readOnly={held}
          onChange={(event) => changeAliases(event.currentTarget.value)}
        />
      </div>
      {notes.length > 0 && (
        <ul aria-label="Notes" className="m-0 flex list-none flex-col gap-4 p-0">
          {notes.map((note) => (
            <li key={note} className="text-danger text-small">
              {note}
            </li>
          ))}
        </ul>
      )}
      {open.draftAt !== undefined && (
        <p className="m-0 flex items-center gap-8 text-fg-muted text-small">
          <span className="min-w-0 truncate">{draftLine(open.draftAt, now)}</span>
          <Button variant="ghost" size="sm" onClick={discardDraft}>
            Discard draft
          </Button>
        </p>
      )}
    </>
  );
}

/** What the failure over the buttons says. */
function problemOf(open: EditOpen): Omit<ProblemProps, 'layout' | 'action'> | undefined {
  const { step } = open;
  if (step.kind === 'failed') {
    return {
      title: SAVE_FAILED,
      reason: step.reason === undefined ? undefined : <Ticks text={step.reason} />,
      details: step.details,
    };
  }
  if (step.kind === 'unconfirmed') {
    return { title: SAVE_UNCONFIRMED, reason: 'GitHub didn’t respond.', details: step.details };
  }
  return undefined;
}

/** The dialog, open while the store says. */
export function EditTermDialog(): ReactNode {
  const open = useStore(editStore, (state) => state.open);
  const accounts = useAccounts();
  // The store's names, which the notes check links and other forms against.
  const names = useTabState(terms, open?.tab ?? '', (known) =>
    known.kind === 'read' ? known.terms.names : undefined,
  );
  const now = useNow(open !== undefined, 30_000);
  const primary = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const isOpen = open !== undefined;

  // A held key that would save does nothing more: a held `⌘⏎` never saves twice.
  useEffect(() => {
    if (!isOpen) return undefined;
    const held = (event: globalThis.KeyboardEvent) => {
      if (event.repeat && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener('keydown', held, true);
    return () => document.removeEventListener('keydown', held, true);
  }, [isOpen]);

  const notes = open ? editNotes(open, names) : [];
  const unconfirmed = open?.step.kind === 'unconfirmed';
  const action: DialogAction | undefined = open && {
    label: saveLabel(open),
    working: 'Saving…',
    onRun: () => void (unconfirmed ? checkEdit() : saveEdit()),
    keys: labels('cmd+enter'),
    shortcut: shortcut('cmd+enter'),
    disabled: unconfirmed ? undefined : saveOff(open, notes),
    again: unconfirmed ? 'Check again' : undefined,
    unconfirmed,
    busy: open.step.kind === 'unconfirmed' && open.step.checking,
    widest: 'Check again',
  };
  // Who it's saved as is worth saying only where it could be someone else.
  const as =
    open?.login !== undefined && (accounts?.length ?? 0) >= 2 ? `as ${open.login}` : undefined;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) closeEdit();
      }}
      title={EDIT_TITLE}
      description={as}
      size="md"
      state={open && dialogStateOf(open.step)}
      action={action}
      problem={open && problemOf(open)}
      leaveKeys={labels('esc')}
      mainRef={primary}
      initialFocus={field}
      onKeyDown={(event) => {
        if (!isSave(event) || event.repeat) return;
        event.preventDefault();
        primary.current?.click();
      }}
      container={document.getElementById('root')}
      testId="edit-term"
    >
      {open && <Body open={open} notes={notes} now={now} field={field} />}
    </Dialog>
  );
}
