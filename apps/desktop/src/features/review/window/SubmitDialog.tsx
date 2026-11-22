// The submit dialog, in the tab feature's `tab.dialogs` slot: one body from the moment it opens
// until it's done, the summary, the verdict and the pending comments that go with it, with "Cancel"
// and "Submit review", in the shared dialog foot. Only the buttons and the line above them change:
// "Submitting…" while it goes, when nothing leaves it; what went wrong, with "Try again" and Close;
// or, once GitHub's answer was lost and Lo can't tell whether it was submitted, "Check again", which
// only looks, and Close, which leaves while it looks. An approval ends here, done, with the mark's
// kiss; any other review closes it. What can't go dims the button, or the verdict, with why.
// `⌘⏎` presses the main button from anywhere in it, the summary included, and a held key presses
// nothing more.

import { Button, Choices, Dialog, LogoMotion, Problem, Spinner } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import { usePull, useTabState } from '../../tab/window/shared.ts';
import type { DialogView, ReviewEventRow } from '../contract.ts';
import { choose, closeDialog, runPrimary, showRevision, stepNow, TITLE } from './actions.ts';
import {
  counted,
  dialogKey,
  draftLine,
  held,
  pausedUntil,
  pendingCount,
  revisionLabel,
  showFor,
  subtitleOf,
  verdictsOf,
} from './model.ts';
import { reviewStore, revisions, submitting, type Dialog as Open } from './store.ts';
import { Summary } from './Summary.tsx';

/** A key, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** How tall the account's avatar is drawn in the summary's head, in pixels: `Avatar`'s small. */
const AVATAR = 20;

/** The comments of your pending review that go with it, each with where it is and its opening. */
function Pending({ read }: { read: DialogView }) {
  const count = pendingCount(read.pending);
  if (count === 0) return null;
  return (
    <section aria-label="Pending comments" className="flex flex-col gap-6">
      <h3 className="m-0 text-small-medium text-fg-muted">{counted(count, 'pending comment')}</h3>
      {read.comments.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {read.comments.map((comment, index) => (
            <li key={index} className="flex min-w-0 items-baseline gap-8 text-small">
              <span className="flex-none code-small">
                {comment.line === null ? comment.file : `${comment.file} · ${comment.line}`}
              </span>
              <span className="min-w-0 truncate text-fg-muted">
                {comment.reply ? `Reply: ${comment.opening}` : comment.opening}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Draws the dialog again as GitHub's pause on writes in `open` ends, so its button lights then. */
function usePauseEnd(open: Open | undefined): void {
  const [now, setNow] = useState(() => Date.now());
  const until = open?.read && pausedUntil(open.read, now);
  useEffect(() => {
    if (until === undefined) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
}

/** The dialog, open while the store says. */
export function SubmitDialog() {
  const open = useStore(reviewStore, (state) => state.dialog);
  const view = open?.view ?? '';
  // Read for their changes: how submitting stands, the revisions' labels, and offline, which comes
  // and goes with the view's connection.
  const state = useTabState(submitting, view);
  const comparison = useTabState(revisions, view);
  const pull = usePull(view);
  const accounts = useAccounts();
  usePauseEnd(open);
  const editor = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const isOpen = open !== undefined;
  const label = (head: string) => revisionLabel(comparison, head);
  const step = stepNow();

  // `⌘⏎` presses the main button from anywhere in the dialog, before the summary's editor hears it,
  // and a held key that would confirm does nothing more: a held `⌘⏎` that opened the dialog never
  // submits it, nor does one held after it's submitted. A held `⏎` in the summary goes on making
  // lines.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const inEditor =
        event.target instanceof Element && event.target.closest('.cm-editor') !== null;
      const does = dialogKey(event, registry().system, inEditor);
      if (does === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (does === 'submit') runPrimary();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen]);

  // Done, "Done" has focus, wherever it was as the review went.
  const done = step?.state === 'done';
  useEffect(() => {
    if (!done) return undefined;
    const frame = requestAnimationFrame(() => primary.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [done]);

  const read = open?.read;
  const event: ReviewEventRow = open?.event ?? 'COMMENT';
  const keys = labels('cmd+enter');
  const login = pull?.acting?.kind === 'account' ? pull.acting.login : read?.login;
  // Who it's from is worth saying only where it could be someone else.
  const account =
    login === undefined || (accounts?.length ?? 0) < 2
      ? undefined
      : { login, image: avatarImage({ login, type: 'User' }, AVATAR) };
  const show = read && showFor(read);
  const off = step?.primary.off;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
      title={TITLE}
      description={read ? subtitleOf(read, label) : undefined}
      size="md"
      // While it's sent, nothing leaves it: Cancel, `Esc` and a click outside refuse.
      state={step?.state}
      action={
        step && {
          label: step.primary.label,
          working: step.primary.working,
          onRun: runPrimary,
          keys,
          disabled: off,
          again: step.state === 'failed' ? step.primary.label : undefined,
          busy: step.primary.busy,
          // As wide whatever it says, from "Submit review" to "Done".
          widest: 'Submit review',
        }
      }
      problem={step?.problem}
      leaveKeys={labels('esc')}
      mainRef={primary}
      initialFocus={read ? editor : primary}
      container={document.getElementById('root')}
      testId="submit-review"
    >
      {!open || !read ? (
        // What couldn't be read shows only as the `Problem` above the buttons.
        step?.state !== 'failed' && (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Reading pending review…
          </div>
        )
      ) : (
        <>
          <Summary
            view={open.view}
            pull={{ owner: read.owner, repo: read.repo, number: read.number }}
            initial={read.summary?.text ?? ''}
            line={read.summary?.restored ? draftLine(read.summary.savedAt, Date.now()) : undefined}
            account={account}
            held={open.busy || open.done !== undefined || held(state)}
            editor={editor}
          />
          <div className="flex flex-col gap-8">
            <Choices<ReviewEventRow>
              label="Verdict"
              items={verdictsOf(read, label).map((each) => ({
                value: each.event,
                title: each.title,
                description: each.description,
                disabled: each.off !== undefined,
              }))}
              value={event}
              onChange={choose}
            />
            {show !== undefined && (
              <div>
                <Button size="sm" onClick={() => showRevision(open.view, show)}>
                  Show {label(show)}
                </Button>
              </div>
            )}
            {open.unshown !== undefined && (
              <Problem
                layout="inline"
                title={`Couldn’t show ${label(open.unshown.head)}`}
                details={open.unshown.details}
              />
            )}
          </div>
          <Pending read={read} />
          {step?.result !== undefined && (
            <div className="flex items-center gap-12">
              <LogoMotion play="kiss" className="size-40" decorative />
              <p role="status" className="m-0 text-fg text-ui">
                {step.result}
              </p>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
