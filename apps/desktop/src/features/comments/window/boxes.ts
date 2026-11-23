// The comment boxes of each view's diff, of its overview's code blocks and of its timeline, in the
// window until the view's tab closes: where each is, its text, and how sending it stands, as main
// keeps its draft. A box opens from `c`, `C`, `s` or a file's `c` in the diff, and in a thread,
// right after its card, from `r` (a reply) or `i` (an edit of your comment, which starts from
// GitHub's text and saves over it); from `c` on a code block, under the block's lines, on the lines
// they are at the head on screen, their file, or the pull request; and in the timeline, the pull
// request's own box at its end, and an edit of your comment there in its card. A draft opens in one
// box only: under the block it was written on while the tab's overview has that block, and
// otherwise where a draft of its place opens, in the diff for lines and a file, and in the timeline
// for the pull request. A box showing a draft keeps it while it's open, whatever the overview does,
// and a draft in no box waits while Lo can't tell whether the overview has its block. A draft main
// restored reopens there, unfocused, once its view's diff draws its line, its block is drawn or its
// timeline is, and so does a box the diff or a block took down as it was drawn again, or the
// timeline let go as it went, and, after the window is loaded again, every draft's. Text is saved
// 300 ms after typing stops, and at once as the box closes or the window goes. While it's sent, and
// until Lo knows whether it posted, its text is held as it is. A box goes once what it sent is on
// GitHub, or its draft is discarded; `Esc Esc` closes it and keeps the draft for the next box
// there. Files dropped on it, pasted into it or picked are attached (`./uploads.ts`). It isn't sent
// while one is on its way in, nor while its text holds a placeholder whose upload isn't, and its
// uploads are given up as its draft goes.

import {
  lineRefText,
  Lines,
  Screen,
  suggestionBlock,
  takesSuggestion,
  type LineRef,
} from '@lo/review';
import type { Composer, ComposerEvents, KeptBox, Mode, Send } from '@lo/ui/code';
import {
  type BoxTarget,
  controlOf,
  type Handler,
  type HeaderTarget,
  KEY_EVENT,
  type LineTarget,
  runControl,
  type Target,
} from '@lo/ui/commands';

import { announce, notice, refuse, withdraw } from '../../../window/commands/notices.tsx';
import { registry } from '../../../window/commands/registry.ts';
import { offlineLabel } from '../../../window/explain.ts';
import { client } from '../../../window/ipc.ts';
import {
  diffStateOf,
  onDiffDrawn,
  showDiff,
  writingDiff,
  type WritingDiff,
} from '../../diff/window/shared.ts';
import {
  blockInOverview,
  blockKey,
  blockLines,
  commentOnHead,
  revisionName,
  writingBlock,
  type WritingBlock,
} from '../../overview/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { pullOf, runOf, tabState, type PullTab } from '../../tab/window/shared.ts';
import type {
  ActOutcome,
  Commentable,
  DraftHomeRow,
  DraftPlaceRow,
  DraftRow,
  DraftsView,
  JoinedView,
  SendOutcome,
  Sending,
  ThreadRow,
} from '../contract.ts';
import { main, tabs } from './main.ts';
import { screenOf } from './placing.ts';
import type { PostPull } from './Post.tsx';
import { tell } from './Said.tsx';
import { landed } from './landed.ts';
import { held, shownAt } from './threads.ts';
import {
  attachFiles,
  clearStranded,
  draggingOver,
  endUploads,
  pickFiles,
  uploadsHold,
} from './uploads.ts';
import { wrotePull } from './written.ts';
import {
  blockComment,
  blockWhere,
  type BoxWhere,
  boxAt,
  commentableOn,
  githubPath,
  IN_A_LAYER,
  inTimeline,
  linesAt,
  NEW_SIDE_ONLY,
  NO_LINES,
  NOT_IN_DIFF,
  notesOf,
  offersOf,
  type Offer,
  ON_FILE_NOT_IN_DIFF,
  ON_PULL,
  placeKey,
  placeOf,
  type Refusal,
  sentFromBlock,
  sentLabel,
  SIGN_IN,
  whyOf,
  NOTHING_TO_DISCARD,
  NOTHING_TO_UNDO,
} from './writing.ts';

/** How long after the last key a box's text is saved, in milliseconds. */
export const SAVE_AFTER = 300;

/**
 * How often a box that couldn't open yet tries again while its file's lines come, and how many
 * times.
 */
const RETRY_AFTER = 500;
const RETRIES = 20;

/** What a box's frame shows, which changes as it's typed in and sent. */
export interface BoxState {
  readonly place: DraftPlaceRow;
  /** What its main button does: `C` makes it post right away. */
  readonly primary: Send;
  readonly text: string;
  readonly mode: Mode;
  readonly previewing: boolean;
  /** Focus is in the box. */
  readonly focused: boolean;
  /** When the draft it shows was saved, for a draft restored as Lo started. */
  readonly restored: number | undefined;
  /** How sending it stands, as main says. */
  readonly sending: Sending | null;
  /** A send was asked for, and main hasn't answered. */
  readonly busy: boolean;
  /**
   * GitHub took the comment, and its card isn't drawn yet: the box shows it meanwhile, so its text
   * never leaves the screen.
   */
  readonly landing: boolean;
  /** Why the last send was refused. */
  readonly refusal: Refusal | undefined;
  /**
   * What its head says of where the comment goes, where that's more than its place says, as for a
   * comment on a block's file in place of its lines.
   */
  readonly where: BoxWhere | undefined;
}

/**
 * Where a box would rather be drawn: in its view's diff, or under lines of a code block of its
 * overview, the block it was written from, as main keeps with its draft. A draft keeps that block
 * as its home wherever its comment goes, the pull request included, and opens there while the
 * tab's overview has the block; otherwise where a draft of its place opens with no home
 * ({@link opensAt}).
 */
export type Home =
  { readonly kind: 'diff' } | { readonly kind: 'block'; readonly block: DraftHomeRow };

/** In the diff. */
export const IN_DIFF: Home = { kind: 'diff' };

/** The home main keeps with a box's draft: its block, or none for the diff. */
function homeRow(home: Home): DraftHomeRow | null {
  return home.kind === 'block' ? home.block : null;
}

/** The home of a draft main kept: its block, or the diff. */
function homeOf(row: DraftRow): Home {
  return row.home ? { kind: 'block', block: row.home } : IN_DIFF;
}

/** The key of the block a box's home is, as the overview draws it (`DrawnBlock.key`). */
function keyOfBlock(home: DraftHomeRow): string {
  return blockKey(home.commit, home.path, home.block.start, home.block.end);
}

/**
 * Whether a draft with `home` opens under its block in view `view`: it has one, and the tab's
 * overview has it now. `unknown` while Lo is still reading or checking the overview. A draft opens
 * in one box only: one on the pull request that doesn't open under a block is the timeline's.
 */
export function opensUnderBlock(view: string, home: DraftHomeRow | null): boolean | 'unknown' {
  return home ? blockInOverview(view, keyOfBlock(home)) : false;
}

/**
 * Where a box opens now, in one place only: under its home block, while the tab's overview has it;
 * otherwise where a draft of its place opens with no home, the diff for lines and a file, and the
 * timeline for the pull request itself, its own box or an edit of your comment there. It `waits`
 * while Lo can't tell yet whether the overview has its block.
 */
type Opens =
  | { readonly kind: 'block'; readonly block: DraftHomeRow }
  | { readonly kind: 'diff' }
  | { readonly kind: 'timeline' }
  | { readonly kind: 'waits' };

function opensAt(box: Box): Opens {
  // Taken down open as the diff was drawn again, it's still in its box there, whatever the
  // overview did meanwhile, until the diff drawn anew has placed it or couldn't.
  if (box.kept !== undefined) return IN_DIFF;
  const { home } = box;
  if (home.kind === 'block') {
    const under = opensUnderBlock(box.view, home.block);
    if (under === true) return home;
    if (under === 'unknown') return { kind: 'waits' };
  }
  return inTimeline(box.state.place) ? { kind: 'timeline' } : IN_DIFF;
}

/**
 * Whether box `box` is the draft the box at the end of its view's timeline keeps: the one it's
 * showing, while it's open, whatever the overview does, so nothing on screen moves and focus stays;
 * otherwise a comment on the pull request itself with no home, or whose block the tab's overview
 * doesn't have now. Not one that waits while Lo can't tell: it opens in one box only.
 */
function isPullsOwn(box: Box): boolean {
  if (box.state.place.kind !== 'conversation') return false;
  if (box.composer !== undefined && box.drawnIn === 'timeline') return true;
  return opensUnderBlock(box.view, homeRow(box.home)) === false;
}

/**
 * Where a box is drawn, as a key, where another box can be drawn there too: under a block's line
 * on its side, where one box goes, or under the last line of a new thread's lines in the diff, or
 * its file's header. Nothing for one drawn by its thread.
 */
function spotOf(home: Home, place: DraftPlaceRow): string | undefined {
  if (home.kind === 'block') {
    const { side, to } = home.block.at;
    return JSON.stringify([keyOfBlock(home.block), side, to]);
  }
  if (place.kind !== 'thread') return undefined;
  const end = place.lines?.end;
  return JSON.stringify([place.commit.toLowerCase(), place.path, end?.side, end?.number]);
}

/** Where box `box`, drawn, is, as {@link spotOf} keys it. */
function spotOfBox(box: Box): string | undefined {
  return spotOf(box.drawnIn === 'block' ? box.home : IN_DIFF, box.state.place);
}

/** What a box's head says of where a draft written on a block goes, as main kept it. */
function whereOf(view: string, home: DraftHomeRow, place: DraftPlaceRow): BoxWhere | undefined {
  return blockWhere(home.why, place, {
    written: revisionName(view, home.commit),
    now: revisionName(view, home.head),
  });
}

/**
 * Whether a box's comment is being sent, may be on GitHub, or is and waits for its card: its text
 * is held as it is.
 */
export function sendingNow(state: BoxState): boolean {
  const { busy, sending, landing } = state;
  return (
    busy || landing || sending === 'waiting' || sending === 'sending' || sending === 'checking'
  );
}

/**
 * Whether `box` may take focus for what it says: focus is in it already, or nowhere. A reader who
 * left it for the code, or for anything else, keeps their place there, and what they see.
 */
function mayFocus(box: Box): boolean {
  const active = document.activeElement;
  return box.state.focused || active === null || active === document.body;
}

/**
 * Says what changed in how a box's comment stands, to a screen reader, and shows it: that it's on
 * its way, or being looked for, which brings its card on screen whole; and, once the box is written
 * in again with a note on it, the note, with focus back in the box, where what the note offers is
 * one key away. Neither takes focus, or the screen, from a reader who has left the box.
 */
function told(box: Box, was: BoxState): void {
  const now = box.state;
  const edit = now.place.kind === 'edit';
  const heldNow = sendingNow(now);
  const heldBefore = sendingNow(was);
  if (heldNow) {
    if (now.landing) return;
    const label = sentLabel(now.sending, edit);
    if (heldBefore && !was.landing && label === sentLabel(was.sending, edit)) return;
    tell(label);
    // Looked for, as its note asked or as its answer was lost: the card that says so comes on
    // screen whole.
    if (now.sending === 'checking' && was.sending !== 'checking' && mayFocus(box)) {
      box.composer?.focus();
    }
    return;
  }
  const notes = notesOf(now);
  const first = notes[0];
  if (first === undefined) return;
  const before = notesOf(was)[0];
  if (!heldBefore && before?.title === first.title && before?.text === first.text) return;
  tell([first.title, first.text].filter((each) => each !== undefined && each !== '').join('. '));
  if (box.composer && mayFocus(box)) box.composer.focus();
}

/** What's said to a screen reader once GitHub took a box's comment: its card shows the rest. */
function sentWords(place: DraftPlaceRow, how: Send): string {
  if (place.kind === 'edit') return 'Saved edit';
  const what = place.kind === 'reply' ? 'reply' : 'comment';
  return how === 'now' ? `Sent ${what}` : `Added ${what} to review`;
}

/** A comment box of a view's diff. */
export class Box {
  readonly view: string;
  readonly key: string;
  /** Its id, which ties its foot's buttons to the notes that say why they're off. */
  readonly id: string;
  /** The box the diff draws, while it does. */
  composer: Composer | undefined;
  /** Whether it shows once its view's diff draws its line: it's open, or comes back open. */
  open = false;
  /** Whether it takes focus once it opens. */
  focusOnOpen = false;
  /** How the last send was asked for, for one sent again once it's known not to have gone. */
  lastHow: Send;
  /** Whether main marked its draft sent, as after GitHub's answer to it was lost. */
  sentMark = false;
  /** What its view's threads held as it was last sent, to tell its comment's card by as it comes. */
  before: Before | undefined;
  retries = 0;
  /** Where it would rather be drawn. */
  home: Home = IN_DIFF;
  /** Where its composer is drawn, while it has one. */
  drawnIn: 'diff' | 'block' | 'timeline' | undefined;
  /**
   * The box as it was as the diff, drawn again, took it down open: it opens in the diff drawn anew
   * as it was, whatever the overview did meanwhile, until that diff has placed it or couldn't
   * ({@link placeKept}).
   */
  kept: Kept | undefined;
  /** Its editor is taking main's text, not the reader's typing, which isn't saved again. */
  taking = false;
  /**
   * What takes focus once the box goes while it had it, where the view it's drawn in doesn't take
   * it back itself, as the timeline's list does.
   */
  left: (() => void) | undefined;
  #state: BoxState;
  #save: ReturnType<typeof setTimeout> | undefined;
  readonly #listeners = new Set<() => void>();

  constructor(view: string, place: DraftPlaceRow, primary: Send, text: string) {
    this.view = view;
    this.key = placeKey(place);
    this.id = `lo-box-${++made}`;
    this.lastHow = primary;
    this.#state = {
      place,
      primary,
      text,
      mode: 'insert',
      previewing: false,
      focused: false,
      restored: undefined,
      sending: null,
      busy: false,
      landing: false,
      refusal: undefined,
      where: undefined,
    };
  }

  get state(): BoxState {
    return this.#state;
  }

  set(change: Partial<BoxState>): void {
    const was = this.#state;
    this.#state = { ...was, ...change };
    this.composer?.hold(sendingNow(this.#state));
    for (const listener of this.#listeners) listener();
    told(this, was);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Saves its text in a moment, once typing stops. */
  saveSoon(): void {
    clearTimeout(this.#save);
    this.#save = setTimeout(() => this.saveNow(), SAVE_AFTER);
  }

  /** Saves its text now, if it's waiting to be saved. */
  saveNow(): void {
    if (this.#save === undefined) return;
    clearTimeout(this.#save);
    this.#save = undefined;
    save(this.view, this.state.place, this.state.text, homeRow(this.home));
  }

  /** Whether its text is waiting to be saved. */
  get saving(): boolean {
    return this.#save !== undefined;
  }

  /**
   * Puts `text` in as its text while it isn't drawn, as when an upload's placeholder becomes its
   * Markdown, and saves it once typing would have stopped.
   */
  rewrite(text: string): void {
    this.set({ text, restored: undefined });
    this.saveSoon();
  }

  /** Forgets the text waiting to be saved, as when its draft is discarded or sent. */
  dropSave(): void {
    clearTimeout(this.#save);
    this.#save = undefined;
  }
}

let made = 0;

/** Each view's boxes, by their places' keys. */
const views = new Map<string, Map<string, Box>>();

/** The pull request each view shows, as its diff was drawn. */
const pulls = new Map<string, PostPull>();

/** What main said of the comments each file takes, by view, commit and path, with the view. */
const commentables = new Map<string, { view: string; asked: Promise<Commentable> }>();

/**
 * Each view's places whose drafts were dropped here, until main says so: drafts it sent before it
 * heard don't bring their boxes back.
 */
const dropped = new Map<string, Set<string>>();

/** The views whose drafts the window has heard of since it was loaded. */
const heard = new Set<string>();

function boxesOf(view: string): Map<string, Box> {
  let own = views.get(view);
  if (!own) {
    own = new Map();
    views.set(view, own);
  }
  return own;
}

function save(view: string, place: DraftPlaceRow, text: string, home: DraftHomeRow | null): void {
  main()
    .draft({ id: view, place, text, home })
    .catch((error: unknown) => console.error("Lo couldn't save a comment's draft:", error));
}

/** The box named `id`, its frame's name for it, in any view. */
export function boxNamed(id: string): Box | undefined {
  for (const own of views.values()) {
    for (const box of own.values()) if (box.id === id) return box;
  }
  return undefined;
}

/** Notes the pull request `tab` shows, as its diff is drawn. */
export function knowPull(tab: PullTab): void {
  pulls.set(tab.id, { owner: tab.owner, repo: tab.repo, number: tab.number });
}

/** The pull request view `view` shows, once its diff has been drawn. */
export function pullIn(view: string): PostPull | undefined {
  return pulls.get(view);
}

/** Why view `view` can't take a comment now, or `true`. */
export function canWrite(view: string): true | string {
  const pull = pullOf(view);
  if (pull?.acting?.kind !== 'account') return SIGN_IN;
  if (runOf(view)) return IN_A_LAYER;
  return true;
}

/** The login view `view` writes as, if it writes as anyone. */
export function loginOf(view: string): string | undefined {
  const acting = pullOf(view)?.acting;
  return acting?.kind === 'account' ? acting.login : undefined;
}

/**
 * Why nothing sends for view `view` while GitHub gives it no answer, as the header's chip calls
 * why ("Offline", "No response"), or nothing while GitHub answers.
 */
export function offline(view: string): string | undefined {
  const connection = pullOf(view)?.connection;
  return connection?.kind === 'offline' ? offlineLabel(connection.cause) : undefined;
}

/** The screen a view's diff shows, as its threads are placed on it, for a file of it. */
function screenFor(view: string, diff: WritingDiff, since: boolean) {
  const drawn = diff.drawn();
  const screen = screenOf(drawn, held.get(view).threads?.compared ?? null);
  return since ? { ...screen, left: { kind: 'replayed' as const, head: drawn.at } } : screen;
}

/**
 * Which comments GitHub takes on a file at a revision, as main says, asked once a view: asked again
 * while main can't tell.
 */
function commentableOf(
  view: string,
  commit: string,
  path: string,
  previous: string | null,
): Promise<Commentable> {
  const key = JSON.stringify([view, commit, path, previous]);
  let asked = commentables.get(key)?.asked;
  if (!asked) {
    const asking: Promise<Commentable> = main()
      .commentable({ id: view, commit, path, previous })
      .catch((error: unknown): Commentable => {
        console.error("Lo couldn't read which lines take a comment:", error);
        return { kind: 'unknown' };
      })
      .then((answer) => {
        if (answer.kind === 'unknown' && commentables.get(key)?.asked === asking) {
          commentables.delete(key);
        }
        return answer;
      });
    asked = asking;
    commentables.set(key, { view, asked });
  }
  return asked;
}

/** The events of a box the diff draws. */
function eventsOf(box: Box): ComposerEvents {
  return {
    change(text) {
      if (box.taking) {
        box.set({ text });
        return;
      }
      box.set({ text, restored: undefined });
      box.saveSoon();
    },
    submit(how) {
      void send(box, how);
    },
    close(keep) {
      box.composer = undefined;
      box.open = false;
      // Shut, it's kept nowhere, and takes no focus the next time it opens by itself.
      box.kept = undefined;
      box.focusOnOpen = false;
      unsay(box);
      replyingChanged(box.view);
      if (keep) {
        box.saveNow();
        return;
      }
      // Nothing to keep: its draft goes, unless main is still settling what it sent, and nothing
      // still uploading goes into it. An edit's keeps its draft even with no text, so it goes as
      // discarded.
      box.dropSave();
      endUploads(box);
      if (box.sentMark || box.state.busy) return;
      boxesOf(box.view).delete(box.key);
      holdDropped(box);
      if (box.state.place.kind === 'edit') discard(box);
      else save(box.view, box.state.place, '', null);
    },
    mode(mode) {
      box.set({ mode });
    },
    preview(on) {
      box.set({ previewing: on });
    },
    // Nothing is attached while its text is held, as while it's sent.
    attach() {
      if (!sendingNow(box.state)) pickFiles(box);
    },
    files(files) {
      if (!sendingNow(box.state)) attachFiles(box, files);
    },
    dragging(count) {
      draggingOver(box, count);
    },
  };
}

/**
 * What draws a box's frame: given by the window feature, so the frame's React stays out of here.
 */
let framer: ((box: Box) => Parameters<WritingDiff['compose']>[3]) | undefined;

/** Takes `given` as what draws boxes' frames. */
export function frameWith(given: (box: Box) => Parameters<WritingDiff['compose']>[3]): void {
  framer = given;
}

/**
 * Opens `box` where it opens now ({@link opensAt}), if its place is drawn: in its view's diff,
 * `diff`, or under its code block's lines while the block is drawn; focused when it asks to be.
 * Says whether it's open.
 */
function show(box: Box, diff: WritingDiff | undefined): boolean {
  if (box.composer) {
    if (box.focusOnOpen) box.composer.focus();
    box.focusOnOpen = false;
    return true;
  }
  const options = {
    focus: box.focusOnOpen,
    name: box.id,
    hint: hintOf(box.state.place),
    ...editsOf(box.state.place),
  };
  try {
    const opens = opensAt(box);
    if (opens.kind === 'block') {
      const block = writingBlock(box.view, keyOfBlock(opens.block));
      if (!block) return false;
      const { file } = block.block;
      const { side, from, to } = opens.block.at;
      const at = from === to ? { file, side, line: to } : { file, side, from, to };
      // A block draws one box under a line: another box's there stays, and this one waits.
      const spot = spotOf(opens, box.state.place);
      const there = [...boxesOf(box.view).values()].find(
        (each) => each !== box && each.composer && spotOfBox(each) === spot,
      );
      if (there) return false;
      drew(box, block.compose(at, box.state.text, eventsOf(box), framer?.(box), options), 'block');
    } else {
      if (opens.kind !== 'diff' || !diff) return false;
      const where = inDiffAt(box, diff);
      if (!where) return false;
      const { text } = box.state;
      drew(box, diff.compose(where.at, text, eventsOf(box), framer?.(box), options), 'diff');
    }
  } catch {
    // Its line isn't drawn yet, as while its file's diff is worked out.
    return false;
  }
  return true;
}

/** What a box at `place` says while it's empty, where its place has a name of its own. */
export function hintOf(place: DraftPlaceRow, pull?: number): string | undefined {
  return place.kind === 'conversation' && pull !== undefined ? `Comment on #${pull}` : undefined;
}

/** The comment a box at `place` edits in a thread's card, where the code view opens it. */
function editsOf(place: DraftPlaceRow): { edits?: string } {
  return place.kind === 'edit' && place.thread !== null ? { edits: place.comment } : {};
}

/** Box `box` is drawn, as `composer`, in `where`. */
function drew(box: Box, composer: Composer, where: 'diff' | 'block'): void {
  box.composer = composer;
  box.drawnIn = where;
  // Its text was rewritten as its frame was drawn, before there was an editor to change, as when a
  // draft comes back with a placeholder whose upload is gone: the editor takes the text as it is.
  const { text } = box.state;
  if (composer.text !== text) composer.replace(0, composer.text.length, text);
  composer.hold(sendingNow(box.state));
  box.set({ mode: composer.mode, previewing: composer.previewing });
  box.focusOnOpen = false;
  box.retries = 0;
  box.kept = undefined;
  unsay(box);
}

/**
 * Where box `box` goes in `diff` as it's drawn now: under the last of its lines, or its file's
 * header, or in its thread, as {@link boxAt} places it. Nowhere where the diff can't place it.
 */
function inDiffAt(box: Box, diff: WritingDiff): ReturnType<typeof boxAt> {
  const drawn = diff.drawn();
  const { place } = box.state;
  const file =
    place.kind === 'thread'
      ? drawn.files.find((each) => githubPath(each) === place.path)
      : undefined;
  const screen = screenFor(box.view, diff, file?.since ?? false);
  return boxAt(drawn, screen, place, (thread) => shownAt(box.view, thread) !== undefined);
}

/**
 * Where box `box`, on lines, goes in `diff` where the diff doesn't place it on them: under their
 * file's header, if the diff is of the revision they're at and has the file.
 */
function headerAt(box: Box, diff: WritingDiff): ReturnType<typeof boxAt> {
  const drawn = diff.drawn();
  const { place } = box.state;
  if (place.kind !== 'thread' || place.commit.toLowerCase() !== drawn.at.toLowerCase()) {
    return undefined;
  }
  const file = drawn.files.find((each) => githubPath(each) === place.path);
  return file ? { at: { file: file.id } } : undefined;
}

/** A box the diff took down open as it was drawn again: what opens it as it was there anew. */
interface Kept {
  /** The box as it was. */
  readonly box: KeptBox;
  /** Whether focus was in it. */
  readonly focused: boolean;
  /** How much the reader had done as it was taken down: focus comes back with nothing since. */
  readonly inputs: number;
}

/**
 * What the reader does that moves on from a box the diff took down: a key, a click, the wheel, a
 * command chosen in the app menu. The key listener tells the focused element of a key once it's the
 * reader's input (`KEY_EVENT`), a sequence's only as it ends, and those Lo's commands take go no
 * further; a click in the app menu makes no event in the page, and the command it chose is told of
 * the same way.
 */
const INPUT = [KEY_EVENT, 'pointerdown', 'wheel'] as const;

/**
 * How many keys, clicks, wheel turns and app menu commands the reader has made, since Lo first
 * needed to know.
 */
let inputs = 0;
let counting = false;

/** How many keys, clicks, wheel turns and app menu commands the reader has made, from now on. */
export function inputsSoFar(): number {
  if (!counting) {
    counting = true;
    const count = () => {
      inputs += 1;
    };
    for (const type of INPUT) window.addEventListener(type, count, true);
  }
  return inputs;
}

/**
 * Opens box `box`, kept as the diff was drawn again, in the diff drawn anew, `diff`, as it was, in
 * the first place it can of: its line, or its thread; its file's header, as for a file closed as
 * viewed, still on its lines; its block, only where the diff has neither, unfocused. Focused if it
 * had focus, the reader has done nothing since and holds no keys for the rest of a sequence, and
 * focus is where the redraw left it. It waits a while for lines still coming, and after that goes
 * under its file's header. Says where it went: nowhere, in the end, where it can't be placed, and
 * it's kept for the next time its line or block is drawn.
 */
function placeKept(
  box: Box,
  kept: Kept,
  diff: WritingDiff,
): 'diff' | 'waits' | 'block' | 'nowhere' {
  const line = inDiffAt(box, diff);
  const header = headerAt(box, diff);
  const at = line ?? header;
  if (at) {
    if (showKept(box, kept, diff, at.at)) return 'diff';
    if (box.retries < RETRIES) {
      box.retries += 1;
      return 'waits';
    }
    if (line && header && showKept(box, kept, diff, header.at)) return 'diff';
  }
  box.kept = undefined;
  box.retries = 0;
  box.focusOnOpen = false;
  return opensUnderBlock(box.view, homeRow(box.home)) === true ? 'block' : 'nowhere';
}

/** Opens box `box`, kept as `kept`, at `at` in `diff`, as it was. Says whether it opened. */
function showKept(
  box: Box,
  kept: Kept,
  diff: WritingDiff,
  at: Parameters<WritingDiff['compose']>[0],
): boolean {
  const focused = document.activeElement;
  const free = !focused || focused === document.body || diff.hasFocus();
  // Keys held for a sequence count once it ends, and focus moved now would end it in the box.
  const focus = kept.focused && kept.inputs === inputs && free && !registry().isPending();
  const options = {
    focus,
    name: box.id,
    kept: kept.box,
    hint: hintOf(box.state.place),
    ...editsOf(box.state.place),
  };
  try {
    drew(box, diff.compose(at, box.state.text, eventsOf(box), framer?.(box), options), 'diff');
    return true;
  } catch {
    // Its lines aren't drawn yet, as while its file's diff is worked out.
    return false;
  }
}

/** A draft the diff had nowhere to open, as the kept drafts' list names it: "retry.ts · line 41 · r2". */
export interface KeptAway {
  readonly box: string;
  readonly where: string;
}

/**
 * Each view's drafts the diff, drawn again, took down open and had nowhere to open: neither their
 * lines, nor their file's header, nor their code block. The status bar counts them, until each opens
 * again or goes, and its item opens their list.
 */
export const keptAway = tabState<readonly KeptAway[]>(() => []);

/** Whether each view's list of kept drafts is open, over the status bar's item for them. */
export const keptOpen = tabState<boolean>(() => false);

/** Says in view `view`'s status bar that the diff drawn anew had nowhere to open `boxes`. */
function say(view: string, boxes: readonly Box[]): void {
  const ids = new Set(boxes.map((box) => box.id));
  keptAway.update(view, (was) => [
    ...was.filter((each) => !ids.has(each.box)),
    ...boxes.map((box) => ({ box: box.id, where: keptWhere(box) })),
  ]);
}

/** Box `box` opened again, or went: the status bar no longer counts it. */
function unsay(box: Box): void {
  const was = keptAway.get(box.view);
  if (!was.some((each) => each.box === box.id)) return;
  const left = was.filter((each) => each.box !== box.id);
  keptAway.set(box.view, left);
  if (left.length === 0) keptOpen.set(box.view, false);
}

/**
 * Where a draft the diff had nowhere to open is, as the list of kept drafts names it: its file and
 * lines at its revision, "retry.ts · line 41 · r2"; for a reply or an edit, what it is first, and
 * where its thread is, "Reply · retry.ts · line 41"; and "Comment · pull request" for the pull
 * request's own.
 */
function keptWhere(box: Box): string {
  const { place } = box.state;
  if (place.kind === 'conversation') return 'Comment · pull request';
  if (place.kind !== 'thread') {
    const what = place.kind === 'reply' ? 'Reply' : 'Edit';
    const row = held.get(box.view).threads?.threads.find((each) => each.id === place.thread);
    if (!row) return what;
    const lines = threadLines(row);
    const name = baseName(row.path);
    return lines === undefined
      ? `${what} · ${name}`
      : `${what} · ${name} · ${lineRefText({ lines }, true)}`;
  }
  const revision = revisionName(box.view, place.commit);
  return `${baseName(place.path)} · ${lineRefText({ lines: place.lines, revision }, true)}`;
}

/** The file's name in `path`, without its folders. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The lines thread `row` is on, as a line reference has them: `null` for one on a file. */
function threadLines(row: ThreadRow): LineRef['lines'] {
  const end = row.line ?? row.originalLine;
  if (row.subject === 'FILE') return null;
  if (end === null) return undefined;
  const start = row.line === null ? row.originalStartLine : row.startLine;
  const side = row.side === 'LEFT' ? 'LEFT' : 'RIGHT';
  const startSide = row.startSide === 'LEFT' ? 'LEFT' : side;
  return {
    start: start === null ? null : { side: startSide, number: start },
    end: { side, number: end },
  };
}

/** What the status bar's item for view `view`'s kept drafts says: "2 kept drafts". */
export function keptCount(kept: readonly KeptAway[]): string | undefined {
  if (kept.length === 0) return undefined;
  return kept.length === 1 ? '1 kept draft' : `${kept.length} kept drafts`;
}

/** Opens the list of view `view`'s kept drafts, over the status bar's item for them. */
export function showKeptDrafts(view: string): void {
  if (keptAway.get(view).length > 0) keptOpen.set(view, true);
}

const retrying = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Opens view `view`'s boxes that should show in its diff, as it's drawn now: drafts restored as Lo
 * started, boxes the diff took down as it was drawn again ({@link placeKept}), and those whose
 * block the overview no longer has. One whose line isn't drawn yet tries again in a moment, a few
 * times. The status bar says which of the boxes the diff took down it had nowhere to open.
 */
export function restore(view: string): void {
  const diff = writingDiff(view);
  const own = views.get(view);
  if (!diff || !own) return;
  let again = false;
  let moved = false;
  const nowhere: Box[] = [];
  for (const box of own.values()) {
    if (!box.open || box.composer || opensAt(box).kind !== 'diff') continue;
    if (box.kept) {
      const went = placeKept(box, box.kept, diff);
      if (went === 'waits') again = true;
      else if (went === 'block') moved = true;
      else if (went === 'nowhere') nowhere.push(box);
    } else if (!show(box, diff) && box.retries < RETRIES) {
      box.retries += 1;
      again = true;
    }
  }
  if (moved) queueMicrotask(() => reopen(view));
  if (nowhere.length > 0) say(view, nowhere);
  if (again && !retrying.has(view)) {
    retrying.set(
      view,
      setTimeout(() => {
        retrying.delete(view);
        restore(view);
      }, RETRY_AFTER),
    );
  }
}

/**
 * Opens the boxes of a code block just drawn, `block`, that were open under its lines, unfocused:
 * once its drawing is done.
 */
export function restoreBlock(block: WritingBlock): void {
  const { tab, key } = block.block;
  queueMicrotask(() => {
    for (const box of views.get(tab)?.values() ?? []) {
      if (!box.open || box.composer) continue;
      const opens = opensAt(box);
      if (opens.kind === 'block' && keyOfBlock(opens.block) === key) show(box, undefined);
    }
  });
}

/**
 * Opens view `view`'s boxes that should show where they open now, as after the overview changed or
 * a block was taken down: in the diff, or under a block drawn.
 */
export function reopen(view: string): void {
  const own = views.get(view);
  if (!own) return;
  restore(view);
  const blocks = new Set<string>();
  for (const box of own.values()) {
    if (!box.open || box.composer) continue;
    const opens = opensAt(box);
    if (opens.kind === 'block') blocks.add(keyOfBlock(opens.block));
  }
  for (const key of blocks) {
    const block = writingBlock(view, key);
    if (block) restoreBlock(block);
  }
  // The pull request's draft goes to or from the timeline's box as its block comes or goes.
  timelineChanged(view);
}

/** Opens every view's boxes that should show where they open now, as after the overview changed. */
export function reopenAll(): void {
  for (const view of views.keys()) reopen(view);
}

const caught = new Set<string>();

/** Asks main once for view `view`'s drafts, for a view drawn before main said anything of them. */
export function catchUpDrafts(view: string): void {
  if (caught.has(view)) return;
  caught.add(view);
  main()
    .current({ id: view })
    .then(({ drafts }) => {
      // Unless the drafts came meanwhile. A box drawn before main said anything, as the timeline's
      // own is, takes its draft's text.
      if (drafts && !heard.has(view)) takeDrafts(drafts);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a view's drafts:", error));
}

/** Whether two places are new threads' on the same lines of the same file, at whatever revision. */
function sameLines(a: DraftPlaceRow, b: DraftPlaceRow): boolean {
  if (a.kind !== 'thread' || b.kind !== 'thread') return false;
  return a.path === b.path && JSON.stringify(a.lines) === JSON.stringify(b.lines);
}

/** What's said when a comment sent to post at once went into your pending review instead. */
const JOINED = 'Added to pending review';

/**
 * A comment sent to post at once, whose answer was lost, was found in your pending review: says so,
 * as its answer would have, in the view whose box sent it.
 */
export function takeJoined({ id: view, place }: JoinedView): void {
  if (!boxesOf(view).get(placeKey(place))?.sentMark) return;
  announce(JOINED);
}

/**
 * Takes the drafts main sent for a view: each box takes how sending it stands, and a box not yet
 * typed in since takes its text. A draft restored as Lo started gets a box that opens once its line
 * is drawn. A draft that moved to a newer push takes its box's place. A box whose draft went after
 * GitHub's answer to it was lost is closed, since main found it posted.
 */
export function takeDrafts(given: DraftsView): void {
  const { id: view } = given;
  const own = boxesOf(view);
  // The first the window hears of a view's drafts, as after it's loaded again, each draft's box
  // comes back, as after a restart.
  const first = !heard.has(view);
  heard.add(view);
  const rows = new Map(given.drafts.map((row) => [placeKey(row.place), row]));
  // A draft dropped here is gone, whatever main sent before it heard; once it says so, it's done.
  const dropping = dropped.get(view);
  for (const key of dropping ?? []) {
    if (rows.has(key)) rows.delete(key);
    else dropping?.delete(key);
  }
  const gone: Box[] = [];
  for (const [key, box] of own) {
    if (rows.has(key)) continue;
    if (box.sentMark) {
      // What GitHub's lost answer was to posted, or what was sent and posted before its answer
      // came here: it's done, and its box goes as its card comes. The answer still to come says
      // so itself, with where the comment went.
      if (!sentBoxes.has(box) && !landings.has(box)) {
        closeOnceLanded(box, null);
        if (!box.state.busy) tell(sentWords(box.state.place, box.lastHow));
      }
      continue;
    }
    if (box.composer || box.saving || box.state.busy) continue;
    own.delete(key);
    unsay(box);
    gone.push(box);
  }
  for (const [key, row] of rows) {
    let box = own.get(key);
    if (!box) {
      const moved = gone.find(
        (each) => sameLines(each.state.place, row.place) && each.state.text === row.text,
      );
      box = new Box(view, row.place, moved?.state.primary ?? 'review', row.text);
      box.home = moved?.home ?? homeOf(row);
      // Moved to a newer push as the diff was drawn again for it: it opens in that diff as it was.
      box.kept = moved?.kept;
      if (row.home) box.set({ where: whereOf(view, row.home, row.place) });
      box.open = row.restored || first || (moved?.open ?? false);
      if (first) box.set({ restored: row.savedAt });
      own.set(key, box);
    } else if (row.home && box.home.kind !== 'block' && !box.saving && box.state.text === '') {
      // Drawn before main said anything, as the timeline's box is, with nothing typed: it takes its
      // draft's home, and opens there, never drawn where it was with the draft's text.
      box.home = homeOf(row);
      box.set({ where: whereOf(view, row.home, row.place) });
      if (box.composer && opensAt(box).kind !== box.drawnIn) {
        const { composer } = box;
        box.composer = undefined;
        box.drawnIn = undefined;
        composer.dismiss();
      }
    }
    takeRow(box, row);
  }
  reopen(view);
  replyingChanged(view);
}

/**
 * A box takes its draft's row: how sending it stands, and its text unless it was typed in. One drawn
 * with nothing in it yet, as the timeline's own box drawn before main said anything, takes the
 * draft's text too.
 */
function takeRow(box: Box, row: DraftRow): void {
  box.sentMark = row.sent !== null;
  const { composer } = box;
  const blank = composer !== undefined && !box.saving && composer.text === '' && row.text !== '';
  const typed = (composer !== undefined || box.saving) && !blank;
  box.set({
    sending: row.sending,
    ...(row.restored ? { restored: row.savedAt } : {}),
    ...(typed ? {} : { text: row.text }),
  });
  if (!blank) return;
  // Main's text, not typing: it isn't saved again, which would take back what main said of how
  // sending it stands, and the box still says it was restored.
  box.taking = true;
  try {
    composer.replace(0, 0, row.text);
  } finally {
    box.taking = false;
  }
  if (row.restored) box.set({ restored: row.savedAt });
}

/**
 * Opens a box at `place` in view `view`, focused, at `home`: in the diff, `diff`, or under a code
 * block's lines. It's the box there is at `place`, if there is one, taken from wherever else it's
 * drawn; where another box is open on the same line, as one on a range that ends there, it's that
 * one, focused. One with no text yet starts with `draft`. `where` is what its head says of where it
 * goes, where that's more than its place says.
 */
export function openAt(
  view: string,
  diff: WritingDiff | undefined,
  home: Home,
  place: DraftPlaceRow,
  how: Send,
  draft = '',
  where?: BoxWhere,
): Box | undefined {
  const own = boxesOf(view);
  const key = placeKey(place);
  const spot = spotOf(home, place);
  const open =
    spot === undefined
      ? undefined
      : [...own.values()].find(
          (each) => each.key !== key && each.composer && spotOfBox(each) === spot,
        );
  if (open?.composer) {
    open.composer.focus();
    return open;
  }
  let box = own.get(key);
  if (!box) {
    box = new Box(view, place, how, draft);
    own.set(key, box);
    dropped.get(view)?.delete(key);
  } else if (!box.composer) {
    box.set({ primary: how, ...(box.state.text.trim() === '' ? { text: draft } : {}) });
  }
  // Opened here by the reader: it's kept nowhere else.
  box.kept = undefined;
  const elsewhere = box.composer !== undefined && box.drawnIn !== home.kind;
  if (elsewhere || JSON.stringify(box.home) !== JSON.stringify(home)) {
    // Drawn elsewhere: it comes here, its text as it is, and its draft's home with it.
    const { composer } = box;
    box.composer = undefined;
    composer?.dismiss();
    box.home = home;
    if (box.state.text.trim() !== '') save(view, place, box.state.text, homeRow(home));
  }
  box.set({ where });
  box.open = true;
  box.focusOnOpen = true;
  const fresh = box.composer !== undefined && box.composer.text.trim() === '' && draft !== '';
  const shown = show(box, diff);
  replyingChanged(view);
  if (!shown) return undefined;
  if (fresh && box.composer) {
    box.composer.replace(0, box.composer.text.length, draft);
    box.composer.focus();
  }
  return box;
}

/** A file's path in the base, for one the pull request renames. */
function previousOf(file: { path: string | null; old: string | null }): string | null {
  return file.path !== null && file.old !== null && file.old !== file.path ? file.old : null;
}

/** Why GitHub takes no comment on a file in the revision on screen. */
const UNCHANGED_FILE = 'This revision doesn’t change this file';

/**
 * The lines a suggested change in a comment on thread `row` of view `view` replaces, as its diff
 * shows them: the lines the thread is on, where they're the newer side's in the revision on
 * screen. Nothing elsewhere, as for an outdated thread, whose card has GitHub's own.
 */
export function replacedIn(view: string, row: ThreadRow): string | undefined {
  const { line, startLine, startSide, side, currentOn } = row;
  if (row.subject !== 'LINE' || row.outdated || line === null || side !== 'RIGHT') return undefined;
  if (startLine !== null && startSide !== null && startSide !== 'RIGHT') return undefined;
  const diff = writingDiff(view);
  const at = shownAt(view, row.id);
  if (!diff || !at || currentOn?.toLowerCase() !== diff.drawn().at.toLowerCase()) return undefined;
  return linesOf(diff, at.file, startLine ?? line, line);
}

/**
 * The lines a suggested change in box `box`'s text replaces: those it's on, as its diff shows them,
 * for a box on the newer side's lines in the revision on screen, or in a thread that is.
 */
export function replacedOf(box: Box): string | undefined {
  const { view } = box;
  const { place } = box.state;
  if (place.kind === 'reply' || (place.kind === 'edit' && place.thread !== null)) {
    const row = held.get(view).threads?.threads.find((each) => each.id === place.thread);
    return row && replacedIn(view, row);
  }
  if (place.kind !== 'thread' || place.lines === null) return undefined;
  const { start, end } = place.lines;
  if (end.side !== 'RIGHT' || (start !== null && start.side !== 'RIGHT')) return undefined;
  const diff = writingDiff(view);
  if (!diff) return undefined;
  const drawn = diff.drawn();
  if (place.commit.toLowerCase() !== drawn.at.toLowerCase()) return undefined;
  const file = drawn.files.find((each) => githubPath(each) === place.path);
  return file && linesOf(diff, file.id, start?.number ?? end.number, end.number);
}

/** File `file`'s newer lines `from` to `to` in `diff`, as one text: nothing where it has none. */
function linesOf(diff: WritingDiff, file: string, from: number, to: number): string | undefined {
  const lines = diff.lines({ file, side: 'new', from: Math.min(from, to), to: Math.max(from, to) });
  return lines.length === 0 ? undefined : lines.join('\n');
}

/** Why a key does nothing while the pull request it's in is still opening. */
export const OPENING = 'Opening pull request…';

/**
 * Why a key that acts in view `view`'s diff does nothing while the diff isn't drawn: the pull
 * request is still opening, or else `then`, what to do, as the diff isn't on screen.
 */
export function noDiff(view: string, then = 'Go to the diff first'): string {
  return (pullOf(view)?.shown ?? undefined) === undefined ? OPENING : then;
}

/** The command that comments on a line's file once the line took no comment. */
const ON_FILE_INSTEAD = 'comments.onFileInstead';

/** A line a comment was refused on, whose file `⏎` comments on while the note says so, `said`. */
let offered: { view: string; file: string; how: Send; said: string } | undefined;

/**
 * `c`, `C` or `s` in view `tab`'s diff, on `target`: opens a box under the cursor's line, or the
 * lines `v` selected, or on a header, on the file; `s` with the lines in a `suggestion` block.
 * Where GitHub takes no comment, it says so, and `⏎` comments on the file instead.
 */
export async function comment(
  tab: PullTab,
  target: LineTarget | HeaderTarget,
  how: Send,
  suggest = false,
): Promise<void> {
  const view = tab.id;
  const diff = writingDiff(view, true);
  if (!diff) return;
  knowPull(tab);
  const drawn = diff.drawn();
  const id = target.kind === 'header' ? target.file : target.at.file;
  const file = drawn.files.find((each) => each.id === id);
  const path = file && githubPath(file);
  if (!file || path === undefined) return;
  const commentable = await commentableOf(view, drawn.at, path, previousOf(file));
  // The reader moved on meanwhile: to another tab, or the diff drawn again.
  if (writingDiff(view, true)?.drawn().at !== drawn.at) return;
  const takes = commentableOn(screenFor(view, diff, file.since), commentable);
  if (target.kind === 'header') {
    if (takes && !takes.takesFileComment()) {
      refuse(UNCHANGED_FILE);
      return;
    }
    openAt(view, diff, IN_DIFF, placeOf(drawn.at, path, undefined), how);
    return;
  }
  const on = linesAt(takes, target.at);
  if (!on) {
    if (takes && !takes.takesFileComment()) {
      refuse(UNCHANGED_FILE);
      return;
    }
    // Where main couldn't read the file's patch, it takes a comment on the file only.
    const said = takes ? NOT_IN_DIFF : NO_LINES;
    offered = { view, file: file.id, how, said };
    // Its button is the command's control, as `⏎` runs it.
    const instead = controlOf(ON_FILE_INSTEAD, target);
    refuse(
      said,
      instead && {
        label: instead.label,
        keys: instead.keys,
        onClick: () => void runControl(ON_FILE_INSTEAD, target),
      },
    );
    return;
  }
  if (suggest && !takesSuggestion(on)) {
    refuse(NEW_SIDE_ONLY);
    return;
  }
  const place = placeOf(drawn.at, path, on);
  if (!suggest) {
    openAt(view, diff, IN_DIFF, place, how);
    return;
  }
  const lines = {
    file: file.id,
    side: 'new' as const,
    from: Lines.first(on).number,
    to: on.end.number,
  };
  const block = suggestionBlock(diff.lines(lines));
  // In a box with no text yet the cursor goes inside the block, after its last line, in insert
  // mode; in one with text, the block goes after it.
  const end = block.lastIndexOf('\n');
  const box = openAt(view, diff, IN_DIFF, place, how, block.slice(0, end));
  const composer = box?.composer;
  if (!composer) return;
  const { text } = composer;
  if (text === block.slice(0, end)) {
    composer.replace(text.length, text.length, block.slice(end));
    return;
  }
  composer.replace(text.length, text.length, `${text.trim() === '' ? '' : '\n\n'}${block}`);
  composer.focus();
}

/**
 * `⏎` just after a line refused a comment: a comment on its file instead. Says whether there was
 * an offer to take.
 */
export function takeOffer(tab: PullTab): boolean {
  const offer = offered;
  offered = undefined;
  if (offer?.view !== tab.id || notice()?.title !== offer.said) return false;
  withdraw(offer.said, '');
  void comment(tab, { kind: 'header', file: offer.file, side: 'new' }, offer.how);
  return true;
}

/**
 * `c` on a file in the tree, by its key there: a box on the file under its header in the diff,
 * which shows the diff and the file at the top first.
 */
export async function commentOnFile(tab: PullTab, key: string): Promise<void> {
  const view = tab.id;
  showDiff(view);
  const diff = writingDiff(view);
  if (!diff) {
    // The diff comes on screen, and takes the comment once it's drawn, if the reader has done
    // nothing since.
    const opening = noDiff(view, '');
    if (opening !== '') {
      refuse(opening);
      return;
    }
    const asked = inputsSoFar();
    const stop = onDiffDrawn((drawn) => {
      if (drawn !== view) return;
      stop();
      if (inputsSoFar() === asked) void commentOnFile(tab, key);
    });
    return;
  }
  const file = diff.drawn().files.find((each) => each.key === key);
  if (!file) {
    refuse('This file isn’t in this diff');
    return;
  }
  diff.toTop(file.id);
  await comment(tab, { kind: 'header', file: file.id, side: 'new' }, 'review');
}

/**
 * Sends a box's text, as `⌘⏎` (`review`) or `⌥⏎` (`now`) asks: an edit's saves it over the
 * comment, either way.
 */
export async function send(box: Box, how: Send): Promise<void> {
  const { view } = box;
  if (sendingNow(box.state) || uploadsHold(box) !== undefined) return;
  // What's left of an upload that didn't finish never goes to GitHub, nor holds the comment back.
  clearStranded(box);
  const { place, text } = box.state;
  // Sent before, and nobody knows whether it posted: it's looked up first ("Check again").
  if (box.state.sending === 'unknown') return;
  if (text.trim() === '' || offline(view) !== undefined || canWrite(view) !== true) return;
  box.dropSave();
  box.lastHow = how;
  box.before = beforeOf(view, place);
  box.set({ busy: true, refusal: undefined });
  try {
    const outcome: SendOutcome | ActOutcome =
      place.kind === 'edit'
        ? await main().edit({ id: view, place, text })
        : await main().send({ id: view, place, text, how });
    switch (outcome.kind) {
      case 'done':
        closeOnceLanded(box, null);
        tell(sentWords(place, how));
        if (place.kind === 'edit' && place.thread === null) {
          wrotePull(view, { kind: 'edited', comment: place.comment, text });
        }
        break;
      case 'sent': {
        // A comment from a block that won't show under it says where it went, and its box goes.
        const { home } = box;
        const went = home.kind === 'block' ? wentFrom(view, home.block, place, outcome) : undefined;
        if (went) closeSent(box);
        else closeOnceLanded(box, outcome.thread);
        if (place.kind === 'conversation') wrotePull(view, { kind: 'posted', text });
        if (outcome.landedOn && outcome.thread !== null) {
          const thread = outcome.thread;
          landed.update(view, (was) => new Set([...was, thread]));
        }
        // A toast says each of these to a screen reader too; any other is said to one alone.
        if (went) announce(went.title, went.body);
        // "Send now" that went into the pending review says so: its card's "Pending" tag shows
        // the rest.
        else if (outcome.joined) announce(JOINED);
        else tell(sentWords(place, how));
        break;
      }
      case 'refused':
        box.set({ refusal: outcome.refusal });
        break;
      case 'lost':
        break;
      default:
        outcome satisfies never;
    }
  } catch (error) {
    box.set({
      refusal: { kind: 'github', message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    box.set({ busy: false });
  }
}

/**
 * Where a comment view `view` sent from block `home` went, where it won't show under the block: on
 * the pull request, its file, or lines of a newer head.
 */
function wentFrom(
  view: string,
  home: DraftHomeRow,
  place: DraftPlaceRow,
  outcome: { readonly pending: boolean },
): { readonly title: string; readonly body: string } | undefined {
  const pull = pullIn(view);
  return sentFromBlock(place, home.commit, outcome.pending, {
    written: revisionName(view, home.commit),
    now: place.kind === 'thread' ? revisionName(view, place.commit) : '',
    pull: pull === undefined ? 'the pull request' : `#${pull.number}`,
  });
}

/**
 * Takes `box`'s editor away, as `how` does. Focus in it goes where the box says it goes, if it says,
 * as one the timeline draws does; the diff takes it back itself.
 */
function takeAway(box: Box, how: 'close' | 'landed' | 'dismiss'): void {
  const { composer } = box;
  const focused = box.state.focused;
  box.composer = undefined;
  if (how === 'dismiss') composer?.dismiss();
  else composer?.close(how === 'landed');
  if (focused) box.left?.();
}

/**
 * Closes the box of a comment or an edit GitHub took: `drawn`, its card is drawn already. One
 * closed before its card came stays drawn as it is where the view keeps it (`Composer.close`),
 * which its state says for as long: it's still `landing`. A box closes once: main says a comment
 * was taken twice, in its drafts and in its answer.
 */
function closeSent(box: Box, drawn = false): void {
  if (sentBoxes.has(box)) return;
  sentBoxes.add(box);
  const { view } = box;
  const waiting = landings.get(box);
  if (waiting) clearTimeout(waiting.timer);
  landings.delete(box);
  const own = boxesOf(view);
  // Unless main's drafts took it down first, and another box is there now.
  if (own.get(box.key) === box) own.delete(box.key);
  box.open = false;
  unsay(box);
  if (!drawn) box.set({ landing: true });
  takeAway(box, drawn ? 'landed' : 'close');
  replyingChanged(view);
}

/**
 * How long a box whose comment GitHub took waits for the comment's card, the comment on it, before
 * it closes anyway.
 */
export const LAND_WAIT = 10_000;

/**
 * What a view's threads held as a box was sent, which tells its comment's card from what was there:
 * how many comments the thread a reply is to held, the text of the comment an edit is of, or the
 * threads there were.
 */
interface Before {
  readonly count?: number;
  readonly body?: string;
  readonly threads?: ReadonlySet<string>;
}

/** The threads main last sent for view `view`. */
function rowsOf(view: string): readonly ThreadRow[] {
  return held.get(view).threads?.threads ?? [];
}

function beforeOf(view: string, place: DraftPlaceRow): Before {
  const rows = rowsOf(view);
  switch (place.kind) {
    case 'reply':
      return { count: rows.find((row) => row.id === place.thread)?.comments.length ?? 0 };
    case 'edit': {
      const row = rows.find((each) => each.id === place.thread);
      const body = row?.comments.find((each) => each.id === place.comment)?.body;
      return body === undefined ? {} : { body };
    }
    case 'thread':
      return { threads: new Set(rows.map((row) => row.id)) };
    case 'conversation':
      return {};
    default:
      place satisfies never;
      return {};
  }
}

/** A comment's text as GitHub gives it back: its line ends as one, with nothing around it. */
function asKept(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

/**
 * Whether `rows` hold what `box` sent, drawn in a thread: the thread GitHub said it made
 * (`thread`), one more comment than the thread a reply is to held, or an edited comment's new
 * text; or, with nothing to go by from before it was sent, the text itself. Nothing for a comment
 * no thread draws, as one on the pull request.
 */
function landedIn(
  box: Box,
  thread: string | null,
): ((rows: readonly ThreadRow[]) => boolean) | undefined {
  const { place, text } = box.state;
  const { before } = box;
  const same = (body: string): boolean => asKept(body) === asKept(text);
  switch (place.kind) {
    case 'reply':
      return (rows) => {
        const row = rows.find((each) => each.id === place.thread);
        if (!row) return true;
        if (before?.count !== undefined) return row.comments.length > before.count;
        return row.comments.some((each) => same(each.body));
      };
    case 'edit': {
      if (place.thread === null) return undefined;
      return (rows) => {
        const row = rows.find((each) => each.id === place.thread);
        const body = row?.comments.find((each) => each.id === place.comment)?.body;
        return (
          body === undefined || same(body) || (before?.body !== undefined && body !== before.body)
        );
      };
    }
    case 'thread':
      return (rows) =>
        rows.some((row) => {
          if (thread !== null) return row.id === thread;
          const first = row.comments[0];
          return !before?.threads?.has(row.id) && first !== undefined && same(first.body);
        });
    case 'conversation':
      return undefined;
    default:
      place satisfies never;
      return undefined;
  }
}

/** The boxes whose comments GitHub took, waiting for their cards, each with what tells it came. */
const landings = new Map<
  Box,
  { shows: (rows: readonly ThreadRow[]) => boolean; timer: ReturnType<typeof setTimeout> }
>();

/** The boxes closed as their comments were taken. */
const sentBoxes = new WeakSet<Box>();

/**
 * GitHub took what `box` sent, making thread `thread` if it said so: the box closes as its
 * comment's card is drawn, and shows the comment until then, so its text is on screen in every
 * frame from the send to the card. A comment no thread draws, or a box that isn't drawn, closes
 * now, and so does one whose card hasn't come in `LAND_WAIT`. Told again of a box that waits, as
 * when main's answer names the thread after its drafts said the comment was taken, it waits on,
 * no longer, for what it's now known to be.
 */
function closeOnceLanded(box: Box, thread: string | null): void {
  if (sentBoxes.has(box)) return;
  const shows = box.composer && box.drawnIn !== 'timeline' ? landedIn(box, thread) : undefined;
  if (!shows) {
    closeSent(box);
    return;
  }
  if (shows(rowsOf(box.view))) {
    closeSent(box, true);
    return;
  }
  const waiting = landings.get(box);
  if (waiting) {
    waiting.shows = shows;
    return;
  }
  box.set({ landing: true });
  const timer = setTimeout(() => closeSent(box), LAND_WAIT);
  landings.set(box, { shows, timer });
}

/**
 * View `view`'s threads came, and are drawn: the boxes that waited for their comments' cards close,
 * each staying drawn until the view has measured its card (`Composer.close`). So does a box still
 * held, its answer not here yet or lost, whose comment the threads now draw: the card takes its
 * place, and never shows under it.
 */
export function landBoxes(view: string): void {
  const rows = rowsOf(view);
  // Closing one takes it out of the map this goes through, which a `Map` allows.
  for (const [box, { shows }] of landings) {
    if (box.view === view && shows(rows)) closeSent(box);
  }
  for (const box of views.get(view)?.values() ?? []) {
    const { state } = box;
    if (!box.composer || box.drawnIn === 'timeline') continue;
    if (!sendingNow(state) || state.landing || !drawnAs(box, rows)) continue;
    closeSent(box);
    // Main's draft of it, until main says it's gone, brings no box back.
    holdDropped(box);
    // The answer still to come says so itself.
    if (!state.busy) tell(sentWords(state.place, box.lastHow));
  }
}

/**
 * Whether `rows` draw the comment `box` holds while it's sent or looked for, by more than
 * {@link landedIn} goes by once GitHub said it took it: a comment with the box's text, yours,
 * that wasn't there as it was sent.
 */
function drawnAs(box: Box, rows: readonly ThreadRow[]): boolean {
  const { place, text } = box.state;
  const { before } = box;
  if (!before) return false;
  const me = loginOf(box.view);
  const mine = (each: ThreadRow['comments'][number]): boolean =>
    asKept(each.body) === asKept(text) && (me === undefined || each.author === me);
  switch (place.kind) {
    case 'reply': {
      const row = rows.find((each) => each.id === place.thread);
      return (
        row !== undefined &&
        before.count !== undefined &&
        row.comments.slice(before.count).some(mine)
      );
    }
    case 'edit': {
      const row = rows.find((each) => each.id === place.thread);
      const edited = row?.comments.find((each) => each.id === place.comment);
      // An edit that changes nothing shows nothing new: its answer says how it went.
      return (
        edited !== undefined &&
        before.body !== undefined &&
        asKept(before.body) !== asKept(text) &&
        mine(edited)
      );
    }
    case 'thread':
      return rows.some((row) => {
        const first = row.comments[0];
        return !before.threads?.has(row.id) && first !== undefined && mine(first);
      });
    case 'conversation':
      return false;
    default:
      place satisfies never;
      return false;
  }
}

/** Does what a box's note offers. */
export function act(box: Box, offer: Offer): void {
  const { view } = box;
  switch (offer) {
    case 'discard':
      drop(box);
      return;
    case 'sendAgain':
      void send(box, box.lastHow);
      return;
    // Main looks whether it posted, and the box is its card again meanwhile: found, it goes;
    // not there, it can be sent again.
    case 'checkAgain':
      main()
        .check({ id: view, place: box.state.place })
        .catch((error: unknown) => console.error("Lo couldn't check a comment:", error));
      return;
    case 'loadNewer':
      tabs()
        .reload({ id: view })
        .catch((error: unknown) => console.error("Lo couldn't load the newer push:", error));
      return;
    case 'showLatest': {
      const { refusal } = box.state;
      const head = refusal?.kind === 'notLatest' ? refusal.head : undefined;
      if (head === undefined) return;
      const pull = pullOf(view);
      const asked =
        pull?.newer?.toLowerCase() === head.toLowerCase()
          ? tabs().reload({ id: view })
          : client(revisionsContract).compare({ id: view, from: null, to: head });
      asked.catch((error: unknown) => console.error("Lo couldn't show the latest push:", error));
      return;
    }
    case 'onFile':
      toFile(box);
      return;
    default:
      offer satisfies never;
  }
}

/**
 * Takes `box` away with its draft, as "Discard" does: its box, if it's drawn, closes with nothing
 * sent.
 */
function drop(box: Box): void {
  const { view, key } = box;
  const text = box.composer?.text ?? box.state.text;
  if (text.trim() !== '') {
    const { place, primary, where } = box.state;
    remember({ view, place, home: box.home, primary, text, where });
  }
  endUploads(box);
  boxesOf(view).delete(key);
  box.dropSave();
  box.open = false;
  unsay(box);
  takeAway(box, 'dismiss');
  holdDropped(box);
  discard(box);
  replyingChanged(view);
}

/** A draft "Discard draft" took, with what brings its box back as it was. */
export interface Discarded {
  readonly view: string;
  readonly place: DraftPlaceRow;
  readonly home: Home;
  readonly primary: Send;
  readonly text: string;
  readonly where: BoxWhere | undefined;
}

/** How long "Undo" is offered for a draft discarded, in ms. */
export const UNDO_TIME = 8000;

/** The last draft discarded, while "Undo" brings it back. */
let discarded: Discarded | undefined;
let forgetting: ReturnType<typeof setTimeout> | undefined;
const discardedListeners = new Set<() => void>();

function setDiscarded(next: Discarded | undefined): void {
  clearTimeout(forgetting);
  forgetting = undefined;
  discarded = next;
  for (const listener of discardedListeners) listener();
}

/** Holds `draft` as the one "Undo" brings back, for {@link UNDO_TIME}. */
function remember(draft: Discarded): void {
  setDiscarded(draft);
  forgetting = setTimeout(() => setDiscarded(undefined), UNDO_TIME);
}

/** The draft "Undo" would bring back now. */
export function lastDiscarded(): Discarded | undefined {
  return discarded;
}

/** Calls `listener` as a draft is discarded, comes back, or its "Undo" runs out. */
export function onDiscarded(listener: () => void): () => void {
  discardedListeners.add(listener);
  return () => {
    discardedListeners.delete(listener);
  };
}

/**
 * Brings back the draft "Discard draft" last took, as "Undo" does: its box opens where it was, with
 * its text, focused, and the draft is saved again. A box opened at its place since keeps what was
 * typed in it, with the draft's text after.
 */
export function undiscard(): void {
  const last = discarded;
  if (!last) return;
  setDiscarded(undefined);
  const { view, place, home, primary, text, where } = last;
  const own = boxesOf(view);
  const key = placeKey(place);
  dropped.get(view)?.delete(key);
  let box = own.get(key);
  if (!box) {
    box = new Box(view, place, primary, text);
    box.home = home;
    box.set({ where });
    own.set(key, box);
  } else {
    const typed = (box.composer?.text ?? box.state.text).replace(/\s+$/, '');
    const whole = typed === '' ? text : `${typed}\n\n${text}`;
    if (box.composer) box.composer.replace(0, box.composer.text.length, whole);
    else box.set({ text: whole, restored: undefined });
  }
  box.open = true;
  box.focusOnOpen = true;
  // Saved in a moment, as typing is: main's drafts from before it hears leave the box be meanwhile.
  box.saveSoon();
  box.composer?.focus();
  reopen(view);
  replyingChanged(view);
}

/** "Undo", for the draft last discarded: in the palette while there's one to bring back. */
export const undiscarding: Handler = {
  run: undiscard,
  enabled: () => discarded !== undefined || NOTHING_TO_UNDO,
  listed: () => discarded !== undefined,
};

/** Has main discard `box`'s draft. */
function discard(box: Box): void {
  main()
    .discard({ id: box.view, place: box.state.place })
    .catch((error: unknown) => console.error("Lo couldn't discard a draft:", error));
}

/** Keeps drafts main sent before it heard `box`'s went from bringing it back. */
function holdDropped(box: Box): void {
  let own = dropped.get(box.view);
  if (!own) {
    own = new Set();
    dropped.set(box.view, own);
  }
  own.add(box.key);
}

/**
 * Moves a box's text to a box on its file, as GitHub takes no comment on its lines: in the diff,
 * under the file's header; on a code block, under the same lines.
 */
function toFile(box: Box): void {
  const { view, home } = box;
  const { place, text, primary } = box.state;
  if (place.kind !== 'thread') return;
  const diff = writingDiff(view);
  if (home.kind === 'diff' && !diff) return;
  const onFile: DraftPlaceRow = { ...place, lines: null };
  drop(box);
  const where = home.kind === 'block' ? ON_FILE_NOT_IN_DIFF : undefined;
  const there = openAt(view, diff, home, onFile, primary, '', where);
  if (!there?.composer) return;
  const kept = there.composer.text.replace(/\s+$/, '');
  const moved = kept === '' ? text : `${kept}\n\n${text}`;
  there.composer.replace(0, there.composer.text.length, moved);
  there.composer.focus();
}

/** Saves every box's text waiting to be saved, as the window goes. */
export function saveAll(): void {
  for (const own of views.values()) for (const box of own.values()) box.saveNow();
}

/** Forgets the boxes of every view but those in `kept`, as their tabs close. */
export function keepBoxesOf(kept: ReadonlySet<string>): void {
  for (const [view, own] of views) {
    if (kept.has(view)) continue;
    for (const box of own.values()) box.saveNow();
    views.delete(view);
    for (const [box, { timer }] of landings) {
      if (box.view !== view) continue;
      clearTimeout(timer);
      landings.delete(box);
    }
    pulls.delete(view);
    dropped.delete(view);
    if (discarded?.view === view) setDiscarded(undefined);
    caught.delete(view);
    clearTimeout(retrying.get(view));
    retrying.delete(view);
  }
  for (const [key, { view }] of commentables) if (!kept.has(view)) commentables.delete(key);
}

/** The threads of each view a reply box is open in, by their ids. */
export const replying = tabState<ReadonlySet<string>>(() => new Set());

/**
 * The comments of each view's threads an edit box is open on, by their ids: a comment's text shows
 * once, in its box, from the edit opening to its card showing what was saved.
 */
export const editing = tabState<ReadonlySet<string>>(() => new Set());

/**
 * The boxes of each view its timeline draws: the pull request's own, if there's one yet, and the
 * edits of your comments on the pull request itself that are open, by the comments' ids.
 */
export interface TimelineBoxes {
  readonly own: Box | undefined;
  /**
   * Where the pull request's draft opens while it isn't the timeline's: under the code block it was
   * written on (`block`), or, while Lo can't tell yet whether the overview has the block, in no box
   * until it can (`waits`). Nothing while it's the timeline's, or there's none.
   */
  readonly away: 'block' | 'waits' | undefined;
  readonly edits: ReadonlyMap<string, Box>;
}

export const timelineBoxes = tabState<TimelineBoxes>(() => ({
  own: undefined,
  away: undefined,
  edits: new Map(),
}));

/** Notes which boxes view `view`'s timeline draws, as a box opens or goes, or its block does. */
function timelineChanged(view: string): void {
  let own: Box | undefined;
  let away: TimelineBoxes['away'];
  const edits = new Map<string, Box>();
  for (const box of views.get(view)?.values() ?? []) {
    const { place } = box.state;
    if (place.kind === 'conversation') {
      if (isPullsOwn(box)) own = box;
      else away = opensUnderBlock(view, homeRow(box.home)) === true ? 'block' : 'waits';
    } else if (place.kind === 'edit' && place.thread === null && box.open) {
      edits.set(place.comment, box);
    }
  }
  const was = timelineBoxes.get(view);
  const same =
    was.own === own &&
    was.away === away &&
    was.edits.size === edits.size &&
    [...edits].every(([id, each]) => was.edits.get(id) === each);
  if (!same) timelineBoxes.set(view, { own, away, edits });
}

/**
 * The box at `place` in view `view`, which its timeline draws: the one there is, or a new one, with
 * no text yet. A new one is noted as the timeline's. Nothing while the pull request's draft opens
 * elsewhere, as under the code block it was written on: it opens in one box only.
 */
export function timelineBox(view: string, place: DraftPlaceRow): Box | undefined {
  const own = boxesOf(view);
  const key = placeKey(place);
  let box = own.get(key);
  if (box && !isPullsOwn(box)) return undefined;
  if (!box) {
    box = new Box(view, place, 'now', '');
    box.open = true;
    // A draft discarded here stays so, whatever main sent before it heard.
    own.set(key, box);
    queueMicrotask(() => timelineChanged(view));
  }
  return box;
}

/**
 * `c` in view `view`'s timeline while the pull request's draft opens under the code block it was
 * written on, or waits for Lo to tell whether it does: the draft comes to the timeline's box, its
 * text as it is, and keeps no block, as `c` on a block takes it there. Says whether there was one to
 * bring.
 */
export function bringToTimeline(view: string): boolean {
  const box = boxesOf(view).get(placeKey(ON_PULL));
  if (!box || isPullsOwn(box)) return false;
  const { composer } = box;
  box.composer = undefined;
  box.drawnIn = undefined;
  composer?.dismiss();
  box.home = IN_DIFF;
  box.set({ where: undefined });
  box.open = true;
  box.focusOnOpen = true;
  if (box.state.text.trim() !== '') save(view, box.state.place, box.state.text, null);
  replyingChanged(view);
  return true;
}

/**
 * Opens the edit at `place`, of your comment on the pull request itself, in view `view`'s timeline,
 * in the comment's card, focused: the one there is, with its draft as it was left, or one starting
 * from `base`, GitHub's text.
 */
export function openInTimeline(view: string, place: DraftPlaceRow, base: string): Box {
  const own = boxesOf(view);
  const key = placeKey(place);
  let box = own.get(key);
  if (!box) {
    box = new Box(view, place, 'review', base);
    own.set(key, box);
    dropped.get(view)?.delete(key);
  } else if (!box.composer && box.state.text.trim() === '') {
    box.set({ text: base });
  }
  box.open = true;
  box.focusOnOpen = true;
  box.composer?.focus();
  replyingChanged(view);
  return box;
}

/**
 * The events of a box the timeline draws. `Esc` in normal mode, or in the preview, leaves it,
 * keeping its draft: the pull request's own box stays where it is, and an edit's closes, its card
 * showing the comment again, unless it holds no text, which discards the edit. Focus goes back to
 * the timeline's list, as `leave` does. Files are attached as in the diff's boxes.
 */
export function timelineEvents(box: Box, leave: () => void): ComposerEvents {
  return {
    change(text) {
      if (box.taking) {
        box.set({ text });
        return;
      }
      box.set({ text, restored: undefined });
      box.saveSoon();
    },
    submit(how) {
      void send(box, how);
    },
    close(keep) {
      const { view } = box;
      if (box.state.place.kind === 'conversation') {
        box.saveNow();
        leave();
        return;
      }
      box.open = false;
      if (keep) box.saveNow();
      else {
        box.dropSave();
        endUploads(box);
        if (!box.sentMark && !box.state.busy) {
          boxesOf(view).delete(box.key);
          holdDropped(box);
          discard(box);
        }
      }
      replyingChanged(view);
      leave();
    },
    mode(mode) {
      box.set({ mode });
    },
    preview(on) {
      box.set({ previewing: on });
    },
    // Files are attached as in the diff's boxes, and nothing while its text is held.
    attach() {
      if (!sendingNow(box.state)) pickFiles(box);
    },
    files(files) {
      if (!sendingNow(box.state)) attachFiles(box, files);
    },
    dragging(count) {
      draggingOver(box, count);
    },
  };
}

/** The frame a box the timeline draws gets, as the window feature draws frames. */
export function timelineFrame(box: Box): Parameters<WritingDiff['compose']>[3] {
  return framer?.(box);
}

/**
 * Notes `composer` as `box`'s editor, drawn in its view's timeline, so the box is open; `left` takes
 * focus once it goes while it had it.
 */
export function drawnInTimeline(box: Box, composer: Composer, left: () => void): void {
  box.composer = composer;
  box.drawnIn = 'timeline';
  box.open = true;
  box.left = left;
  composer.hold(sendingNow(box.state));
  box.set({ mode: composer.mode });
}

/**
 * The timeline stopped drawing `composer`, `box`'s editor, as when the timeline goes. Unless it was
 * closed already or taken elsewhere, it's taken down, and a box still open opens where it opens now:
 * under the code block it was written on, if the overview has it now, though the block was drawn
 * while the timeline still had the draft.
 */
export function leftTimeline(box: Box, composer: Composer): void {
  if (box.composer !== composer) return;
  box.composer = undefined;
  box.drawnIn = undefined;
  composer.dismiss();
  if (box.open) queueMicrotask(() => reopen(box.view));
}

/**
 * Notes which threads of view `view` a reply box is open in, as a box opens or goes: their cards
 * offer no reply of their own meanwhile. The card that changes is the reader's doing. Notes which
 * boxes its timeline draws, too.
 */
function replyingChanged(view: string): void {
  timelineChanged(view);
  const now = new Set<string>();
  // Each comment an edit box is open on, with its thread.
  const edits = new Map<string, string>();
  for (const box of views.get(view)?.values() ?? []) {
    const { place } = box.state;
    if (!box.open) continue;
    if (place.kind === 'reply') now.add(place.thread);
    else if (place.kind === 'edit' && place.thread !== null) edits.set(place.comment, place.thread);
  }
  const diff = writingDiff(view);
  const edited = editing.get(view);
  if (edited.size !== edits.size || [...edits.keys()].some((each) => !edited.has(each))) {
    // The card that draws without its comment, or with it again, is the reader's doing too.
    const threads = new Set(edits.values());
    for (const each of edited) {
      const thread = edits.has(each) ? undefined : threadOf(view, each);
      if (thread !== undefined) threads.add(thread);
    }
    if (diff) for (const thread of threads) claimBriefly(diff, thread);
    editing.set(view, new Set(edits.keys()));
  }
  const was = replying.get(view);
  if (was.size === now.size && [...now].every((thread) => was.has(thread))) return;
  for (const thread of new Set([...was, ...now])) {
    if (was.has(thread) !== now.has(thread) && diff) claimBriefly(diff, thread);
  }
  replying.set(view, now);
}

/** The thread of view `view` that holds the comment with id `id`, by its own. */
function threadOf(view: string, id: string): string | undefined {
  return rowsOf(view).find((row) => row.comments.some((each) => each.id === id))?.id;
}

/**
 * Has what next comes under thread `thread` in `diff` be the reader's doing, for as long as a card
 * takes to be drawn again: what comes in the second frame from now, after the next has laid it out
 * and measured it.
 */
export function claimBriefly(diff: WritingDiff, thread: string): void {
  const release = diff.claimThread(thread);
  requestAnimationFrame(() => requestAnimationFrame(release));
}

/**
 * The box the diff or a block took down as it was drawn again: one the diff took down, open, opens
 * again as it was once the diff is drawn anew ({@link placeKept}); one from a block the overview no
 * longer has, where it opens now.
 */
export function takenDown(box: Box, composer: Composer): void {
  if (box.composer !== composer) return;
  box.composer = undefined;
  // A block goes as its overview changes: its boxes open where they open now, once it's gone.
  if (box.drawnIn === 'block') queueMicrotask(() => reopen(box.view));
  // The diff is drawn again: a box open there stays in its box, as it was, once the diff drawn
  // anew places it, whatever the overview did meanwhile.
  else if (box.drawnIn === 'diff' && box.open) {
    box.retries = 0;
    box.kept = { box: composer.keep(), focused: box.state.focused, inputs: inputsSoFar() };
  }
}

/**
 * Whether a box in `state` has a draft "Discard draft" can take, or why not: one with no text has
 * nothing to discard, and one whose comment is on its way is held.
 */
export function discardable(state: BoxState): true | string {
  if (sendingNow(state)) return 'Sending…';
  return state.text.trim() !== '' || NOTHING_TO_DISCARD;
}

/**
 * "Discard draft", as the control in a box's foot and as a command on the box: there for any box
 * with text but one whose comment is on its way. "Undo" brings the draft back for a few seconds.
 */
export const discarding: Handler<BoxTarget> = {
  run(target) {
    const box = boxNamed(target.box);
    if (box && discardable(box.state) === true) act(box, 'discard');
  },
  enabled: (target) => {
    const box = boxNamed(target.box);
    if (box === undefined) return 'The comment box has closed.';
    return discardable(box.state);
  },
  listed: (target) => boxNamed(target.box) !== undefined,
};

/**
 * What a box's note offers, as a command on the box: there only while the box offers it, in its
 * frame's menu and in the palette. Offers that read the same, as both ways to "Show latest" do, are
 * one command, which does whichever the box offers.
 */
export function offering(...among: readonly Offer[]): Handler<BoxTarget> {
  const offerIn = (target: BoxTarget) => {
    const box = boxNamed(target.box);
    const offers = box && offersOf(box.state);
    return among.find((each) => offers?.includes(each));
  };
  return {
    run(target) {
      const box = boxNamed(target.box);
      const offer = offerIn(target);
      if (box && offer !== undefined) act(box, offer);
    },
    // Listed only where its note offers it. Elsewhere it has no reason to give: a key bound to it
    // does nothing, and says nothing.
    enabled: (target) => offerIn(target) !== undefined || '',
    listed: (target) => offerIn(target) !== undefined,
  };
}

/** A file's path in the base at the head on screen, for one the pull request renames there. */
function previousAt(view: string, path: string): string | null {
  const state = diffStateOf(view);
  if (state?.comparison !== null) return null;
  const file = state.files?.find((each) => each.path.text === path);
  return file?.previous && file.previous.text !== path ? file.previous.text : null;
}

/**
 * `c` on a code block of view `tab`'s overview, `target`: a box under the block's lines, or the
 * cursor's line in its code, or the lines `v` selected there. The lines are mapped to the head on
 * screen: where GitHub takes a comment on them there, it goes on them; otherwise on their file,
 * where the pull request changes or deletes it; otherwise on the pull request itself. Its head says
 * where it goes and why, where that's not the lines the block shows.
 */
export async function commentOnBlock(tab: PullTab, target: Target, how: Send): Promise<void> {
  const view = tab.id;
  const found = blockLines(view, target);
  if (typeof found === 'string') {
    refuse(found);
    return;
  }
  const { writing, at } = found;
  const { block } = writing;
  const head = pullOf(view)?.shown ?? undefined;
  if (head === undefined) {
    refuse(OPENING);
    return;
  }
  knowPull(tab);
  const lines =
    'line' in at
      ? { side: at.side, from: at.line, to: at.line }
      : { side: at.side, from: Math.min(at.from, at.to), to: Math.max(at.from, at.to) };
  const onHead = await commentOnHead(view, block.commit, block.path, lines);
  // A file gone at the head is named by its path in the base, as GitHub names one it deletes.
  const commentable = await commentableOf(
    view,
    head,
    onHead.path,
    onHead.kind === 'gone' ? null : previousAt(view, onHead.path),
  );
  // The reader moved on meanwhile: to another push, or the block let go.
  if (pullOf(view)?.shown !== head || !writingBlock(view, block.key)) return;
  const screen = block.from === null ? Screen.full(head) : Screen.replayed(block.from, head);
  const takes = commentableOn(screen, commentable);
  const goes = blockComment(onHead, takes);
  const home: Home = {
    kind: 'block',
    block: {
      commit: block.commit.toLowerCase(),
      path: block.path,
      block: block.named,
      at: lines,
      why: whyOf(goes),
      head: head.toLowerCase(),
    },
  };
  const place =
    goes.kind === 'pull'
      ? ON_PULL
      : placeOf(head, onHead.path, goes.kind === 'lines' ? goes.lines : undefined);
  openAt(view, undefined, home, place, how, '', whereOf(view, home.block, place));
}
