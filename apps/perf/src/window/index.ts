// The suite's page: the diff view of one pull request, opened as the diff feature opens it, through
// `@lo/ui/code`, and filled in as the background process sends each file's diff and highlighting,
// then the moves. A file kept out gets its lines from main when it's loaded, and its diff from the
// background process after them. Keys take the app's path: the registry's listener sees each first
// and runs Lo's commands, and the view's Vim gets the rest.

// First, so its observers see the rest of the page run.
import { markFirst, markLoad, markLoaded, marks, now } from './marks.ts';

import { diffText, splitLines } from '@lo/diff';
import {
  type Composer,
  createDiffView,
  type DiffFile,
  type DiffView,
  type Mark,
  type Place,
  type Span,
} from '@lo/ui/code';
import { type Entry, listen, Registry } from '@lo/ui/commands';

import type { Loaded, PullFile, PullReply, Result } from '../shared/protocol.ts';
import { commandsFor } from './commands.ts';
import { fillerText } from './filler.ts';
import { type Comment, PlainThreads } from './threads.ts';

declare global {
  interface Window {
    /** What the preload exposes. */
    perf: {
      pull(): Promise<PullReply>;
      connect(): void;
      load(file: number): Promise<Loaded>;
      copy(text: string): Promise<void>;
    };
  }
}

// The page starts opening the pull request, as a tab opens one.
marks.asked = now();
const reply = await window.perf.pull();
const { pull, nonce } = reply;
Object.assign(marks, { opened: reply.opened, read: reply.read });
// Every face the view draws loads before it measures a line: one that loaded later would change
// the width of text already measured, and so where lines wrap, behind the editors' backs.
await Promise.all(
  ['400 13px "Fragment Mono"', 'italic 400 13px "Fragment Mono"', '400 13px "Host Grotesk"'].map(
    (font) => document.fonts.load(font),
  ),
);
const root = document.getElementById('root');
if (!root) throw new Error('The page has no root.');

/** Files are named by their paths, which a pull request's file list doesn't repeat. */
const ids = pull.files.map((file) => file.path);
const indexOf = new Map(ids.map((id, index) => [id, index]));

/** The threads drawn, with the comments written here, which go nowhere. */
const threads = new PlainThreads();
threadsOf(pull);
/** Drafts kept when a box closed, by where they were written. */
const drafts = new Map<string, string>();
const tab = 'pull';
let view: DiffView | undefined;

const registry: Registry = new Registry({
  system: navigator.platform.startsWith('Mac') ? 'mac' : 'linux',
  commands: commandsFor({
    view: opened,
    registry: () => registry,
    here,
    compose,
    copyLink: (place) => {
      void linkTo(place).then((link) => window.perf.copy(link));
    },
  }),
  here,
});
registry.tab(tab);
listen(window, registry);

view = createDiffView(
  root,
  { files: pull.files.map(diffFile), layout: 'split', vimKeys: registry.vimKeys(), nonce },
  {
    cursor() {},
    mode() {},
    file() {},
    jumped: (from) => registry.history.record({ view: 'diff', at: from }),
    load: (id) => {
      const index = indexOf.get(id);
      if (index === undefined) return;
      markLoad(index, 'asked');
      window.perf.load(index).then(
        (loaded) => {
          opened().setLines(id, { old: lines(loaded.old), new: lines(loaded.new) });
          markLoad(index, 'lines');
        },
        () => opened().loadFailed(id),
      );
    },
    menu() {},
  },
);
threads.show(view);
marks.view = now();
/** The file at the top: the first with lines to show. */
const first = pull.files.findIndex((file) => !file.skipped);
marks.first = first;
// A file with gaps shows GitHub's diff at once, as the diff feature does before the local copy.
for (const file of pull.files) {
  if (!file.gaps) continue;
  const shown = placeholders(file);
  view.setDiff(file.path, diffText(textOf(shown.old), textOf(shown.new)));
}
// Going back or forward reveals the place, and takes focus there.
registry.history.register(tab, 'diff', (at) => {
  if (!opened().reveal(at)) return false;
  opened().focus();
  return true;
});

function opened(): DiffView {
  if (!view) throw new Error("The diff view isn't open yet.");
  return view;
}

/** Where the tab is, for history: the cursor's line. */
function here(): Entry | undefined {
  return view && { view: 'diff', at: view.keyState().target };
}

function diffFile(file: PullFile): DiffFile {
  const change =
    file.status === 'added' ? 'added' : file.status === 'removed' ? 'deleted' : 'modified';
  const shown: DiffFile = {
    id: file.path,
    path: file.path,
    change,
    header: { additions: file.additions, deletions: file.deletions },
  };
  if (file.previousPath !== undefined) shown.previousPath = file.previousPath;
  if (file.skipped === 'binary') shown.skip = 'binary';
  else if (file.skipped === 'too-large') shown.skip = 'large';
  else if (file.gaps) {
    shown.lines = placeholders(file);
    shown.gaps = file.gaps;
  } else shown.lines = { old: lines(file.old), new: lines(file.new) };
  return shown;
}

/** A file's lines with those in its gaps blank, as GitHub's diff leaves them out. */
function placeholders(file: PullFile): { old: string[]; new: string[] } {
  const gaps = file.gaps ?? [];
  const blank = (side: 'old' | 'new', text: string | undefined): string[] =>
    lines(text).map((line, index) =>
      gaps.some((gap) => gap.side === side && gap.from <= index + 1 && index + 1 <= gap.to)
        ? ''
        : line,
    );
  return { old: blank('old', file.old), new: blank('new', file.new) };
}

/** The text of `lines`, each ended with a line break, so blank lines at the end count. */
function textOf(each: readonly string[]): string | undefined {
  return each.length === 0 ? undefined : `${each.join('\n')}\n`;
}

function lines(text: string | undefined): string[] {
  return text === undefined ? [] : splitLines(text);
}

/**
 * The pull request's threads, one under a line: the line's last. Their comments are made up to
 * their recorded lengths.
 */
function threadsOf(shown: PullReply['pull']): void {
  shown.threads.forEach((thread) => {
    const at: Place = { file: ids[thread.file]!, side: thread.side, line: thread.line };
    const comments: Comment[] = thread.comments.map((length, number) => ({
      author: number === 0 ? 'reviewer' : 'author',
      body: fillerText(length, number),
    }));
    threads.put(at, comments);
  });
}

function placeKey(place: Place): string {
  return `${place.file}:${place.side}:${place.line}`;
}

/** A comment box at a line, or under the last of the lines `v` selected, with its draft. */
function compose(at: Place | Span): Composer {
  const place: Place = 'line' in at ? at : { ...at, line: Math.max(at.from, at.to) };
  const key = placeKey(place);
  const box: Composer = opened().compose(at, drafts.get(key) ?? '', {
    change() {},
    submit() {
      // The comment joins the line's thread, or starts one, and goes nowhere else.
      threads.add(place, { author: 'you', body: box.text.trim() });
      drafts.delete(key);
      threads.show(opened());
      box.close();
    },
    close(keep) {
      if (keep) drafts.set(key, box.text);
      else drafts.delete(key);
    },
  });
  return box;
}

/** GitHub's link to a line in the pull request's diff: the file's path hashed, and L or R. */
async function linkTo(place: Place): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(place.file));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
  const side = place.side === 'old' ? 'L' : 'R';
  return `https://github.com/${pull.repo}/pull/${pull.number}/files#diff-${hash.join('')}${side}${place.line}`;
}

/** The local copy's files waiting for the test to say they come. */
const copies: (() => void)[] = [];

// For the measurements and the key spec, which drive the page from outside; for the copy spec,
// which says when the local copy comes, and hears how many of its files are waiting; and for the
// marks spec, which hands the view an overview's markers, and opens and closes their notes, when
// it likes.
Object.assign(window, {
  diffView: view.probe,
  perfCopy: () => {
    const waiting = copies.splice(0);
    for (const copy of waiting) copy();
    return waiting.length;
  },
  perfOverview: (given: readonly Mark[]) => opened().setMarks(given),
  perfThread: (at: Place, comments: readonly Comment[]) => {
    threads.put(at, comments);
    threads.show(opened());
  },
  perfOpenNote: (at: Place) => opened().openNote(at),
  perfCloseNote: () => opened().closeNote(),
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data !== 'perf:port') return;
  const [port] = event.ports;
  if (!port) return;
  port.addEventListener('message', ({ data }: MessageEvent<Result>) => {
    if (data.type === 'file') {
      const id = ids[data.index]!;
      const file = pull.files[data.index];
      if (file?.gaps) {
        // The local copy comes later, and takes the place of GitHub's diff: its lines, its diff,
        // then its highlighting.
        const copy = () => {
          opened().setLines(id, { old: lines(file.old), new: lines(file.new) }, data.diff);
          for (const side of ['old', 'new'] as const) {
            const triples = data.tokens[side];
            if (triples) opened().setTokens(id, side, triples);
          }
        };
        if (pull.copyWhenAsked) copies.push(copy);
        else setTimeout(copy, 0);
        return;
      }
      // The highlighting first, so the file is drawn once, with its diff.
      for (const side of ['old', 'new'] as const) {
        const triples = data.tokens[side];
        if (triples) opened().setTokens(id, side, triples);
      }
      opened().setDiff(id, data.diff);
      if (data.index === first) markFirst();
      markLoad(data.index, 'diff');
    } else if (data.type === 'moves') {
      // The moves come last: everything has arrived.
      // The background process names files by their places in the pull request.
      opened().setMoves(
        data.moves.map((move) => ({
          from: { file: ids[move.from.file]!, first: move.from.first, last: move.from.last },
          to: { file: ids[move.to.file]!, first: move.to.first, last: move.to.last },
          words: move.words,
        })),
      );
      markLoaded();
      Object.assign(window, { diffLoaded: true });
    }
  });
  port.start();
});
window.perf.connect();
