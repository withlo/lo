// The diff, the middle of a pull request's tab: every changed file in one scroll, in the left
// panel's order, drawn by `@lo/ui/code`'s view once each file that shows its lines has them. A new
// order is a new view, which comes back to where the cursor was. What arrives after it's drawn
// goes into the view in place: a large file asked for, the local copy's diff swapped for GitHub's,
// the moves. The tree follows the file on screen, and asks the diff to show the files it picks.

import { createDiffView, type DiffView, type Probe, type Target } from '@lo/ui/code';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { openMenu } from '../../../window/commands/menus.tsx';
import { registry, setMiddle } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import { useSetting } from '../../settings/window/shared.ts';
import { tabState, usePull, type PullTab } from '../../tab/window/shared.ts';
import { followFile, onShowFile, useFileOrder } from '../../tree/window/shared.ts';
import { layout as layoutSetting, whitespace as whitespaceSetting } from '../settings.ts';
import { diffFileOf, headerOf, inOrder, viewKey } from './files.ts';
import type { Entry, Loader, Snapshot } from './loader.ts';
import { main } from './main.ts';
import { loaderOf, setDrawn } from './tabs.ts';

declare global {
  interface Window {
    /**
     * The diff on screen, for the smoke test, in a build run from source: its readings, and its
     * files' ids and paths, in the order it shows them.
     */
    loDiff?: { probe: Probe; files: { id: string; path: string }[] } | undefined;
  }
}

/** Where each tab's cursor was when its view last went, to come back to. */
const cursors = tabState<Target | undefined>(() => undefined);

let page: Promise<{ nonce: string; packaged: boolean }> | undefined;

/**
 * The nonce in the page's content security policy, which the view's style elements carry, from
 * `app.info`, once per page load, and whether Lo runs as it ships.
 */
function pageInfo(): Promise<{ nonce: string; packaged: boolean }> {
  page ??= client(app)
    .info()
    .then(({ nonce, packaged: shipped }) => ({ nonce, packaged: shipped }));
  return page;
}

/** Whether Lo runs as it ships, once `app.info` has said. */
let packaged = true;

function useNonce(): string | undefined {
  const [found, setFound] = useState<string>();
  useEffect(() => {
    let live = true;
    pageInfo()
      .then((info) => {
        packaged = info.packaged;
        if (live) setFound(info.nonce);
      })
      .catch((error: unknown) => {
        console.error("Lo couldn't read the page's nonce:", error);
        if (live) setFound('');
      });
    return () => {
      live = false;
    };
  }, []);
  return found;
}

function useSnapshot(loader: Loader): Snapshot {
  const subscribe = useCallback((listener: () => void) => loader.subscribe(listener), [loader]);
  return useSyncExternalStore(subscribe, () => loader.snapshot());
}

/** A pull request's tab's diff. */
export function Diff({ tab }: { tab: PullTab }) {
  const loader = loaderOf(tab.id);
  const snapshot = useSnapshot(loader);
  const order = useFileOrder(tab.id);
  const layout = useSetting(layoutSetting);
  const whitespace = useSetting(whitespaceSetting);
  const nonceValue = useNonce();
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<Drawing>(undefined);
  useEffect(() => loader.setWhitespace(whitespace === 'show'), [loader, whitespace]);

  const { ready } = snapshot;
  const entries = useMemo(
    () => (ready ? inOrder(ready.entries, order, (key) => loader.ids.find(key)) : undefined),
    [ready, order, loader],
  );
  const key = ready && entries ? viewKey(ready.at, entries) : undefined;
  // What a new view is drawn with, read as it's drawn: a change of layout alone needs no new view.
  const latest = useRef({ entries, layout });
  latest.current = { entries, layout };

  useEffect(() => {
    const parent = box.current;
    const drawn = latest.current;
    if (!parent || nonceValue === undefined || !drawn.entries || key === undefined) {
      return undefined;
    }
    const at = key.slice(0, key.indexOf('|'));
    const made = draw({
      parent,
      tab,
      loader,
      entries: drawn.entries,
      at,
      layout: drawn.layout,
      nonce: nonceValue,
    });
    view.current = made;
    return () => {
      view.current = undefined;
      cursors.set(tab.id, made.view.keyState().target);
      made.stop();
      made.view.destroy();
    };
    // A new view only for new files, or a new order of them.
  }, [key, nonceValue]);

  useEffect(() => {
    view.current?.view.setLayout(layout);
  }, [layout]);

  // The local copy's files, taken in place of GitHub's, say more of each: their sizes, say.
  useEffect(() => {
    if (ready) view.current?.headers(ready.entries);
  }, [ready]);

  if (!ready || nonceValue === undefined) return <Waiting tab={tab} snapshot={snapshot} />;
  return <div ref={box} className="h-full min-h-0" data-lo-diff={tab.id} />;
}

/** What the middle says until the diff is drawn. */
function Waiting({ tab, snapshot }: { tab: PullTab; snapshot: Snapshot }) {
  const pull = usePull(tab.id);
  const { state, progress } = snapshot;
  let text = 'Reading what the pull request changes…';
  // Until the tab knows its head, it's still opening, or can't.
  if (!pull?.shown) text = pull?.problem ? 'Nothing to show yet.' : 'Opening the pull request…';
  else if (state?.files?.length === 0) text = 'The pull request changes no files.';
  else if (state?.problem && state.files === null) text = state.problem;
  else if (progress.of > 0) text = `Diffing the files: ${progress.done} of ${progress.of}…`;
  return (
    <div className="grid h-full place-items-center p-32 text-center text-fg-muted text-ui">
      <p className="max-w-read-measure">{text}</p>
    </div>
  );
}

/** A view drawn, and what's done with it while it's drawn. */
interface Drawing {
  readonly view: DiffView;
  /** Gives the view the headers of `entries`, where they've changed. */
  headers(entries: readonly Entry[]): void;
  /** Unhooks it, before it's destroyed. */
  stop(): void;
}

/** Draws the view of `entries`, fills in what's been worked out, and hooks it up. */
function draw(options: {
  parent: HTMLElement;
  tab: PullTab;
  loader: Loader;
  entries: readonly Entry[];
  at: string;
  layout: 'split' | 'inline';
  nonce: string;
}): Drawing {
  const { parent, tab, loader, entries, at } = options;
  const keys = registry();
  const files = entries.map((entry) => diffFileOf(entry, loader.shown(entry.id)));
  const view = createDiffView(
    parent,
    { files, layout: options.layout, vimKeys: keys.vimKeys(), nonce: options.nonce },
    {
      cursor() {},
      mode() {},
      file: (id) => followFile(tab.id, loader.ids.keyOf(id)),
      jumped: (from) => keys.history.record({ view: 'diff', at: from }),
      load: (id) => loader.load(id),
      menu: (target, x, y) => {
        openMenu(target, { x, y });
      },
    },
  );
  // Highlighting first, so each file is drawn once, with its diff.
  files.forEach((file) => {
    const shown = file.lines ? loader.shown(file.id) : undefined;
    if (!shown) return;
    for (const side of ['old', 'new'] as const) {
      const triples = shown.tokens[side];
      if (triples) view.setTokens(file.id, side, triples);
    }
    view.setDiff(file.id, shown.diff);
  });
  view.setMoves(loader.moves());
  loader.attach({
    lines(id, shown) {
      view.setLines(id, shown.lines, shown.diff);
      for (const side of ['old', 'new'] as const) {
        const triples = shown.tokens[side];
        if (triples) view.setTokens(id, side, triples);
      }
    },
    diff: (id, diff) => view.setDiff(id, diff),
    failed: (id) => view.loadFailed(id),
    moves: (moves) => view.setMoves(moves),
  });
  const stops = [
    setDrawn(tab.id, {
      view,
      loader,
      pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
    }),
    setMiddle({
      focus: () => view.focus(),
      here: () => ({ view: 'diff', at: view.keyState().target }),
    }),
    keys.history.register(tab.id, 'diff', (target) => {
      if (!view.reveal(target)) return false;
      view.focus();
      return true;
    }),
    // A changed file the tree asks for: its header comes on screen, focus staying in the tree.
    onShowFile('diff', (id, key) => {
      const file = id === tab.id ? loader.ids.find(key) : undefined;
      if (file !== undefined) view.reveal({ kind: 'file', file });
    }),
    keys.subscribe(() => view.setVimKeys(keys.vimKeys())),
  ];
  const testing = packaged
    ? undefined
    : { probe: view.probe, files: files.map(({ id, path }) => ({ id, path })) };
  if (testing) window.loDiff = testing;
  const before = cursors.get(tab.id);
  if (before) view.reveal(before);
  // Focus that's nowhere in particular comes to the diff, as it does to any middle view.
  const focused = document.activeElement;
  if (!focused || focused === document.body || focused.hasAttribute('data-lo-middle')) {
    view.focus();
  }
  // The diff at this head is on screen: it stays, until the reader loads a newer push.
  main()
    .drawn({ id: tab.id, at })
    .catch((error: unknown) => console.error("Lo couldn't say the diff was drawn:", error));
  const headers = new Map(files.map((file) => [file.id, JSON.stringify(file.header)]));
  return {
    view,
    headers(next) {
      for (const entry of next) {
        const header = headerOf(entry.versions);
        const said = JSON.stringify(header);
        if (!headers.has(entry.id) || headers.get(entry.id) === said) continue;
        headers.set(entry.id, said);
        view.setHeader(entry.id, header);
      }
    },
    stop() {
      if (testing && window.loDiff === testing) window.loDiff = undefined;
      loader.attach(undefined);
      for (const stop of stops) stop();
    },
  };
}
