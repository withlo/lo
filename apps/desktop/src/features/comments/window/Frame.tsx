// A comment box's frame in a diff, drawn in the parts the code view makes around its editor: the
// head, with Write and Preview, where the comment goes, or the thread a reply is to, or that it's
// an edit, and who it's from; the notes, of a restored
// draft, a refusal with what to do about it, or how sending stands; the preview, the text as GitHub
// would render it; and the foot, with Vim's mode and the buttons that send. Each part is a React
// root of its own, drawn from the box's state, and drawn at once as the box is made, so it's as
// tall as it'll be before it's on screen.

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
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { avatarImage, postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import { usePull, useRun, useTabState } from '../../tab/window/shared.ts';
import { MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { act, type Box, type BoxState, pullIn, send, sendingNow, takenDown } from './boxes.ts';
import { commentsJobs } from './main.ts';
import { held } from './threads.ts';
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

/** What each of a box's buttons says, by what it does: a reply's say it replies. */
function buttonLabel(state: BoxState, how: 'review' | 'now'): string {
  if (how === 'review') return 'Add to review';
  return state.place.kind === 'reply' ? 'Reply now' : 'Comment now';
}

/**
 * The foot's buttons: the main one, as `c` or `C` opened the box, last. An edit's has one, which
 * saves it.
 */
function footOf(box: Box, state: BoxState, why: string | undefined): CommentBoxFoot {
  const waiting = sendingNow(state);
  const blank = state.text.trim() === '';
  const disabled = why !== undefined || waiting || blank;
  if (state.place.kind === 'edit') {
    const save: CommentBoxAction = {
      label: 'Save the edit',
      keys: labels('cmd+enter'),
      primary: true,
      disabled,
      why,
      onClick: () => void send(box, 'review'),
    };
    return { mode: modes[state.mode], actions: [save] };
  }
  const button = (how: 'review' | 'now'): CommentBoxAction => ({
    label: buttonLabel(state, how),
    keys: labels(how === 'review' ? 'cmd+enter' : 'alt+enter'),
    primary: state.primary === how,
    disabled,
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
  const { place } = state;
  // Who started the thread a reply is to.
  const started = useTabState(held, box.view, (value) =>
    place.kind === 'reply'
      ? value.threads?.threads.find((each) => each.id === place.thread)?.comments[0]?.author
      : undefined,
  );
  return (
    <CommentBoxHeadBar
      previewing={state.previewing}
      head={{
        onPreviewing: (on) => {
          composer.preview(on);
          box.set({ previewing: on });
        },
        previewKeys: labels('cmd+shift+v'),
        where: whereText(place, started),
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
  const notes = notesOf(state, Date.now()).map((note) => drawnNote(box, note));
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
