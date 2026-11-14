// A comment box's frame in a diff, drawn in the parts the code view makes around its editor: the
// head, with Write and Preview, where the comment goes and who it's from; the notes, of a restored
// draft, a refusal with what to do about it, or how sending stands; the preview, the text as GitHub
// would render it; the files attached to it (`./Attached.tsx`); and the foot, with Vim's mode,
// "Attach" and the buttons that send. Each part is a React root of its own, drawn from the box's
// state, and drawn at once as the box is made, so it's as tall as it'll be before it's on screen.

import {
  CommentBoxFootBar,
  CommentBoxHeadBar,
  CommentBoxNotes,
  type CommentBoxAction,
  type CommentBoxFoot,
  type CommentBoxNote,
} from '@lo/ui';
import type { BoxFrame, Composer, Mode } from '@lo/ui/code';
import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';
import { useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { avatarImage } from '../../../window/images.ts';
import { usePull, useRun } from '../../tab/window/shared.ts';
import { act, type Box, type BoxState, pullIn, send, sendingNow, takenDown } from './boxes.ts';
import { Preview as Rendering } from './Preview.tsx';
import { Dropzone, UploadRows, useUploads } from './Attached.tsx';
import { holdText, takeAddresses, UPLOADING } from './uploads.ts';
import {
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

/** A key the box takes, as this system shows it. */
function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

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

/** The foot's buttons: the main one, as `c` or `C` opened the box, last. */
function footOf(box: Box, state: BoxState, why: string | undefined): CommentBoxFoot {
  const waiting = sendingNow(state);
  const blank = state.text.trim() === '';
  const button = (how: 'review' | 'now'): CommentBoxAction => ({
    label: how === 'review' ? 'Add to review' : 'Comment now',
    keys: labels(how === 'review' ? 'cmd+enter' : 'alt+enter'),
    primary: state.primary === how,
    disabled: why !== undefined || waiting || blank,
    why,
    onClick: () => void send(box, how),
  });
  const actions =
    state.primary === 'review'
      ? [button('now'), button('review')]
      : [button('review'), button('now')];
  return { mode: modes[state.mode], actions };
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
  const login = pull?.acting?.kind === 'account' ? pull.acting.login : undefined;
  return (
    <CommentBoxHeadBar
      previewing={state.previewing}
      head={{
        onPreviewing: (on) => {
          composer.preview(on);
          box.set({ previewing: on });
        },
        previewKeys: labels('cmd+shift+v'),
        where: whereText(state.place),
        account:
          login === undefined
            ? undefined
            : { login, image: avatarImage({ login, type: 'User' }, AVATAR) },
      }}
    />
  );
}

function Notes({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const uploads = useUploads(box, labels('cmd+shift+a'), state.text);
  const why = useWhyNot(box) ?? holdText(uploads.hold, UPLOADING);
  const notes = [
    ...notesOf(state, Date.now()).map((note) => drawnNote(box, note)),
    ...uploads.notes,
  ];
  return <CommentBoxNotes id={box.id} notes={notes} foot={footOf(box, state, why)} />;
}

function Foot({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const uploads = useUploads(box, labels('cmd+shift+a'), state.text);
  const why = useWhyNot(box) ?? holdText(uploads.hold, UPLOADING);
  const foot = { ...footOf(box, state, why), attach: uploads.attach };
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
    // Focus in the box lights its mode chip.
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
        box.set({ focused: false, previewing: false });
        takenDown(box, composer);
        // Not while React may be rendering, as when the view takes boxes down in an effect.
        queueMicrotask(() => {
          for (const root of made) root.unmount();
        });
      },
    };
  };
}
