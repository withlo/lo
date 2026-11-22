// A comment box's frame, the same wherever a comment is written, drawn in the parts the code view
// makes around its editor: the head, which says what the comment is on, with Write and Preview and
// the control that closes the box; the notes, of a refusal with what to do about it, or how sending
// stands; the preview, the text as GitHub would render it; the files attached to it
// (`./Attached.tsx`); and the foot, with "Attach files…", "Discard draft" and the buttons that
// send, each dimmed with its reason as its tooltip while it can't. Each part is a React root of its
// own, drawn from the box's state, and drawn at once as the box is made, so it's as tall as it'll
// be before it's on screen.

import {
  CommentBoxFootBar,
  CommentBoxHeadBar,
  CommentBoxNotes,
  type CommentBoxAction,
  type CommentBoxFoot,
  type CommentBoxNote,
} from '@lo/ui';
import type { BoxFrame, Composer, Mode } from '@lo/ui/code';
import { useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { avatarImage } from '../../../window/images.ts';
import { useAccounts } from '../../accounts/window/shared.ts';
import { usePull, useRun, useTabState } from '../../tab/window/shared.ts';
import { act, type Box, type BoxState, pullIn, send, sendingNow, takenDown } from './boxes.ts';
import { boxKeys } from './boxkeys.ts';
import { ago } from './Card.tsx';
import { Preview as Rendering } from './Preview.tsx';
import { Dropzone, UploadRows, useUploads } from './Attached.tsx';
import { holdText, takeAddresses, UPLOADING } from './uploads.ts';
import { held } from './threads.ts';
import {
  BLANK,
  IN_A_LAYER,
  notesOf,
  OFFLINE,
  offerLabels,
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
  if (pull.connection.kind === 'offline') return OFFLINE;
  return undefined;
}

/** Whether view `view` has a pending review, which GitHub adds every comment sent to. */
function usePending(view: string): boolean {
  return useTabState(held, view, (value) => value.review?.review.kind === 'pending');
}

/**
 * The foot's buttons: the main one, as `c` or `C` opened the box, last. While a pending review
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
  const reason = why ?? (blank ? BLANK : undefined);
  const disabled = reason !== undefined || waiting;
  const { kind } = state.place;
  const alone = (label: string, how: 'review' | 'now', working: string): CommentBoxAction => ({
    label,
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
      ? [alone('Send', 'now', 'Sending…')]
      : kind === 'edit'
        ? [alone('Save', 'review', 'Saving…')]
        : pending
          ? [alone('Add to review', 'review', 'Sending…')]
          : state.primary === 'review'
            ? [button('now'), button('review')]
            : [button('review'), button('now')];
  return {
    mode: modes[state.mode],
    // The pull request's own box never closes: with no text, it has nothing to discard.
    discard: {
      disabled: waiting || (blank && kind === 'conversation'),
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
    text: note.text,
    actions: note.offers?.map((offer) => ({
      label: offerLabels[offer],
      onClick: () => act(box, offer),
    })),
  };
}

function Head({ box, composer }: { box: Box; composer: Composer }): ReactNode {
  const state = useBox(box);
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
  return <Rendering view={box.view} text={text} pull={pull} />;
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
