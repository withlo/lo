// The submit dialog, in the tab feature's `tab.dialogs` slot: the summary, the verdict, the pending
// comments that go with it, and who it's from, with "Cancel" and a main button named for the
// verdict. What can't go says so before anything's sent, with what to do; so does a refusal from
// GitHub, offline, a pause GitHub asked for, and a review whose answer was lost. `⌘⏎` submits from
// anywhere in it, the summary included, and a held key submits nothing more.

import { Avatar, Button, Callout, Choices, Dialog, DialogSpacer, Key, Spinner } from '@lo/ui';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { registry } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { useTabState, usePull } from '../../tab/window/shared.ts';
import type { DialogView, ReviewEventRow } from '../contract.ts';
import { choose, closeDialog, showRevision, submit, TITLE, whyNot } from './actions.ts';
import {
  clockOf,
  counted,
  held,
  pendingCount,
  plannedRefusal,
  refusalNote,
  revisionLabel,
  submittingNote,
  subtitleOf,
  verdictNames,
  verdictsOf,
  type Note,
  type Offer,
} from './model.ts';
import { reviewStore, revisions, submitting, type Dialog as Open } from './store.ts';
import { Summary } from './Summary.tsx';

/** A key, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** How tall the account's avatar is drawn in the foot, in pixels: `Avatar`'s small size. */
const AVATAR = 20;

/** When a summary was saved, as its note says: "today, 09:12", "yesterday, 18:40". */
function savedWhen(at: number, now: number): string {
  const when = new Date(at);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const time = clockOf(at);
  if (when.toDateString() === today.toDateString()) return `today, ${time}`;
  if (when.toDateString() === yesterday.toDateString()) return `yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** A note's buttons: what it offers to do. */
function offerButton(offer: Offer, view: string, label: (head: string) => string): ReactNode {
  switch (offer.kind) {
    case 'comment':
      return (
        <Button key="comment" size="sm" onClick={() => choose('COMMENT')}>
          Comment instead
        </Button>
      );
    case 'show':
      return (
        <Button key="show" size="sm" onClick={() => showRevision(view, offer.head)}>
          Show {label(offer.head)}
        </Button>
      );
    case 'anyway':
      return (
        <Button key="anyway" size="sm" onClick={() => void submit(true)}>
          Submit anyway
        </Button>
      );
    default:
      offer satisfies never;
      return null;
  }
}

function NoteCallout({
  note,
  view,
  label,
}: {
  note: Note;
  view: string;
  label: (head: string) => string;
}) {
  return (
    <Callout tone={note.tone} role={note.tone === 'danger' ? 'alert' : 'status'}>
      <span>{note.text}</span>
      {note.offers.length > 0 && (
        <span className="mt-6 flex flex-wrap gap-6">
          {note.offers.map((offer) => offerButton(offer, view, label))}
        </span>
      )}
    </Callout>
  );
}

/** The comments of your pending review that go with it, each with where it is and its opening. */
function Pending({ read }: { read: DialogView }) {
  const count = pendingCount(read.pending);
  if (count === 0) return null;
  const goes = count === 1 ? 'goes' : 'go';
  return (
    <section aria-label="Pending comments" className="flex flex-col gap-6">
      <h3 className="m-0 text-small-medium text-fg-muted">
        {counted(count, 'pending comment')} {goes} with it
      </h3>
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

/** Why sending is off now, if it is: what the view can't do, offline, or a pause GitHub asked for. */
function useBlocked(open: Open | undefined): Note | undefined {
  // Read for its changes: offline comes and goes with the view's connection.
  usePull(open?.view ?? '');
  const until = open?.read?.pausedUntil ?? null;
  const [now, setNow] = useState(() => Date.now());
  // A pause shows until it's over.
  useEffect(() => {
    if (until === null || until <= now) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), until - now);
    return () => clearTimeout(timer);
  }, [until, now]);
  if (!open?.read) return undefined;
  const why = whyNot();
  if (why !== undefined) return { tone: 'info', text: why, offers: [] };
  if (until !== null && until > now) {
    return {
      tone: 'info',
      text: `GitHub asked Lo to hold off until ${clockOf(until)}. Submit it then.`,
      offers: [],
    };
  }
  return undefined;
}

/** The dialog, open while the store says. */
export function SubmitDialog() {
  const open = useStore(reviewStore, (state) => state.dialog);
  const view = open?.view ?? '';
  const state = useTabState(submitting, view);
  const comparison = useTabState(revisions, view);
  const editor = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const isOpen = open !== undefined;
  const blocked = useBlocked(open);
  const label = (head: string) => revisionLabel(comparison, head);

  // `⌘⏎` submits from anywhere in the dialog, before the summary's editor hears it, and a held
  // `⏎`, with or without `⌘`, does nothing more: a held `⌘⏎` that opened the dialog never submits
  // it, nor does one held after it's submitted.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      if (event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const command = registry().system === 'mac' ? event.metaKey : event.ctrlKey;
      const other = registry().system === 'mac' ? event.ctrlKey : event.metaKey;
      if (!command || other || event.altKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      void submit();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen]);

  const read = open?.read;
  const event: ReviewEventRow = open?.event ?? 'COMMENT';
  const planned = read && plannedRefusal(read, event, open.text);
  const refused = open?.refusal ?? planned;
  const busy = open?.busy === true || state === 'sending';
  const standing = submittingNote(state);
  const off =
    read === undefined || busy || held(state) || blocked !== undefined || planned !== undefined;
  const verdict = verdictNames[event];
  const keys = labels('cmd+enter');

  let body: ReactNode;
  if (!open || !read) {
    body = (
      <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
        <Spinner />
        Reading your pending review…
      </div>
    );
  } else {
    body = (
      <>
        <Summary
          view={open.view}
          pull={{ owner: read.owner, repo: read.repo, number: read.number }}
          initial={read.summary?.text ?? ''}
          restored={
            read.summary?.restored
              ? `Restored your summary from ${savedWhen(read.summary.savedAt, Date.now())}.`
              : undefined
          }
          held={busy || state === 'checking'}
          editor={editor}
        />
        <Choices<ReviewEventRow>
          label="Your verdict"
          items={verdictsOf(read, label).map((each) => ({
            value: each.event,
            title: each.title,
            description: each.description,
          }))}
          value={event}
          onChange={choose}
        />
        {refused && (
          <NoteCallout note={refusalNote(refused, event, label)} view={view} label={label} />
        )}
        {blocked && <NoteCallout note={blocked} view={view} label={label} />}
        {standing && <NoteCallout note={standing} view={view} label={label} />}
        <Pending read={read} />
      </>
    );
  }

  const login = read?.login;
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
      title="Submit your review"
      description={read ? subtitleOf(read, label) : undefined}
      initialFocus={read ? editor : primary}
      container={document.getElementById('root')}
      testId="submit-review"
      foot={
        <>
          {login !== undefined && (
            <span className="flex items-center gap-6">
              <Avatar
                login={login}
                size="sm"
                image={avatarImage({ login, type: 'User' }, AVATAR)}
              />
              <span>
                as <span className="text-fg">{login}</span>
              </span>
            </span>
          )}
          <DialogSpacer />
          <Button onClick={closeDialog}>
            Cancel
            <Key keys={labels('esc')} decorative />
          </Button>
          <Button
            ref={primary}
            variant="primary"
            aria-disabled={off || undefined}
            aria-keyshortcuts={keys.join('')}
            onClick={(click) => {
              // Not a double click's second: the first may have just submitted.
              if (click.detail <= 1 && !off) void submit();
            }}
          >
            {busy ? 'Submitting…' : verdict}
            <Key keys={keys} decorative className={off ? undefined : 'text-on-accent'} />
          </Button>
        </>
      }
    >
      <span role="status" className="sr-only">
        {TITLE}
      </span>
      {body}
    </Dialog>
  );
}
