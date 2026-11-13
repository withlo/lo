// A comment box's frame in a diff, drawn in the parts the code view makes around its editor: the
// head, with Write and Preview, where the comment goes and who it's from; the notes, of a restored
// draft, a refusal with what to do about it, or how sending stands; the preview, the text as GitHub
// would render it; and the foot, with Vim's mode and the buttons that send. Each part is a React
// root of its own, drawn from the box's state.

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
import { Markdown, secureLink, type Followed } from '@lo/ui/markdown';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { registry } from '../../../window/commands/registry.ts';
import { avatarImage, postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import { usePull, useRun } from '../../tab/window/shared.ts';
import { MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { act, type Box, type BoxState, pullIn, send, takenDown } from './boxes.ts';
import { commentsJobs } from './main.ts';
import {
  IN_A_LAYER,
  OFFLINE,
  offerLabels,
  refusalNote,
  restoredNote,
  sendingNote,
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
  const waiting =
    state.busy ||
    state.sending === 'waiting' ||
    state.sending === 'sending' ||
    state.sending === 'checking';
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
  const why = useWhyNot(box);
  const notes = [
    state.restored === undefined ? undefined : restoredNote(state.restored, Date.now()),
    state.refusal && refusalNote(state.refusal),
    sendingNote(state.sending),
  ].flatMap((note) => (note ? [drawnNote(box, note)] : []));
  return <CommentBoxNotes id={box.id} notes={notes} foot={footOf(box, state, why)} />;
}

function Foot({ box }: { box: Box }): ReactNode {
  const state = useBox(box);
  const why = useWhyNot(box);
  return <CommentBoxFootBar id={box.id} foot={footOf(box, state, why)} focused={state.focused} />;
}

/** Opens a link followed in the preview: an `https` page, through main. */
function follow(target: Followed): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

/** The text as GitHub would render it, made by the background process while the preview shows. */
function Preview({ box }: { box: Box }): ReactNode {
  const { previewing, text } = useBox(box);
  const [rendered, setRendered] = useState<{ text: string; rendered: Rendered }>();
  const pull = pullIn(box.view);
  useEffect(() => {
    if (!previewing || !pull) return undefined;
    const stop = new AbortController();
    const markdown = text.slice(0, MARKDOWN_LIMIT);
    const page = `https://github.com/${pull.owner}/${pull.repo}/pull/${pull.number}`;
    commentsJobs()
      .render(
        { html: null, markdown, repo: { owner: pull.owner, name: pull.repo }, page },
        { signal: stop.signal },
      )
      .then((made: Rendered) => {
        if (!stop.signal.aborted) setRendered({ text, rendered: made });
      })
      .catch((error: unknown) => {
        if (!stop.signal.aborted) console.error("Lo couldn't draw a comment's preview:", error);
      });
    return () => stop.abort();
  }, [previewing, text, pull]);
  if (!previewing) return null;
  if (text.trim() === '') return <p className="px-12 py-8 text-fg-muted">Nothing to preview</p>;
  return (
    <div className="px-12 py-8">
      {rendered?.text === text ? (
        <Markdown
          tree={rendered.rendered.tree}
          onFollow={follow}
          images={(url) => postImage(box.view, url)}
          className="lo-prose read-comment"
        />
      ) : (
        <p className="whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}

/** What draws `box`'s frame in the parts the code view makes. */
export function frameOf(box: Box): BoxFrame {
  return (parts, composer) => {
    const roots = [
      [parts.head, <Head key="head" box={box} composer={composer} />],
      [parts.note, <Notes key="notes" box={box} />],
      [parts.preview, <Preview key="preview" box={box} />],
      [parts.foot, <Foot key="foot" box={box} />],
    ] as const;
    const made = roots.map(([part, drawn]) => {
      const root = createRoot(part);
      root.render(drawn);
      return root;
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
    return {
      destroy() {
        frame?.removeEventListener('focusin', into);
        frame?.removeEventListener('focusout', out);
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
