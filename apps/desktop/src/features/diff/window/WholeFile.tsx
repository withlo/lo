// The whole-file view, one of a pull request's tab's middle views: one file, read-only, from the
// local copy, in `@lo/ui/code`'s whole-file view, under a bar that names the file and the commit
// it's at, with the way back. A file that isn't text, or is too large, shows a note in place of its
// lines, and one larger than Lo loads at once loads when asked. It opens from the diff (`gf`), the
// tree and the file finder, and `⌃o` goes back through the tab's history to where it was opened
// from. Keys in it act on the cursor's line, or on the file while it shows a note.

import { sizeText } from '@lo/review';
import { Button, Key, Spinner, Tag } from '@lo/ui';
import { keyLabels, NO_TARGET, setScopeSource, type Target } from '@lo/ui/commands';
import { createFileView, type FileView } from '@lo/ui/code';
import { useEffect, useRef, type ReactNode } from 'react';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { tabState, useLocalCopy, useTabState, type PullTab } from '../../tab/window/shared.ts';
import type { TreePath } from '../../tree/contract.ts';
import { followFile } from '../../tree/window/shared.ts';
import type { FileVersions, Version } from '../contract.ts';
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
  readOf,
  reads,
  readWhole,
  setWholeDrawn,
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

/** The file's header, which keys act on while it shows no lines. */
function headerOf(open: Opened): Target {
  return { kind: 'header', file: open.id, side: open.version };
}

/**
 * Whether focus is nowhere in particular, on the view itself, or left behind in a middle view now
 * hidden, so the code can take it.
 */
function focusIsFree(own: HTMLElement | null): boolean {
  const focused = document.activeElement;
  return (
    !focused ||
    focused === document.body ||
    focused === own ||
    focused.hasAttribute('data-lo-middle') ||
    focused.closest('[inert]') !== null
  );
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
  const copyReady = local?.kind === 'ready' && local.head === head;
  const change = open && changedIn(state?.files, open.key);
  const path = open && pathIn(change, open.version, () => open.path);
  const content = open && head !== undefined && readOf(read, open, head) ? read.content : undefined;
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

  // Read anew for another file, version or head; again once the local copy has the head, and
  // after a failure when the file is asked for again.
  useEffect(() => {
    const filePath = latest.current.path;
    if (!open || head === undefined || !filePath) return;
    const now = reads.get(tab.id);
    if (readOf(now, open, head)) {
      const again = (now.content.kind === 'waiting' && copyReady) || now.content.kind === 'failed';
      if (!again) return;
    }
    const large = readOf(now, open, head) && now.large;
    readWhole(tab.id, { ...open, path: filePath }, head, large, wholeWork(tab.id));
  }, [tab.id, open, head, copyReady]);

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
        vimKeys: keys.vimKeys(),
        nonce: page.nonce,
      },
      {
        cursor() {},
        mode() {},
        jumped: (from) => keys.history.record({ view: 'file', at: from }),
        menu: (target, x, y) => {
          openMenu(target, { x, y });
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

  // Each ask answered once, while the view is on screen: its place, and focus when it asks for it
  // or focus is free. Without code to show, the view's note takes focus in its place. Shown again
  // with nothing new asked, as after `` ` ``, it takes focus that's free.
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
      if (open.ask.at) made.reveal(open.ask.at);
      if (open.ask.focus || focusIsFree(scope.current)) made.focus();
      return;
    }
    if ((fresh && open.ask.focus) || focusIsFree(scope.current)) scope.current?.focus();
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
  if (change === undefined) return 'Unchanged in this pull request';
  return version === 'old' ? 'Before this pull request' : 'Changed in this pull request';
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
  return (
    <div className="flex h-file-header-h flex-none items-center gap-8 border-b border-border-subtle bg-diff-file-header-bg px-8 whitespace-nowrap text-fg-muted text-small">
      <Button size="sm" onClick={() => registry().run('keys.back', NO_TARGET)}>
        <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M9.5 4 5.5 8l4 4" />
        </svg>
        Back
        <KeyFor id="keys.back" />
      </Button>
      <span className="lo-path lo-selectable" title={text}>
        {text.slice(0, slash + 1)}
        <b>{text.slice(slash + 1)}</b>
      </span>
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
  open,
  content,
  waiting,
  path,
}: {
  open: Opened | undefined;
  content: Content | undefined;
  waiting: 'opening' | 'copy';
  path: TreePath | undefined;
}) {
  if (!open || !path) {
    return (
      <Said title="No file is open whole">
        <KeyFor id="diff.wholeFile" /> on a line of the diff opens its file here, at that line. So
        does a file the pull request leaves alone, chosen in the tree or the file finder.
      </Said>
    );
  }
  const header = headerOf(open);
  const github = (
    <Button onClick={() => registry().run('diff.openOnGithub', header)}>
      Open on GitHub
      <KeyFor id="diff.openOnGithub" />
    </Button>
  );
  switch (content?.kind) {
    case undefined:
    case 'reading':
      if (waiting === 'opening') return <Said>Opening the pull request…</Said>;
      return (
        <Said>
          <span className="inline-flex items-center gap-8">
            <Spinner size="xs" />
            Reading the file…
          </span>
        </Said>
      );
    case 'waiting':
      return <Said>The whole file opens once the local copy is ready.</Said>;
    case 'text':
      return null;
    case 'large':
      return (
        <Said
          title={`This file is ${sizeText(content.size)}`}
          actions={
            <>
              <Button variant="primary" onClick={() => registry().run('diff.loadWhole', header)}>
                Load it anyway
                <KeyFor id="diff.loadWhole" className="text-on-accent" />
              </Button>
              {github}
            </>
          }
        >
          Lo loads files up to 1 MiB at once. This one may take a while to load and to scroll.
        </Said>
      );
    case 'binary':
      return (
        <Said title="This file isn’t text" actions={github}>
          It’s {sizeText(content.size)} of binary data, which Lo doesn’t show.
        </Said>
      );
    case 'refused':
      return (
        <Said title="Lo doesn’t show this file" actions={github}>
          {sentence(content.why)}
        </Said>
      );
    case 'failed':
      return (
        <Said title="Lo couldn’t read this file" actions={github}>
          {content.why}
        </Said>
      );
    default:
      content satisfies never;
      return null;
  }
}

/** `text` as a sentence: its first letter capital, and a full stop at its end. */
function sentence(text: string): string {
  const capital = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** A note in the middle of the view, with what can be done about it. */
function Said({
  title,
  actions,
  children,
}: {
  title?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-32 text-center">
      <div className="flex max-w-read-measure flex-col items-center gap-12">
        {title && <h2 className="m-0 text-fg text-title">{title}</h2>}
        <p className="m-0 text-fg-muted text-ui">{children}</p>
        {actions && <div className="flex flex-wrap justify-center gap-8">{actions}</div>}
      </div>
    </div>
  );
}
