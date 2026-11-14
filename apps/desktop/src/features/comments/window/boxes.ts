// The comment boxes of each view's diff, in the window until the view's tab closes: where each is,
// its text, and how sending it stands, as main keeps its draft. A box opens from `c`, `C`, `s` or a
// file's `c`; a draft main restored reopens, unfocused, once its view's diff draws its line, and so
// does a box the diff took down as it was drawn again, and, after the window is loaded again, every
// draft's. Text is saved 300 ms after typing stops, and at once as the box closes or the window
// goes. While it's sent, and until Lo knows whether it posted, its text is held as it is. A box
// goes once what it sent is on GitHub, or its draft is discarded; `Esc Esc` closes it and keeps the
// draft for the next box there. Files dropped on it, pasted into it or picked are attached
// (`./uploads.ts`). It isn't sent while one is on its way in, nor while its text holds a
// placeholder whose upload isn't, and its uploads are given up as its draft goes.

import { Lines, suggestionBlock, takesSuggestion } from '@lo/review';
import type { Composer, ComposerEvents, Mode, Send } from '@lo/ui/code';
import type { BoxTarget, Handler, HeaderTarget, LineTarget } from '@lo/ui/commands';

import { announce, notice, notify, withdraw } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { showDiff, writingDiff, type WritingDiff } from '../../diff/window/shared.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { pullOf, runOf, type PullTab } from '../../tab/window/shared.ts';
import type {
  Commentable,
  DraftPlaceRow,
  DraftRow,
  DraftsView,
  SendRefusal,
  Sending,
} from '../contract.ts';
import { main, tabs } from './main.ts';
import { screenOf } from './placing.ts';
import type { PostPull } from './Post.tsx';
import { landed } from './landed.ts';
import { held } from './threads.ts';
import { attachFiles, draggingOver, endUploads, pickFiles, uploadsHold } from './uploads.ts';
import {
  boxAt,
  commentableOn,
  githubPath,
  IN_A_LAYER,
  linesAt,
  NEW_SIDE_ONLY,
  NO_LINES,
  NOT_IN_DIFF,
  offerLabels,
  offersOf,
  type Offer,
  placeKey,
  placeOf,
  SIGN_IN,
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
  /** Why the last send was refused. */
  readonly refusal: SendRefusal | undefined;
}

/** Whether a box's comment is being sent, or may be on GitHub: its text is held as it is. */
export function sendingNow(state: BoxState): boolean {
  const { busy, sending } = state;
  return busy || sending === 'waiting' || sending === 'sending' || sending === 'checking';
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
  /** How the last send was asked for, for "Send it anyway". */
  lastHow: Send;
  /** Whether main marked its draft sent, as after GitHub's answer to it was lost. */
  sentMark = false;
  retries = 0;
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
      refusal: undefined,
    };
  }

  get state(): BoxState {
    return this.#state;
  }

  set(change: Partial<BoxState>): void {
    this.#state = { ...this.#state, ...change };
    this.composer?.hold(sendingNow(this.#state));
    for (const listener of this.#listeners) listener();
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
    save(this.view, this.state.place, this.state.text);
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

function save(view: string, place: DraftPlaceRow, text: string): void {
  main()
    .draft({ id: view, place, text })
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

/** Whether GitHub can't be reached for view `view`, so nothing sends. */
export function offline(view: string): boolean {
  return pullOf(view)?.connection.kind === 'offline';
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
      box.set({ text, restored: undefined });
      box.saveSoon();
    },
    submit(how) {
      void send(box, how);
    },
    close(keep) {
      box.composer = undefined;
      box.open = false;
      if (keep) {
        box.saveNow();
        return;
      }
      // Nothing to keep: its draft goes, unless main is still settling what it sent, and nothing
      // still uploading goes into it.
      box.dropSave();
      endUploads(box);
      if (box.sentMark || box.state.busy) return;
      boxesOf(box.view).delete(box.key);
      holdDropped(box);
      save(box.view, box.state.place, '');
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
 * Opens `box` in its view's diff, where its place is drawn, if it is: focused when it asks to be.
 * Says whether it's open.
 */
function show(box: Box, diff: WritingDiff): boolean {
  if (box.composer) {
    if (box.focusOnOpen) box.composer.focus();
    box.focusOnOpen = false;
    return true;
  }
  const drawn = diff.drawn();
  const file = drawn.files.find((each) => githubPath(each) === box.state.place.path);
  const where = boxAt(drawn, screenFor(box.view, diff, file?.since ?? false), box.state.place);
  if (!where) return false;
  try {
    box.composer = diff.compose(where.at, box.state.text, eventsOf(box), framer?.(box), {
      focus: box.focusOnOpen,
      name: box.id,
    });
  } catch {
    // Its line isn't drawn yet, as while its file's diff is worked out.
    return false;
  }
  box.composer.hold(sendingNow(box.state));
  box.set({ mode: box.composer.mode });
  box.focusOnOpen = false;
  box.retries = 0;
  return true;
}

const retrying = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Opens view `view`'s boxes that should show, in its diff as it's drawn now: drafts restored as Lo
 * started, and boxes the diff took down as it was drawn again. One whose line isn't drawn yet tries
 * again in a moment, a few times.
 */
export function restore(view: string): void {
  const diff = writingDiff(view);
  const own = views.get(view);
  if (!diff || !own) return;
  let again = false;
  for (const box of own.values()) {
    if (!box.open || box.composer) continue;
    if (!show(box, diff) && box.retries < RETRIES) {
      box.retries += 1;
      again = true;
    }
  }
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

const caught = new Set<string>();

/** Asks main once for view `view`'s drafts, for a view drawn before main said anything of them. */
export function catchUpDrafts(view: string): void {
  if (caught.has(view)) return;
  caught.add(view);
  main()
    .current({ id: view })
    .then(({ drafts }) => {
      if (drafts && !views.has(view)) takeDrafts(drafts);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a view's drafts:", error));
}

/** Whether two places are the same lines of the same file, at whatever revision. */
function sameLines(a: DraftPlaceRow, b: DraftPlaceRow): boolean {
  return a.path === b.path && JSON.stringify(a.lines) === JSON.stringify(b.lines);
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
      // What GitHub's lost answer was to posted: it's done.
      own.delete(key);
      box.open = false;
      const { composer } = box;
      box.composer = undefined;
      composer?.close();
      continue;
    }
    if (box.composer || box.saving || box.state.busy) continue;
    own.delete(key);
    gone.push(box);
  }
  for (const [key, row] of rows) {
    let box = own.get(key);
    if (!box) {
      const moved = gone.find(
        (each) => sameLines(each.state.place, row.place) && each.state.text === row.text,
      );
      box = new Box(view, row.place, moved?.state.primary ?? 'review', row.text);
      box.open = row.restored || first || (moved?.open ?? false);
      if (first) box.set({ restored: row.savedAt });
      own.set(key, box);
    }
    takeRow(box, row);
  }
  restore(view);
}

/** A box takes its draft's row: how sending it stands, and its text unless it was typed in. */
function takeRow(box: Box, row: DraftRow): void {
  box.sentMark = row.sent !== null;
  const typed = box.composer !== undefined || box.saving;
  box.set({
    sending: row.sending,
    ...(row.restored ? { restored: row.savedAt } : {}),
    ...(typed ? {} : { text: row.text }),
  });
}

/**
 * Opens a box at `place` in view `view`'s diff, focused: the one there, if there is one. One with
 * no text yet starts with `draft`.
 */
function openAt(
  view: string,
  diff: WritingDiff,
  place: DraftPlaceRow,
  how: Send,
  draft = '',
): Box | undefined {
  const own = boxesOf(view);
  const key = placeKey(place);
  let box = own.get(key);
  if (!box) {
    box = new Box(view, place, how, draft);
    own.set(key, box);
    dropped.get(view)?.delete(key);
  } else if (!box.composer) {
    box.set({ primary: how, ...(box.state.text.trim() === '' ? { text: draft } : {}) });
  }
  box.open = true;
  box.focusOnOpen = true;
  const fresh = box.composer !== undefined && box.composer.text.trim() === '' && draft !== '';
  if (!show(box, diff)) return undefined;
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
  const title = suggest ? 'Suggest a change' : 'Comment';
  const commentable = await commentableOf(view, drawn.at, path, previousOf(file));
  // The reader moved on meanwhile: to another tab, or the diff drawn again.
  if (writingDiff(view, true)?.drawn().at !== drawn.at) return;
  const takes = commentableOn(screenFor(view, diff, file.since), commentable);
  if (target.kind === 'header') {
    if (takes && !takes.takesFileComment()) {
      notify(
        title,
        'GitHub takes no comment on this file here: the pull request doesn’t change it at this revision.',
      );
      return;
    }
    openAt(view, diff, placeOf(drawn, path, undefined), how);
    return;
  }
  const on = linesAt(takes, target.at);
  if (!on) {
    if (takes && !takes.takesFileComment()) {
      notify(
        title,
        'GitHub takes no comment on this file here: the pull request doesn’t change it at this revision.',
      );
      return;
    }
    // Where main couldn't read the file's patch, it takes a comment on the file only.
    const said = takes ? NOT_IN_DIFF : NO_LINES;
    offered = { view, file: file.id, how, said };
    notify(title, said);
    return;
  }
  if (suggest && !takesSuggestion(on)) {
    notify(title, NEW_SIDE_ONLY);
    return;
  }
  const place = placeOf(drawn, path, on);
  if (!suggest) {
    openAt(view, diff, place, how);
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
  const box = openAt(view, diff, place, how, block.slice(0, end));
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
  if (offer?.view !== tab.id || notice()?.body !== offer.said) return false;
  withdraw(notice()!.title, offer.said);
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
    notify('Comment on the file', 'The diff isn’t drawn yet.');
    return;
  }
  const file = diff.drawn().files.find((each) => each.key === key);
  if (!file) {
    notify('Comment on the file', 'The diff on screen doesn’t show this file.');
    return;
  }
  diff.toTop(file.id);
  await comment(tab, { kind: 'header', file: file.id, side: 'new' }, 'review');
}

/** Sends a box's text, as `⌘⏎` (`review`) or `⌥⏎` (`now`) asks. */
export async function send(box: Box, how: Send): Promise<void> {
  const { view } = box;
  const { place, text } = box.state;
  if (sendingNow(box.state) || uploadsHold(box) !== undefined) return;
  if (text.trim() === '' || offline(view) || canWrite(view) !== true) return;
  box.dropSave();
  box.lastHow = how;
  box.set({ busy: true, refusal: undefined });
  try {
    const outcome = await main().send({ id: view, place, text, how });
    switch (outcome.kind) {
      case 'sent': {
        boxesOf(view).delete(box.key);
        box.open = false;
        const { composer } = box;
        box.composer = undefined;
        composer?.close();
        if (outcome.landedOn && outcome.thread !== null) {
          const thread = outcome.thread;
          landed.update(view, (was) => new Set([...was, thread]));
        }
        if (outcome.joined) {
          announce(
            'Added to your pending review',
            'GitHub posts nothing else from you while you have one.',
          );
        }
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

/** Does what a box's note offers. */
export function act(box: Box, offer: Offer): void {
  const { view } = box;
  switch (offer) {
    case 'discard':
      drop(box);
      return;
    case 'sendAnyway':
      void send(box, box.lastHow);
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
  endUploads(box);
  boxesOf(view).delete(key);
  box.dropSave();
  box.open = false;
  const { composer } = box;
  box.composer = undefined;
  composer?.dismiss();
  holdDropped(box);
  main()
    .discard({ id: view, place: box.state.place })
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

/** Moves a box's text to a box on its file, as GitHub takes no comment on its lines. */
function toFile(box: Box): void {
  const { view } = box;
  const diff = writingDiff(view);
  if (!diff) return;
  const { place, text, primary } = box.state;
  const onFile: DraftPlaceRow = { ...place, lines: null };
  drop(box);
  const there = openAt(view, diff, onFile, primary);
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
    pulls.delete(view);
    dropped.delete(view);
    caught.delete(view);
    clearTimeout(retrying.get(view));
    retrying.delete(view);
  }
  for (const [key, { view }] of commentables) if (!kept.has(view)) commentables.delete(key);
}

/** The box the diff took down as it was drawn again: it opens again once the diff is drawn. */
export function takenDown(box: Box, composer: Composer): void {
  if (box.composer === composer) box.composer = undefined;
}

/**
 * What a box's note offers, as a command on the box: there only while the box offers it, in its
 * frame's menu and in the palette.
 */
export function offering(offer: Offer): Handler<BoxTarget> {
  const offers = (target: BoxTarget) => {
    const box = boxNamed(target.box);
    return box !== undefined && offersOf(box.state).includes(offer);
  };
  return {
    run(target) {
      const box = boxNamed(target.box);
      if (box && offers(target)) act(box, offer);
    },
    enabled: (target) => offers(target) || `“${offerLabels[offer]}” isn’t offered in this box now.`,
    listed: offers,
  };
}
