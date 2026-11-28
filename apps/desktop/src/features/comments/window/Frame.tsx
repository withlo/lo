// A comment box's frame, the same wherever a comment is written, drawn in the parts the code view
// makes around its editor: the head, which says what the comment is on, with Write and Preview and
// the control that closes the box; the notes, of a refusal with what to do about it, or how sending
// stands; the preview, the text as GitHub would render it; the comment as a card, in the box's place
// from the moment it's sent until GitHub answers; the files attached to it
// (`./Attached.tsx`); and the foot, with "Attach files…", "Discard draft" and the buttons that
// send, each dimmed with its reason as its tooltip while it can't. Each part is a React root of its
// own, drawn from the box's state, and drawn at once as the box is made, so it's as tall as it'll
// be before it's on screen.

import {
  ago,
  CommentBoxFootBar,
  CommentBoxHeadBar,
  CommentBoxNotes,
  SentPost,
  type CommentBoxAction,
  type CommentBoxFoot,
  type CommentBoxNote,
} from '@lo/ui';
import { onLines } from '@lo/review';
import type { BoxFrame, Composer, Mode } from '@lo/ui/code';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { offlineLabel } from '../../../window/explain.ts';
import { avatarImage } from '../../../window/images.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import { usePull, useRun, useTabState } from '../../tab/window/shared.ts';
import {
  act,
  type Box,
  type BoxState,
  discardable,
  linesChange,
  pullIn,
  replacedOf,
  send,
  sendingNow,
  takenDown,
} from './boxes.ts';
import { boxKeys } from './boxkeys.ts';
import { Preview as Rendering } from './Preview.tsx';
import { Dropzone, UploadRows, useUploads } from './Attached.tsx';
import { threadsMode } from './mode.ts';
import { holdText, takeAddresses, UPLOADING } from './uploads.ts';
import { wroteText } from './store.ts';
import { held } from './threads.ts';
import {
  BLANK,
  CHECK_FIRST,
  IN_A_LAYER,
  notesOf,
  offerLabels,
  sentLabel,
  SIGN_IN,
  whereText,
  type BoxNote,
} from './writing.ts';

/** How tall the account's avatar is drawn in the head, in pixels: `Avatar`'s small size. */
const AVATAR = 20;

const modes: Readonly<Record<Mode, { name: string; kind: Mode }>> = {
  normal: { name: 'NORMAL', kind: 'normal' },
  insert: { name: 'INSERT', kind: 'insert' },
  visual: { name: 'VISUAL', kind: 'visual' },
};

function useBox(box: Box): BoxState {
  return useSyncExternalStore(box.subscribe, () => box.state);
}

/** Why the box can't send now, if it can't: offline, acting as nobody, or a run of layers. */
function useWhyNot(box: Box): string | undefined {
  const pull = usePull(box.view);
  const run = useRun(box.view);
  if (pull?.acting?.kind !== 'account') return SIGN_IN;
  if (run) return IN_A_LAYER;
  if (pull.connection.kind === 'offline') return offlineLabel(pull.connection.cause);
  return undefined;
}

/** Whether view `view` has a pending review, which GitHub adds every comment sent to. */
function usePending(view: string): boolean {
  return useTabState(held, view, (value) => value.review?.review.kind === 'pending');
}

/**
 * The foot's buttons, always in one order, "Send now" then "Add to review": only the fill moves, to
 * the main one, as `c` or `C` opened the box. While a pending review
 * exists GitHub adds every comment to it, so the box has "Add to review" alone. An edit's has one,
 * which saves it. A comment on the pull request itself joins no review, so its one button sends it,
 * with `⌘⏎` as `⌥⏎` does. A button that can't be pressed says why in its tooltip, and the one
 * pressed says it's working until GitHub answers.
 */
function footOf(
  box: Box,
  state: BoxState,
  why: string | undefined,
  pending: boolean,
): CommentBoxFoot {
  const waiting = sendingNow(state);
  const blank = state.text.trim() === '';
  // Sent before, with no word of whether it posted: nothing sends it again until that's known.
  const unconfirmed = state.sending === 'unknown' ? CHECK_FIRST : undefined;
  const reason = why ?? (blank ? BLANK : unconfirmed);
  const disabled = reason !== undefined || waiting;
  const { kind } = state.place;
  const canDiscard = discardable(state);
  const alone = (
    label: string,
    how: 'review' | 'now',
    working: string,
    icon: CommentBoxAction['icon'],
  ): CommentBoxAction => ({
    label,
    icon,
    keys: boxKeys('addToReview'),
    primary: true,
    disabled,
    why: reason,
    busy: waiting,
    working,
    onClick: () => void send(box, how),
  });
  const button = (how: 'review' | 'now'): CommentBoxAction => ({
    label: how === 'review' ? 'Add to review' : 'Send now',
    icon: how === 'review' ? 'review' : 'send',
    keys: boxKeys(how === 'review' ? 'addToReview' : 'postNow'),
    primary: state.primary === how,
    disabled,
    why: reason,
    busy: waiting && box.lastHow === how,
    working: 'Sending…',
    onClick: () => void send(box, how),
  });
  const actions =
    kind === 'conversation'
      ? [alone('Send', 'now', 'Sending…', 'send')]
      : kind === 'edit'
        ? [alone('Save', 'review', 'Saving…', 'save')]
        : pending
          ? [alone('Add to review', 'review', 'Sending…', 'review')]
          : [button('now'), button('review')];
  return {
    mode: modes[state.mode],
    // With no text there's nothing to discard: the head's control closes the box.
    discard: {
      disabled: canDiscard !== true,
      why: canDiscard === true ? undefined : canDiscard,
      onClick: () => act(box, 'discard'),
    },
    lines:
      state.restored === undefined
        ? undefined
        : [{ key: 'restored', text: `Draft from ${ago(state.restored, Date.now())}` }],
    actions,
  };
}

/** A note as the frame draws it, with its offers' buttons. */
function drawnNote(box: Box, note: BoxNote): CommentBoxNote {
  return {
    key: note.key,
    tone: note.tone,
    icon: note.icon,
    title: note.title,
    text: note.text,
    // The foot's own buttons send it again: one act has one button.
    actions: note.offers
      ?.filter((offer) => offer !== 'sendAgain')
      .map((offer) => ({ label: offerLabels[offer], onClick: () => act(box, offer) })),
  };
}

function Head({ box, composer }: { box: Box; composer: Composer }): ReactNode {
  const state = useBox(box);
  const linesMenu = useMenuTarget({ kind: 'lines', box: box.id });
  const pull = usePull(box.view);
  const accounts = useAccounts();
  const login = pull?.acting?.kind === 'account' ? pull.acting.login : undefined;
  const { place } = state;
  // The pull request's own box, at the timeline's end, is always there.
  const closes = place.kind !== 'conversation' || box.home.kind === 'block';
  return (
    <CommentBoxHeadBar
      previewing={state.previewing}
      head={{
        onPreviewing: (on) => {
          composer.preview(on);
          box.set({ previewing: on });
        },
        previewKeys: boxKeys('preview'),
        where: state.where?.head ?? whereText(place),
        why: state.where?.why,
        // Who it's from is worth saying only where it could be someone else.
        account:
          login === undefined || (accounts?.length ?? 0) < 2
            ? undefined
            : { login, image: avatarImage({ login, type: 'User' }, AVATAR) },
        close: closes ? { keys: boxKeys('close'), onClick: () => composer.leave() } : undefined,
        // On a new comment's lines, the words are a button whose menu changes them.
        lines: linesChange(box.id) ? { menu: linesMenu } : undefined,
      }}
    />
  );
}

function Notes({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const uploads = useUploads(box, boxKeys('attach'), state.text);
  const notes = [...notesOf(state).map((note) => drawnNote(box, note)), ...uploads.notes];
  return <CommentBoxNotes id={box.id} notes={notes} />;
}

function Foot({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const uploads = useUploads(box, boxKeys('attach'), state.text);
  const pending = usePending(box.view);
  const why = useWhyNot(box) ?? holdText(uploads.hold, UPLOADING);
  const foot = { ...footOf(box, state, why, pending), attach: uploads.attach };
  return <CommentBoxFootBar id={box.id} foot={foot} focused={state.focused} />;
}

/** The text as GitHub would render it, made by the background process while the preview shows. */
function Preview({ box }: { box: Box }): ReactNode {
  const { previewing, text } = useBox(box);
  const pull = pullIn(box.view);
  if (!previewing || !pull) return null;
  return <Rendering view={box.view} text={text} pull={pull} replaced={replacedOf(box)} />;
}

/**
 * The comment as its card will draw it, from the moment it's sent until GitHub answers: the text
 * rendered, under who sent it, with "Sending…" where its time will be, under its thread's head row
 * for a new thread's and over the row that offers a reply for a new thread's and a reply. The box
 * shows only this meanwhile (`Composer.hold`), and is the open box again, with its text, if the send
 * fails. An edit in the timeline is its text alone, in the comment's card, whose head says it's
 * being saved. The pull request's own box gives its comment to the timeline's last row meanwhile,
 * which draws it with the same text and tree.
 */
function Sent({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const pullView = usePull(box.view);
  const acting = pullView?.acting;
  const opener = pullView?.header?.author ?? undefined;
  const pull = pullIn(box.view);
  // Its card, once GitHub's is drawn, shows this text until GitHub's rendering of it is in, as the
  // box did, rather than wait for that rendering: the text never leaves the screen.
  const sent = sendingNow(state) ? state.text : undefined;
  useEffect(() => {
    if (sent !== undefined) wroteText(box.view, sent);
  }, [box.view, sent]);
  if (!sendingNow(state)) return null;
  const login = acting?.kind === 'account' ? acting.login : undefined;
  const { place } = state;
  const { kind } = place;
  // A new thread's head row says what it's on as its card's will: in a popover always, and on a
  // card between lines where it's on more than one line. In the box's words, which it showed.
  const lines =
    place.kind === 'thread' && (threadsMode() === 'beside' || onLines({ lines: place.lines }))
      ? (state.where?.head ?? whereText(place))
      : undefined;
  const body = pull ? (
    <Rendering
      view={box.view}
      text={state.text}
      pull={pull}
      replaced={replacedOf(box)}
      flush
      sent
    />
  ) : (
    <p className="whitespace-pre-wrap">{state.text}</p>
  );
  if (box.drawnIn === 'timeline') {
    return kind === 'edit' ? <SentPost bare body={body} /> : null;
  }
  return (
    <SentPost
      // A new thread's comment draws under the head row its thread will have, and a reply under
      // the thread's comments, each over the row that offers a reply: nothing moves as the thread
      // takes the card's place.
      state={kind === 'thread' ? (box.lastHow === 'review' ? 'Pending' : 'Unresolved') : undefined}
      lines={lines}
      reply={kind === 'thread' || kind === 'reply'}
      author={login}
      byAuthor={login !== undefined && login.toLowerCase() === opener?.toLowerCase()}
      image={login === undefined ? undefined : avatarImage({ login, type: 'User' }, AVATAR)}
      label={sentLabel(state.sending, kind === 'edit')}
      body={body}
    />
  );
}

/**
 * A part of the frame whose right-click opens the box's menu: what its notes' buttons do. The
 * editor keeps the system's Edit menu.
 */
function OnMenu({ box, children }: { box: Box; children: ReactNode }): ReactNode {
  return <div {...useMenuTarget({ kind: 'box', box: box.id })}>{children}</div>;
}

/** What draws `box`'s frame in the parts the code view makes. */
export function frameOf(box: Box): BoxFrame {
  return (parts, composer) => {
    const roots = [
      [
        parts.head,
        <OnMenu key="head" box={box}>
          <Head box={box} composer={composer} />
        </OnMenu>,
      ],
      [
        parts.note,
        <OnMenu key="notes" box={box}>
          <Notes box={box} />
        </OnMenu>,
      ],
      [parts.preview, <Preview key="preview" box={box} />],
      [parts.sent, <Sent key="sent" box={box} />],
      [parts.dropzone, <Dropzone key="dropzone" box={box} />],
      [parts.uploads, <UploadRows key="uploads" box={box} />],
      [
        parts.foot,
        <OnMenu key="foot" box={box}>
          <Foot box={box} />
        </OnMenu>,
      ],
    ] as const;
    const made = roots.map(([part]) => createRoot(part));
    // Drawn now, not after the page is painted with the box: one that opens with no input, as a
    // draft restored, would grow after, and move what's under it on screen.
    flushSync(() => {
      for (const [at, root] of made.entries()) root.render(roots[at]![1]);
    });
    // Focus in the box shows its mode, with Vim keys on.
    const frame = parts.head.parentElement;
    const into = () => box.set({ focused: true });
    const out = (event: FocusEvent) => {
      const to = event.relatedTarget;
      if (!(to instanceof Node) || !frame?.contains(to)) box.set({ focused: false });
    };
    frame?.addEventListener('focusin', into);
    frame?.addEventListener('focusout', out);
    if (frame?.contains(document.activeElement)) box.set({ focused: true });
    // An image's address pasted or dropped where the view takes no uploads goes in as an image.
    const stopAddresses = frame ? takeAddresses(frame, box) : undefined;
    return {
      destroy() {
        frame?.removeEventListener('focusin', into);
        frame?.removeEventListener('focusout', out);
        stopAddresses?.();
        // Before focus is let go: a box the diff takes down as it's drawn again takes focus there
        // again if it had it.
        takenDown(box, composer);
        box.set({ focused: false, previewing: false });
        // Not while React may be rendering, as when the view takes boxes down in an effect.
        queueMicrotask(() => {
          for (const root of made) root.unmount();
        });
      },
    };
  };
}
