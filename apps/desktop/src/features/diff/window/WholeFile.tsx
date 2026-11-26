// The whole-file view, one of a pull request's tab's middle views: one file, read-only, from the
// local copy, in `@lo/ui/code`'s whole-file view, under a bar that names the file and the commit
// it's at, with the way back. A file that isn't text, or is too large, shows a note in place of its
// lines, and one larger than Lo loads at once loads when asked. It opens from the diff (`gf`), the
// tree and the file finder, and `⌃o` goes back through the tab's history to where it was opened
// from. Keys in it act on the cursor's line, or on the file while it shows a note.

import {
  Button,
  bytes,
  EmptyState,
  Icon,
  Key,
  Loading,
  Problem,
  Tag,
  Tooltip,
  useControl,
  type ProblemAction,
} from '@lo/ui';
import { keyLabels, NO_TARGET, setScopeSource, type Target } from '@lo/ui/commands';
import { createFileView, type FileView, type Mark } from '@lo/ui/code';
import { useEffect, useRef, type ReactNode } from 'react';

import { openMenu } from '../../../window/commands/menus.tsx';
import { inCodeOf, registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import {
  besideNow,
  focusNowhere,
  focusNowhereFor,
  MiddlePlaceholder,
  tabState,
  useLocalCopy,
  usePull,
  useTabState,
  type PullTab,
} from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import { followFile } from '../../tree/window/shared.ts';
import type { FileVersions, Version, WholeRefusal } from '../contract.ts';
import { hintsShown, restedIn } from './code.ts';
import { shownPath } from './files.ts';
import { usePage } from './page.ts';
import { placesFor } from './places.ts';
import { loaderOf, useSnapshot } from './tabs.ts';
import {
  changedIn,
  type Content,
  opened,
  type Opened,
  pathIn,
  readAgain,
  readOf,
  reads,
  readWhole,
  setWholeDrawn,
  tooLargeReason,
  wholeWork,
} from './whole.ts';

declare global {
  interface Window {
    /**
     * The whole-file view on screen, for the smoke test, in a build run from source: the file it
     * has open, what it shows of it, and where its cursor is.
     */
    loWhole?:
      | {
          file(): { id: string; path: string; version: Version } | undefined;
          content(): Content['kind'] | undefined;
          cursor(): Target | undefined;
        }
      | undefined;
  }
}

/** Where each tab's whole file's cursor was when its view last went, to come back to. */
const cursors = tabState<{ key: string; version: Version; at: Target } | undefined>(
  () => undefined,
);

/** The last ask each tab's view answered, so it answers each once. */
const answered = tabState<number>(() => 0);

/**
 * The marks for lines `marked` picks out in file `id`'s `version`, if any, with code features'
 * inline hints.
 */
function marksOf(
  id: string,
  version: Version,
  marked: Opened['marked'],
  hints: readonly Mark[] = [],
): Mark[] {
  const lines: Mark[] = marked
    ? [{ kind: 'lines', at: { file: id, side: version, ...marked } }]
    : [];
  return [...lines, ...hints];
}

/** The file's header, which keys act on while it shows no lines. */
function headerOf(open: Opened): Target {
  return { kind: 'header', file: open.id, side: open.version };
}

/**
 * Whether focus is on the view itself, or nowhere in particular for it, so the code can take it.
 */
function focusIsFree(own: HTMLElement | null): boolean {
  return (own !== null && document.activeElement === own) || focusNowhereFor(own);
}

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** A key cap for `id`'s first key, if it has one. */
function KeyFor({ id, className }: { id: string; className?: string }) {
  const keys = keyOf(id);
  return keys ? <Key keys={keys} decorative className={className} /> : null;
}

/**
 * A pull request's tab's whole-file view. While another middle view is on screen it stays drawn,
 * hidden, so coming back to it finds the file as it was.
 */
export function WholeFile({ tab, shown }: { tab: PullTab; shown: boolean }) {
  useKeys();
  const open = useTabState(opened, tab.id);
  const read = useTabState(reads, tab.id);
  const loader = loaderOf(tab.id);
  const { state } = useSnapshot(loader);
  const local = useLocalCopy(tab.id);
  const page = usePage();
  const head = state?.at ?? undefined;
  // A stack's layer's base side starts where its diff does.
  const from = state?.compareFrom ?? null;
  const copyReady = local?.kind === 'ready' && local.head === head;
  const change = open && changedIn(state?.files, open.key);
  const path = open && pathIn(change, open.version, () => open.path);
  const hints = useTabState(hintsShown, tab.id, (each) => each.file);
  const content =
    open && head !== undefined && readOf(read, open, head, from) ? read.content : undefined;
  const lines = content?.kind === 'text' ? content.lines : undefined;
  const tokens = content?.kind === 'text' ? content.tokens : undefined;

  const scope = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<FileView>(undefined);
  // What a new code view is made with, read as it's made.
  const latest = useRef({ path, tokens, shown });
  latest.current = { path, tokens, shown };

  // The tab's places in the diff and here, for `⌃o` and `⌃i`.
  useEffect(() => placesFor(tab.id), [tab.id]);

  // The tree marks the file on screen.
  const key = open?.key;
  useEffect(() => {
    if (shown && key !== undefined) followFile(tab.id, key);
  }, [tab.id, key, shown]);

  // Read anew for another file, version, head or start; again once the local copy has the head,
  // and after a failure when the file is asked for again.
  useEffect(() => {
    const filePath = latest.current.path;
    if (!open || head === undefined || !filePath) return;
    const now = reads.get(tab.id);
    if (readOf(now, open, head, from)) {
      const again = (now.content.kind === 'waiting' && copyReady) || now.content.kind === 'failed';
      if (!again) return;
    }
    const large = readOf(now, open, head, from) && now.large;
    readWhole(tab.id, { ...open, path: filePath }, head, from, large, wholeWork(tab.id));
  }, [tab.id, open, head, from, copyReady]);

  // What keys act on while there's no code to act on.
  useEffect(() => {
    const element = scope.current;
    if (!element) return undefined;
    return setScopeSource(element, {
      target: () => {
        const now = opened.get(tab.id);
        return now ? headerOf(now) : NO_TARGET;
      },
    });
  }, [tab.id]);

  // While it's on screen, the middle view, for `Esc` and history, and the keys' whole file.
  useEffect(() => {
    if (!shown) return undefined;
    const element = scope.current;
    const stops = [
      setMiddle({
        focus: () => (view.current ? view.current.focus() : element?.focus()),
        root: () => element,
        holds: (focused) =>
          view.current
            ? (element?.contains(focused) ?? false) && inCodeOf(focused, 'file')
            : focused === element,
        here: () => {
          const now = opened.get(tab.id);
          if (!now) return undefined;
          return { view: 'file', at: view.current?.keyState().target ?? headerOf(now) };
        },
      }),
      setWholeDrawn(tab.id, () => view.current),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [tab.id, shown]);

  // The code, once its lines are read.
  const id = open?.id;
  const version = open?.version;
  const marked = open?.marked;
  useEffect(() => {
    const parent = box.current;
    const filePath = latest.current.path;
    if (
      !parent ||
      !lines ||
      !page ||
      id === undefined ||
      !version ||
      !filePath ||
      key === undefined
    ) {
      return undefined;
    }
    const keys = registry();
    const made = createFileView(
      parent,
      {
        id,
        path: shownPath(filePath.text),
        side: version,
        lines,
        tokens: latest.current.tokens,
        marks: marksOf(id, version, opened.get(tab.id)?.marked, hintsShown.get(tab.id).file),
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      {
        cursor() {},
        mode() {},
        jumped: (left) => keys.history.record({ view: 'file', at: left }),
        menu: (target, x, y) => {
          openMenu(target, { x, y });
        },
        // For a type hover, while the file is on screen.
        rested: (at) => {
          if (latest.current.shown || at === undefined) restedIn(tab.id, 'file', at);
        },
      },
    );
    view.current = made;
    const stop = keys.subscribe(() => made.setVimKeys(keys.vimKeys()));
    // Shown again without a new ask, as after `` ` ``: back where its cursor was.
    const before = cursors.get(tab.id);
    const asked = opened.get(tab.id)?.ask.count;
    if (answered.get(tab.id) === asked && before?.key === key && before.version === version) {
      made.reveal(before.at);
    }
    if (latest.current.shown && focusIsFree(scope.current)) made.focus();
    return () => {
      cursors.set(tab.id, { key, version, at: made.keyState().target });
      stop();
      view.current = undefined;
      made.destroy();
    };
  }, [tab.id, lines, page, id, version, key]);

  useEffect(() => {
    if (tokens) view.current?.setTokens(tokens);
  }, [tokens]);

  // The lines picked out, which another ask for the same file can change, and the hints.
  useEffect(() => {
    if (id === undefined || !version) return;
    view.current?.setMarks(marksOf(id, version, marked, hints));
  }, [id, version, marked, hints]);

  // Each ask answered once, while the view is on screen: its place, and focus when it asks for it
  // or focus is free. Without code to show, the view's note takes focus in its place. While the
  // file's still read there's neither: focus waits in the middle of the window, nowhere in
  // particular, so keys typed meanwhile go on in the code once it's drawn and takes focus. Shown
  // again with nothing new asked, as after `` ` ``, it takes focus that's free.
  const settled = content !== undefined && content.kind !== 'reading' && content.kind !== 'waiting';
  useEffect(() => {
    if (!shown) return;
    const fresh = open !== undefined && answered.get(tab.id) !== open.ask.count;
    const made = view.current;
    if (made) {
      if (!open || !fresh) {
        if (focusIsFree(scope.current)) made.focus();
        return;
      }
      answered.set(tab.id, open.ask.count);
      if (open.ask.at) {
        made.reveal(open.ask.at);
        // In the code's place beside a reading view, as a link or a follow brought it.
        if (besideNow()) made.land(open.ask.at);
      }
      if (open.ask.focus || focusIsFree(scope.current)) made.focus();
      return;
    }
    if ((fresh && open.ask.focus) || focusIsFree(scope.current)) {
      if (settled || !open) scope.current?.focus();
      else focusNowhere();
    }
    if (open && fresh && settled) answered.set(tab.id, open.ask.count);
  }, [tab.id, open, lines, settled, shown]);

  // Readings for the smoke test, in a build run from source, while it's on screen.
  useEffect(() => {
    if (!page || page.packaged || !shown) return undefined;
    const testing: NonNullable<Window['loWhole']> = {
      file() {
        const now = opened.get(tab.id);
        const filePath = latest.current.path;
        return now && filePath && { id: now.id, path: filePath.text, version: now.version };
      },
      content: () => reads.get(tab.id)?.content.kind,
      cursor: () => view.current?.keyState().target,
    };
    window.loWhole = testing;
    return () => {
      if (window.loWhole === testing) window.loWhole = undefined;
    };
  }, [tab.id, page, shown]);

  return (
    <div
      ref={scope}
      tabIndex={-1}
      data-lo-scope="file"
      data-lo-whole={tab.id}
      className="flex h-full min-h-0 flex-col bg-bg focus-visible:shadow-none"
    >
      {open && path && (
        <Bar
          open={open}
          path={path}
          change={change}
          commit={open.version === 'new' ? head : local?.kind === 'ready' ? local.mergeBase : null}
        />
      )}
      {lines ? (
        <div ref={box} className="min-h-0 flex-1" />
      ) : (
        <Note
          tab={tab}
          open={open}
          content={content}
          waiting={head === undefined ? 'opening' : 'copy'}
          path={path}
        />
      )}
    </div>
  );
}

/** A commit's id, short. */
function short(commit: string): string {
  return commit.slice(0, 7);
}

/** What the bar says the file is to the pull request. */
function tagOf(change: FileVersions | undefined, version: Version): string {
  if (change === undefined) return 'Unchanged';
  return version === 'old' ? 'Before changes' : 'Changed';
}

/**
 * The bar over the file: the way back, the file's path, its commit, and what it is to the pull
 * request.
 */
function Bar({
  open,
  path,
  change,
  commit,
}: {
  open: Opened;
  path: TreePath;
  change: FileVersions | undefined;
  commit: string | null | undefined;
}) {
  const header = headerOf(open);
  const text = shownPath(path.text);
  const slash = text.lastIndexOf('/');
  // Back's control: dimmed while there's nowhere to go.
  const back = useControl('keys.back');
  return (
    <div className="flex h-file-header-h flex-none items-center gap-8 border-b border-border-subtle bg-diff-file-header-bg px-8 whitespace-nowrap text-fg-muted text-small">
      <Button
        size="sm"
        disabled={back?.off !== undefined}
        hint={back?.off ?? null}
        onClick={() => registry().run('keys.back', NO_TARGET)}
      >
        <Icon name="chevron-left" size={12} />
        Back
        <KeyFor id="keys.back" />
      </Button>
      <Tooltip label={text} cut>
        <span className="lo-path lo-selectable">
          {text.slice(0, slash + 1)}
          <b>{text.slice(slash + 1)}</b>
        </span>
      </Tooltip>
      {commit && (
        <span className="lo-num flex-none">
          at <span className="text-fg code-small">{short(commit)}</span>
        </span>
      )}
      <Tag>{tagOf(change, open.version)}</Tag>
      <span className="min-w-8 flex-1" />
      <Button variant="ghost" size="sm" onClick={() => registry().run('diff.copyPath', header)}>
        Copy path
        <KeyFor id="diff.copyPath" />
      </Button>
      <Button variant="ghost" size="sm" onClick={() => registry().run('diff.openOnGithub', header)}>
        Open on GitHub
        <KeyFor id="diff.openOnGithub" />
      </Button>
    </div>
  );
}

/** What shows in place of the file's lines: why there are none, or none yet. */
function Note({
  tab,
  open,
  content,
  waiting,
  path,
}: {
  tab: PullTab;
  open: Opened | undefined;
  content: Content | undefined;
  waiting: 'opening' | 'copy';
  path: TreePath | undefined;
}) {
  if (!open || !path) {
    return <EmptyState icon="file-code" title="No whole file open" actions={['tree.find']} />;
  }
  const header = headerOf(open);
  const github: ProblemAction = {
    label: 'Open on GitHub',
    keys: keyOf('diff.openOnGithub'),
    onClick: () => registry().run('diff.openOnGithub', header),
  };
  switch (content?.kind) {
    case undefined:
    case 'reading':
      // The tab's own wait, which this view carries on.
      if (waiting === 'opening') {
        return (
          <div className="min-h-0 flex-1">
            <MiddlePlaceholder tab={tab} />
          </div>
        );
      }
      return (
        <div className="min-h-0 flex-1">
          <Loading status="Reading file…" />
        </div>
      );
    case 'waiting':
      return (
        <div className="min-h-0 flex-1">
          <Loading status="Fetching local copy…" />
        </div>
      );
    case 'text':
      return null;
    case 'large':
      return (
        <EmptyState
          icon="file-code"
          title={`${bytes(content.size)} file`}
          actions={[
            { command: 'diff.loadWhole', target: header },
            { command: 'diff.openOnGithub', target: header },
          ]}
        />
      );
    case 'binary':
      return <CantShow reason={`It’s a binary file, ${bytes(content.size)}.`} action={github} />;
    case 'tooLarge':
      return <CantShow reason={tooLargeReason(content.why)} action={github} />;
    case 'refused':
      return <CantShow reason={<Refused refusal={content} tab={tab} />} action={github} />;
    case 'failed':
      return (
        <CantShow
          reason={content.why}
          action={{
            label: 'Try again',
            onClick: () => readAgain(tab.id, path, wholeWork(tab.id)),
          }}
          others={[github]}
        />
      );
    default:
      content satisfies never;
      return null;
  }
}

/** Why the file can't be shown whole, in place of its lines, with what can be done about it. */
function CantShow({
  reason,
  action,
  others,
}: {
  reason: ReactNode;
  action: ProblemAction;
  others?: readonly ProblemAction[];
}) {
  return (
    <div className="min-h-0 flex-1">
      <Problem
        layout="view"
        title="Can’t show this file"
        reason={reason}
        action={action}
        others={others}
      />
    </div>
  );
}

/** Why Lo won't show a file whole, besides its size: the base branch by name, as code. */
function Refused({ refusal, tab }: { refusal: WholeRefusal; tab: PullTab }) {
  const base = usePull(tab.id)?.header?.base.branch;
  switch (refusal.why) {
    case 'compared':
      return `The changes are over the ${bytes(refusal.limit)} limit.`;
    case 'unrelated':
      return base === undefined ? (
        'This pull request shares no history with its base branch.'
      ) : (
        <>
          This pull request shares no history with <code>{base}</code>.
        </>
      );
    case 'submodule':
      return 'It’s a submodule.';
    case 'unchanged':
      return 'This pull request doesn’t change it.';
    case 'missing':
      return 'It isn’t in this revision.';
    case 'notInBase':
      return base === undefined ? (
        'It isn’t in the base branch.'
      ) : (
        <>
          It isn’t in <code>{base}</code>.
        </>
      );
    default:
      throw new Error(`A refusal Lo doesn’t know: ${JSON.stringify(refusal satisfies never)}`);
  }
}
