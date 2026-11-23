// Code features in the window: what `gd`, `gr`, `K`, `gh` and `gO` ask the code port, and what
// each shows of the answer, through the diff's code views, which draw it. A peek of definitions
// under the cursor's line, whose answer `j` and `k` pick and `⏎` goes to; references in the right
// panel; a card over a word, from `K` or the pointer resting on it, which never takes focus; inline
// hints, on or off for the window; and a palette of the file's outline. A question asked again
// cancels the one before, and what finds nothing says so in the status bar and opens nothing.

import { KEY_EVENT, type HeaderTarget, type LineTarget, type Side } from '@lo/ui/commands';
import type { Anchor, HintMark, PeekCode, PeekFrame, PeekParts, Place } from '@lo/ui/code';
import { createStore } from 'zustand/vanilla';

import { focusMiddle } from '../../../window/commands/registry.ts';
import {
  codeViews,
  highlightText,
  showPlace,
  type CodeFile,
  type CodeViewKind,
} from '../../diff/window/shared.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { changeSetting } from '../../settings/window/shared.ts';
import {
  activeTab,
  localCopyOf,
  putRight,
  rightKept,
  rightShown,
  showRight,
  tabState,
  type RightKept,
} from '../../tab/window/shared.ts';
import type { Definitions, Hints, Hover, Lines, NoHover, Outline, References } from '../port.ts';
import { hints as hintsSetting } from '../settings.ts';
import {
  allOutside,
  cardOf,
  codeOf,
  failureOf,
  isOutside,
  NO_NAME,
  noDefinition,
  noHints,
  noHover,
  noneFound,
  noReferences,
  notYet,
  peekOf,
  textsFrom,
} from './answers.ts';
import { port } from './main.ts';
import { say } from './said.ts';
import { servers } from './servers.ts';
import { offerOnce, statuses } from './status.ts';

/** The references panel's id among the right panel's views. */
export const REFERENCES = 'code.references';

/** A place in a code view asked about, as the code port names it. */
interface Asked {
  readonly tab: string;
  readonly view: CodeViewKind;
  readonly at: Place;
  readonly file: CodeFile & { readonly commit: string };
  readonly input: {
    view: string;
    key: string;
    path: string;
    line: number;
    column: number;
  };
}

/** The line a line target names, at its column: the cursor's, or the last of the lines selected. */
function placeOf(target: LineTarget | HeaderTarget): Place {
  if (target.kind === 'header') return { file: target.file, side: target.side, line: 1, column: 0 };
  const { at } = target;
  if ('line' in at) return { ...at, column: at.column ?? 0 };
  return { file: at.file, side: at.side, line: Math.max(at.from, at.to), column: 0 };
}

/** The pull request's tab on screen and its code view the keys act on, or why there's none. */
export function onCode(): { tab: string; view: CodeViewKind } | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const view = codeViews(tab.id).onScreen();
  return view ? { tab: tab.id, view } : 'There’s no code on screen.';
}

/** Whether code features can run on what's on screen, or why not. */
export function codeNow(): true | string {
  const on = onCode();
  return typeof on === 'string' ? on : true;
}

/** The question a key on `target` asks, or, having said why in the status bar, nothing. */
function ask(target: LineTarget | HeaderTarget): Asked | undefined {
  const on = onCode();
  if (typeof on === 'string') return undefined;
  const { tab, view } = on;
  const at = placeOf(target);
  const why = notYet(localCopyOf(tab));
  if (why) {
    say(tab, why);
    return undefined;
  }
  const file = codeViews(tab).fileAt(at);
  if (!file) {
    say(tab, 'Lo can’t name this file to the syntax index: its path isn’t UTF-8.');
    return undefined;
  }
  const { commit } = file;
  if (commit === undefined) {
    say(tab, 'The syntax index waits for the local copy.');
    return undefined;
  }
  return {
    tab,
    view,
    at,
    file: { ...file, commit },
    input: { view: tab, key: commit, path: file.path, line: at.line, column: at.column ?? 0 },
  };
}

/** What each kind of question asked last, by tab, to cancel as the next is asked. */
const asking = new Map<string, AbortController>();

/** A new question of `kind` in tab `tab`, cancelling the one before. */
function fresh(kind: string, tab: string): AbortSignal {
  const key = `${kind}:${tab}`;
  asking.get(key)?.abort();
  const controller = new AbortController();
  asking.set(key, controller);
  return controller.signal;
}

/** Says what a question that failed says, unless a newer one cancelled it. */
function failed(tab: string, error: unknown): void {
  const why = failureOf(error);
  if (why !== undefined) say(tab, why);
}

// The peek --------------------------------------------------------------------------------------

/** A peek open under a line: what it answers and which answer it shows. */
export interface OpenPeek {
  readonly tab: string;
  readonly view: CodeViewKind;
  readonly at: Place;
  readonly side: Side;
  readonly commit: string;
  readonly found: Definitions & { readonly name: string };
  readonly shown: number;
  /** The code of each answer read so far, by its place in the list, highlighted once it is. */
  readonly codes: ReadonlyMap<number, PeekCode>;
  /** "r5": the revision its answers are at, if it's one of the pull request's. */
  readonly revision: string | undefined;
  /** Where the comparison on screen shows each answer's file, by its place in the list. */
  readonly inDiff: ReadonlyMap<number, boolean>;
  /** The parts its frame draws in, once the view made them. */
  readonly parts: PeekParts | undefined;
}

/** The peek open in each tab, if any. */
export const peeks = createStore<ReadonlyMap<string, OpenPeek>>()(() => new Map());

function setPeek(tab: string, peek: OpenPeek | undefined): void {
  const next = new Map(peeks.getState());
  if (peek) next.set(tab, peek);
  else next.delete(tab);
  peeks.setState(next, true);
}

/** The peek open in tab `tab`, if any. */
export function peekIn(tab: string): OpenPeek | undefined {
  return peeks.getState().get(tab);
}

/** The peek open in the tab on screen, or why there's none. */
function peekOnScreen(): OpenPeek | string {
  const tab = activeTab();
  const open = tab ? peekIn(tab.id) : undefined;
  return open ?? 'There’s no peek open.';
}

export function peekNow(): true | string {
  const open = peekOnScreen();
  return typeof open === 'string' ? open : true;
}

/**
 * The frame a peek of `found` in tab `tab` draws, in the parts its view makes: the overlay draws
 * in them.
 */
function frameFor(tab: string, found: OpenPeek['found']): PeekFrame {
  return (parts) => {
    const open = peekIn(tab);
    if (open?.found === found) setPeek(tab, { ...open, parts });
    return {
      update() {},
      destroy() {
        // As it closes, however it closes: another opening, or its file going.
        if (peekIn(tab)?.parts === parts) setPeek(tab, undefined);
      },
    };
  };
}

/** Shows `open` in its view: what it shows now, its frame kept. */
function draw(open: OpenPeek): boolean {
  const code = open.codes.get(open.shown);
  return codeViews(open.tab).peek(
    open.view,
    open.at,
    peekOf(open.found, open.shown, code),
    frameFor(open.tab, open.found),
  );
}

/** Reads, then highlights, the code of answer `index` of `open`, if it hasn't been. */
async function readCode(open: OpenPeek, index: number, signal: AbortSignal): Promise<void> {
  const answer = open.found.answers[index];
  // One outside the repository has no code Lo reads.
  if (!answer || isOutside(answer) || open.codes.get(index)?.tokens) return;
  let lines: Lines | undefined = answer.lines ?? undefined;
  if (!lines && !open.codes.has(index)) {
    lines = await port().snippet(
      { view: open.tab, key: open.commit, path: answer.path, line: answer.line },
      { signal },
    );
  }
  const kept = open.codes.get(index);
  const plain = kept ?? codeOf(lines);
  if (!plain) return;
  if (!kept) showCode(open, index, plain);
  const tokens = await highlightText(answer.path, plain.lines.join('\n'), signal).catch(
    () => undefined,
  );
  if (tokens) showCode(open, index, { ...plain, tokens });
}

/** Keeps `code` as answer `index`'s, and draws it if the peek still shows that answer. */
function showCode(open: OpenPeek, index: number, code: PeekCode): void {
  const now = peekIn(open.tab);
  if (!now || now.found !== open.found) return;
  const next = { ...now, codes: new Map(now.codes).set(index, code) };
  setPeek(open.tab, next);
  if (next.shown === index) draw(next);
}

/** `gd`: the definitions of the word at the cursor, in a peek under its line. */
export async function definition(target: LineTarget): Promise<void> {
  const on = onCode();
  try {
    await define(target);
  } finally {
    // The first `g d` in a repo nothing trusts offers to trust it, once, over its answer.
    if (typeof on !== 'string') offerOnce(on.tab);
  }
}

/** Finds the definitions of the name at `target`, and shows them in a peek under its line. */
async function define(target: LineTarget): Promise<void> {
  const asked = ask(target);
  if (!asked) return;
  const { tab, view, at, file } = asked;
  const signal = fresh('definitions', tab);
  let found: Definitions;
  try {
    found = await port().definitions(asked.input, { signal });
  } catch (error) {
    failed(tab, error);
    return;
  }
  if (signal.aborted) return;
  const { name } = found;
  if (name === null) {
    say(tab, NO_NAME);
    return;
  }
  if (found.answers.length === 0) {
    say(tab, noneFound(noDefinition(name), found.fallback));
    return;
  }
  const views = codeViews(tab);
  const inDiff = new Map(
    found.answers.map(
      (answer, index) =>
        [index, !isOutside(answer) && views.inDiff(answer.path, answer.side)] as const,
    ),
  );
  const top = found.answers[0];
  const first = top && !isOutside(top) ? codeOf(top.lines) : undefined;
  const open: OpenPeek = {
    tab,
    view,
    at,
    side: at.side,
    commit: file.commit,
    found: { ...found, name },
    shown: 0,
    codes: first ? new Map([[0, first]]) : new Map(),
    revision: revisionLabel(revisionsOf(tab), file.commit),
    inDiff,
    parts: undefined,
  };
  setPeek(tab, open);
  if (!draw(open)) {
    setPeek(tab, undefined);
    say(tab, 'There’s no line drawn there to show a peek under.');
    return;
  }
  readCode(open, 0, signal).catch((error: unknown) => failed(tab, error));
}

/** `j` and `k` in a peek: the next or previous answer, its code read if it hasn't been. */
export function pick(step: 1 | -1): void {
  const open = peekOnScreen();
  if (typeof open === 'string') return;
  pickAnswer(open, Math.max(0, Math.min(open.found.answers.length - 1, open.shown + step)));
}

/**
 * Shows answer `index` of `open`: as tall as its code, when that came with the answer, or as tall
 * as code gets while it's read.
 */
export function pickAnswer(open: OpenPeek, index: number): void {
  const answer = open.found.answers[index];
  if (index === open.shown || !answer) return;
  // Code that came with the answer is drawn with it, so the peek is its height from the first.
  const came = open.codes.has(index) || isOutside(answer) ? undefined : codeOf(answer.lines);
  const codes = came ? new Map(open.codes).set(index, came) : open.codes;
  const next = { ...open, shown: index, codes };
  setPeek(open.tab, next);
  draw(next);
  const signal = fresh('snippet', open.tab);
  readCode(next, index, signal).catch((error: unknown) => failed(open.tab, error));
}

/** Closes the peek in `open`'s view: the cursor goes back to its line, and focus to the code. */
export function closePeek(open: OpenPeek | string = peekOnScreen()): void {
  if (typeof open === 'string') return;
  setPeek(open.tab, undefined);
  codeViews(open.tab).peek(open.view, open.at, undefined);
}

/**
 * `⏎` in a peek: its answer shown, into the diff when the comparison shows that file on that side,
 * else the file whole, its line marked. Where the cursor was under the peek is recorded in the
 * tab's history, so `⌃o` comes back.
 */
export function goToAnswer(open: OpenPeek | string = peekOnScreen()): void {
  if (typeof open === 'string') return;
  const answer = open.found.answers[open.shown];
  // One outside the repository has nowhere to go.
  if (!answer || isOutside(answer)) return;
  closePeek(open);
  showPlace(
    open.tab,
    answer.path,
    answer.line,
    { from: answer.line, to: answer.line },
    answer.side,
  );
}

// References ------------------------------------------------------------------------------------

/** The references listed in a tab's right panel. */
export interface ListedReferences {
  readonly view: CodeViewKind;
  readonly side: Side;
  readonly commit: string;
  readonly found: References & { readonly name: string };
  /** The reference the keyboard is on, by its place in the list. */
  readonly focused: number;
  /** The one last gone to, if any. */
  readonly current: number | undefined;
  /** Lines read for references that came without theirs, by their places in the list. */
  readonly texts: ReadonlyMap<number, string>;
  /** How the right panel stood as the references came, which `Esc` puts back. */
  readonly before: RightKept | undefined;
  readonly revision: string | undefined;
}

/** The references each tab lists, once `gr` has found some. */
export const listed = tabState<ListedReferences | undefined>(() => undefined);

/** How many lines of references that came without theirs are read at a time. */
const READ_AHEAD = 4;

/** Reads the lines of references that came without them, a few at a time, in the list's order. */
async function readTexts(tab: string, found: ListedReferences['found'], signal: AbortSignal) {
  const { answers } = found;
  const wanted = answers.flatMap((answer, index) => (answer.lines ? [] : [index]));
  while (wanted.length > 0 && !signal.aborted) {
    const now = listed.get(tab);
    if (now?.found !== found) return;
    const batch = wanted.splice(0, READ_AHEAD).filter((index) => !now.texts.has(index));
    const read = await Promise.all(
      batch.map(async (index) => {
        const answer = answers[index];
        if (!answer) return new Map<number, string>();
        const lines = await port().snippet(
          { view: tab, key: now.commit, path: answer.path, line: answer.line },
          { signal },
        );
        return textsFrom(answers, index, lines);
      }),
    );
    const latest = listed.get(tab);
    if (latest?.found !== found) return;
    const texts = new Map(latest.texts);
    for (const each of read) for (const [index, text] of each) texts.set(index, text);
    listed.set(tab, { ...latest, texts });
  }
}

/**
 * `gr`: where the word at the cursor, or under the peek, is used, in the right panel, which opens
 * if it's closed and takes focus. A peek open closes first.
 */
export async function references(target: LineTarget): Promise<void> {
  const asked = ask(target);
  if (!asked) return;
  const { tab, view, at, file } = asked;
  const signal = fresh('references', tab);
  let found: References;
  try {
    found = await port().references(asked.input, { signal });
  } catch (error) {
    failed(tab, error);
    return;
  }
  if (signal.aborted) return;
  const { name } = found;
  if (name === null) {
    say(tab, NO_NAME);
    return;
  }
  if (found.answers.length === 0) {
    const outside = found.outside ?? 0;
    say(
      tab,
      outside > 0 ? allOutside(name, outside) : noneFound(noReferences(name), found.fallback),
    );
    return;
  }
  const open = peekIn(tab);
  if (open) closePeek(open);
  // How the panel stood before the references came, to put back as they go.
  const before = rightShown(tab) === REFERENCES ? listed.get(tab)?.before : rightKept(tab);
  const list: ListedReferences = {
    view,
    side: at.side,
    commit: file.commit,
    found: { ...found, name },
    focused: 0,
    current: undefined,
    texts: new Map(),
    before,
    revision: revisionLabel(revisionsOf(tab), file.commit),
  };
  listed.set(tab, list);
  showRight(tab, REFERENCES);
  readTexts(tab, list.found, signal).catch((error: unknown) => failed(tab, error));
}

/** The references the tab on screen lists, or why there are none. */
function listedOnScreen(): { tab: string; list: ListedReferences } | string {
  const tab = activeTab();
  const list = tab ? listed.get(tab.id) : undefined;
  return tab && list ? { tab: tab.id, list } : 'There are no references listed.';
}

export function listedNow(): true | string {
  const on = listedOnScreen();
  return typeof on === 'string' ? on : true;
}

/** `j` and `k` in the references panel. */
export function stepReferences(by: 1 | -1): void {
  const on = listedOnScreen();
  if (typeof on === 'string') return;
  const { tab, list } = on;
  const focused = Math.max(0, Math.min(list.found.answers.length - 1, list.focused + by));
  if (focused !== list.focused) listed.set(tab, { ...list, focused });
}

/** Goes to reference `index` of tab `tab`'s, as the peek's `⏎` goes. */
export function goToReference(tab: string, index: number): void {
  const list = listed.get(tab);
  const answer = list?.found.answers[index];
  if (!list || !answer) return;
  listed.set(tab, { ...list, focused: index, current: index });
  showPlace(tab, answer.path, answer.line, undefined, answer.side);
}

/** `⏎` in the references panel: the reference the keyboard is on. */
export function goToFocused(): void {
  const on = listedOnScreen();
  if (typeof on === 'string') return;
  goToReference(on.tab, on.list.focused);
}

/**
 * `Esc` in the references panel: the panel as it was before the references came, open on what it
 * showed, or closed and on the threads, as `⌘⇧\` opens it next; focus goes back to the middle view
 * either way.
 */
export function closeReferences(): void {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return;
  const before = listed.get(tab.id)?.before ?? { open: false, right: undefined };
  putRight(tab.id, {
    open: before.open,
    right: before.right === REFERENCES ? undefined : before.right,
  });
  focusMiddle();
}

// The hover -------------------------------------------------------------------------------------

/** The card over a word: what's known of it, and where it's drawn. */
export interface ShownHover {
  readonly tab: string;
  readonly view: CodeViewKind;
  readonly at: Place;
  readonly anchor: Anchor;
  readonly hover: Hover;
  readonly revision: string | undefined;
}

/** The card shown, if any: one for the window. */
export const hovers = createStore<ShownHover | undefined>()(() => undefined);

/**
 * What any input does to the card: closes it, as moving the cursor or the pointer does. A key, as
 * the key listener tells of it once it's the reader's input (`KEY_EVENT`), those Lo's commands
 * take among them; a press; or the wheel.
 */
const INPUT = [KEY_EVENT, 'pointerdown', 'wheel'] as const;

/** Closes the card on the reader's input, but a press or the wheel on the card itself. */
function closeOnInput(event: Event): void {
  const { target } = event;
  if (event.type !== KEY_EVENT && target instanceof Element && target.closest('[data-lo-hover]')) {
    return;
  }
  closeHover();
}

/** Closes the card, and stops asking for one. */
export function closeHover(): void {
  for (const kind of INPUT) window.removeEventListener(kind, closeOnInput, true);
  const shown = hovers.getState();
  if (shown) asking.get(`hover:${shown.tab}`)?.abort();
  if (shown) hovers.setState(undefined, true);
}

/**
 * Asks what the word at `at` is, and shows the card over it; `byKey` says so when it's nothing.
 * The reader's input while it asks, which would take the card away, stops it coming.
 */
async function showHover(asked: Asked, byKey: boolean): Promise<void> {
  const { tab, view, at } = asked;
  const signal = fresh('hover', tab);
  const stop = (): void => {
    const controller = asking.get(`hover:${tab}`);
    if (controller?.signal === signal) controller.abort();
  };
  for (const kind of INPUT) window.addEventListener(kind, stop, true);
  let hover: Hover | NoHover;
  try {
    hover = await port().hover(asked.input, { signal });
  } catch (error) {
    if (byKey) failed(tab, error);
    return;
  } finally {
    for (const kind of INPUT) window.removeEventListener(kind, stop, true);
  }
  if (signal.aborted) return;
  // A hover with nothing the card can draw is none, saying why a server didn't answer.
  if ('none' in hover || !cardOf(hover)) {
    if (byKey) say(tab, noHover(hover.fallback));
    return;
  }
  const anchor = codeViews(tab).anchor(view, at);
  if (!anchor) return;
  closeHover();
  hovers.setState(
    { tab, view, at, anchor, hover, revision: revisionLabel(revisionsOf(tab), asked.file.commit) },
    true,
  );
  // The reader's next input takes it away: a key, a click or the wheel.
  for (const kind of INPUT) window.addEventListener(kind, closeOnInput, true);
}

/** `K`: what the word at the cursor is, in a card over it. */
export async function typeOf(target: LineTarget): Promise<void> {
  const asked = ask(target);
  if (asked) await showHover(asked, true);
}

/** The pointer rested on a word in a tab's code view, or left it. */
export function rested(tab: string, view: CodeViewKind, at: Place | undefined): void {
  if (at === undefined) {
    asking.get(`hover:${tab}`)?.abort();
    const shown = hovers.getState();
    if (shown?.tab === tab) closeHover();
    return;
  }
  const screen = onCode();
  if (typeof screen === 'string' || screen.tab !== tab || screen.view !== view) return;
  // Quietly: a rest that finds nothing shows nothing.
  if (notYet(localCopyOf(tab))) return;
  const file = codeViews(tab).fileAt(at);
  if (!file?.commit) return;
  const asked: Asked = {
    tab,
    view,
    at,
    file: { ...file, commit: file.commit },
    input: { view: tab, key: file.commit, path: file.path, line: at.line, column: at.column ?? 0 },
  };
  showHover(asked, false).catch((error: unknown) =>
    console.error('Lo couldn’t show a type:', error),
  );
}

// Hints -----------------------------------------------------------------------------------------

/** Inline type hints, for the window. */
export interface HintsState {
  /**
   * Whether they're on: as `code.hints` says, which `gh` saves only once it has found some to show,
   * and Settings and the file change.
   */
  readonly on: boolean;
  /** The view a `gh` turning them on asks in, until its answer comes. */
  readonly pressed: string | undefined;
}

/** Whether inline type hints are on for the window, or on their way on. */
export const hints = createStore<HintsState>()(() => ({ on: false, pressed: undefined }));

/** The views hints were drawn in, to take them away from as they're turned off. */
const hinted = new Set<string>();

const HINTED_VIEWS = ['diff', 'file'] as const;

/**
 * Asks for the hints of the head's side of each file on screen in tab `tab`'s code views, and
 * draws them. Gives what each file's question found, or nothing once a newer one took its place.
 */
async function askHints(
  tab: string,
  signal: AbortSignal = fresh('hints', tab),
): Promise<Hints[] | undefined> {
  const views = codeViews(tab);
  const found: Hints[] = [];
  for (const view of HINTED_VIEWS) {
    const marks: HintMark[] = [];
    for (const { file: id, lines } of views.newOnScreen(view)) {
      const at: Place = { file: id, side: 'new', line: 1 };
      const file = views.fileAt(at);
      if (!file?.commit) continue;
      const answer = await port().hints(
        { view: tab, key: file.commit, path: file.path, from: 1, to: lines },
        { signal },
      );
      if (signal.aborted) return undefined;
      found.push(answer);
      for (const hint of answer.hints) {
        marks.push({
          kind: 'hint',
          at: { file: id, side: 'new', line: hint.line, column: hint.column },
          label: hint.label,
          padding: { before: hint.paddingLeft === true, after: hint.paddingRight === true },
        });
      }
    }
    if (marks.length > 0) hinted.add(tab);
    views.setHints(view, marks);
  }
  return found;
}

/** Takes the hints away from every view, and stops asking for them. */
function hintsOff(): void {
  hints.setState({ on: false, pressed: undefined }, true);
  for (const [key, controller] of asking) if (key.startsWith('hints:')) controller.abort();
  for (const tab of hinted) for (const view of HINTED_VIEWS) codeViews(tab).setHints(view, []);
  hinted.clear();
}

/**
 * Asks for view `tab`'s hints as `gh` turns them on: on for the window once some come, or, when
 * none do, said why and left off. A newer question in its place, as the view is drawn anew, decides
 * instead.
 */
async function turnOn(tab: string): Promise<void> {
  hints.setState({ on: false, pressed: tab }, true);
  const signal = fresh('hints', tab);
  try {
    const found = await askHints(tab, signal);
    // Turned off meanwhile, asked again as the view was drawn anew, or the view closed.
    if (!found) return;
    const none = noHints(found, statuses.get(tab), servers.get(tab));
    hints.setState({ on: none === undefined, pressed: undefined }, true);
    if (none !== undefined) say(tab, none);
    else void changeSetting(hintsSetting, true);
  } catch (error) {
    if (signal.aborted) return;
    hintsOff();
    failed(tab, error);
  }
}

/**
 * `gh`: inline type hints on for the window, asked for the code on screen, or off everywhere, and
 * saved either way. They come on only when the code on screen gets some: when it gets none, as on
 * a repo Lo runs no language server for, `gh` says why and leaves them off, so the next one asks
 * again.
 */
export async function toggleHints(): Promise<void> {
  const on = onCode();
  if (typeof on === 'string') return;
  const { tab } = on;
  // On, or asking to come on: off.
  const { on: shown, pressed } = hints.getState();
  if (shown || pressed !== undefined) {
    hintsOff();
    void changeSetting(hintsSetting, false);
    return;
  }
  const why = notYet(localCopyOf(tab));
  if (why) {
    say(tab, why);
    return;
  }
  await turnOn(tab);
}

/**
 * A view's code was drawn anew: while hints are on, it asks for its own, quietly, and while `gh`
 * asks in it to turn them on, `gh` asks again.
 */
export function redrawn(tab: string): void {
  const { on, pressed } = hints.getState();
  if ((!on && pressed !== tab) || notYet(localCopyOf(tab))) return;
  const asked = pressed === tab ? turnOn(tab) : askHints(tab);
  asked.catch((error: unknown) => {
    if (failureOf(error) !== undefined) console.error('Lo couldn’t ask for type hints:', error);
  });
}

/**
 * Follows `code.hints` as it's read and changed, by `gh`, Settings or the file: on, hints are on for
 * the window and the code on screen asks for its own, quietly; off, they go from every view.
 */
export function followHints(on: boolean): void {
  const { on: shown, pressed } = hints.getState();
  // Off while `gh` asks is only the setting as it was: `gh` decides.
  if (!on) {
    if (shown) hintsOff();
    return;
  }
  if (shown || pressed !== undefined) return;
  hints.setState({ on: true, pressed: undefined }, true);
  const screen = onCode();
  if (typeof screen !== 'string') redrawn(screen.tab);
}

/** View `tab` closed: what was asked about it stops, and it's forgotten. */
export function viewClosed(tab: string): void {
  for (const [key, controller] of asking) {
    // Keys are `<kind>:<view>`, and no kind has a colon.
    if (key.slice(key.indexOf(':') + 1) !== tab) continue;
    controller.abort();
    asking.delete(key);
  }
  hinted.delete(tab);
  if (hints.getState().pressed === tab) hints.setState({ on: false, pressed: undefined }, true);
}

// The outline -----------------------------------------------------------------------------------

/** The outline palette: the file it's of, what's typed, and the symbols once they come. */
export interface OutlineOpen {
  readonly open: boolean;
  readonly tab: string;
  readonly view: CodeViewKind;
  /** The file's id in the views, and its side. */
  readonly file: string;
  readonly side: Side;
  readonly path: string;
  readonly query: string;
  readonly outline: Outline | undefined;
  readonly problem: string | undefined;
}

export const outlines = createStore<OutlineOpen | undefined>()(() => undefined);

/** `gO`: the cursor's file's symbols, nested, in a palette. */
export async function outline(target: LineTarget | HeaderTarget): Promise<void> {
  const asked = ask(target);
  if (!asked) return;
  const { tab, view, at, file } = asked;
  const signal = fresh('outline', tab);
  const open: OutlineOpen = {
    open: true,
    tab,
    view,
    file: at.file,
    side: at.side,
    path: file.path,
    query: '',
    outline: undefined,
    problem: undefined,
  };
  outlines.setState(open, true);
  try {
    const answer = await port().outline(
      { view: tab, key: file.commit, path: file.path },
      { signal },
    );
    // Into the palette as it is now, with what's typed meanwhile, unless it closed or another
    // took its place.
    const now = outlines.getState();
    if (!signal.aborted && now?.open === true) outlines.setState({ ...now, outline: answer }, true);
  } catch (error) {
    const problem = failureOf(error);
    const now = outlines.getState();
    if (problem !== undefined && !signal.aborted && now?.open === true) {
      outlines.setState({ ...now, problem }, true);
    }
  }
}

/** What's typed in the outline palette. */
export function typeOutline(query: string): void {
  const now = outlines.getState();
  if (now) outlines.setState({ ...now, query }, true);
}

/** Closes the outline palette, then, with a line, goes to it in its file: a jump, recorded. */
export function closeOutline(to?: { line: number; column: number }): void {
  const now = outlines.getState();
  if (!now?.open) return;
  outlines.setState({ ...now, open: false }, true);
  if (to) {
    codeViews(now.tab).go(now.view, { file: now.file, side: now.side, ...to });
  }
}

/** The palette has gone: what it held goes too. */
export function outlineClosed(): void {
  if (outlines.getState()?.open === false) outlines.setState(undefined, true);
}
