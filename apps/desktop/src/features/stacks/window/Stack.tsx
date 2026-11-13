// The stack, at the top of a pull request's tab's left panel, above the files: its tree, a row a
// layer, with each layer's review, checks, place in the merge queue, overview and viewed count, the
// offer to make the chain a GitHub stack while Lo could, and what Lo couldn't read. Nothing shows
// while there's no stack, and nothing holds its place while Lo looks for one.

import {
  Button,
  Callout,
  Key,
  StackTree,
  type StackChecks,
  type StackOverview,
  type StackReview,
  type StackTreeFound,
  type StackTreeLayer,
} from '@lo/ui';
import { keyLabels, setScopeSource } from '@lo/ui/commands';
import { useCallback, useEffect, useRef, type MouseEvent } from 'react';

import { currentMenu, openMenu } from '../../../window/commands/menus.tsx';
import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useOverviewMark, type OverviewMark } from '../../overview/window/shared.ts';
import { useViewedMarks } from '../../revisions/window/shared.ts';
import {
  useChangedFiles,
  useTabState,
  withoutBidi,
  type Files,
  type PullTab,
} from '../../tab/window/shared.ts';
import type { Checks, Found, Review, Row } from '../contract.ts';
import { makeStack } from './actions.ts';
import { catchUp, focused, keyboardLayer, stacks } from './layers.ts';
import { showTarget, stackTarget, takeRefocus } from './walk.ts';

const REVIEWS: Readonly<Record<Review, StackReview>> = {
  approved: 'approved',
  changesRequested: 'changes',
  reviewRequired: 'required',
};

const CHECKS: Readonly<Record<Checks, StackChecks>> = {
  passing: 'passing',
  running: 'running',
  failing: 'failing',
};

const FOUND: Readonly<Record<Found, StackTreeFound>> = {
  github: 'github',
  baseBranch: 'base',
  sharedCommits: 'commits',
  both: 'both',
};

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** What the layer on screen's viewed count says: from its tab's files, as `e` marks them. */
export interface OnScreen {
  readonly count: { readonly viewed: number; readonly total: number } | undefined;
  /** Its files as GitHub listed them, which may be fewer than it changes. */
  readonly files: Files | undefined;
  readonly overview: OverviewMark | undefined;
}

/**
 * `row` as the tree draws it: its text without what would turn its direction around, and the layer
 * on screen's overview and viewed count from its tab, which change as it's read.
 */
export function layerOf(row: Row, onScreen: OnScreen): StackTreeLayer {
  const { viewed } = row;
  return {
    key: String(row.number),
    number: row.number,
    title: withoutBidi(row.title),
    state: row.state,
    author: row.author === null ? undefined : withoutBidi(row.author),
    review: row.review === null ? undefined : REVIEWS[row.review],
    checks: row.checks === null ? undefined : CHECKS[row.checks],
    queue: row.queue ?? undefined,
    needsRebase: row.needsRebase,
    overview: row.current ? onScreen.overview : overviewOf(row.overview),
    viewed: row.current
      ? onScreen.count && {
          viewed: onScreen.count.viewed,
          total: onScreen.count.total,
          partial: (onScreen.files?.files.length ?? 0) < onScreen.count.total,
        }
      : viewed?.source === 'layers'
        ? { viewed: viewed.viewed, total: viewed.files, partial: !viewed.complete }
        : undefined,
    branch: row.branch,
    sitsOn: row.on ?? undefined,
  };
}

/** A layer's overview, from the read of its repository's: none for one from a fork, or unread. */
function overviewOf(has: boolean | null): StackOverview | undefined {
  if (has === null) return undefined;
  return has ? 'current' : 'none';
}

/** The stack the view `tab` of a pull request's tab is in, if it's in one. */
export function Stack({ tab }: { tab: PullTab }) {
  // Key caps follow the keymap file.
  useKeys();
  const view = useTabState(stacks, tab.id);
  const keyboard = useTabState(focused, tab.id);
  const overview = useOverviewMark(tab.id);
  const count = useViewedMarks(tab.id).count;
  const files = useChangedFiles(tab.id);

  useEffect(() => {
    if (stacks.get(tab.id) === undefined) catchUp(tab.id);
  }, [tab.id]);

  // Keys in the tree act on the layer the keyboard is on. A layer shown from the tree keeps the
  // keyboard in it, once its view's tree is drawn.
  const element = useRef<HTMLDivElement | null>(null);
  const stop = useRef<(() => void) | undefined>(undefined);
  const wanted = useRef(false);
  const take = useCallback(() => {
    const tree = element.current;
    if (!wanted.current || !tree) return;
    wanted.current = false;
    focused.set(tab.id, tab.number);
    tree.focus({ preventScroll: true });
  }, [tab]);
  const treeRef = useCallback(
    (tree: HTMLDivElement | null) => {
      element.current = tree;
      stop.current?.();
      stop.current = tree ? setScopeSource(tree, { target: () => stackTarget(tab) }) : undefined;
      take();
    },
    [tab, take],
  );
  useEffect(() => {
    wanted.current = takeRefocus();
    take();
    return () => {
      wanted.current = false;
    };
  }, [take]);

  if (view?.kind !== 'stack') return null;
  const onScreen = { count, files, overview };
  const current = view.rows.find((row) => row.current);
  const on = keyboardLayer(view, keyboard, tab.number);
  const convert = keyOf('stacks.convert');
  return (
    <div className="flex max-h-1/2 min-h-0 flex-none flex-col" data-lo-stack={tab.id}>
      <StackTree
        layers={view.rows.map((row) => layerOf(row, onScreen))}
        root={withoutBidi(view.root)}
        found={view.found === null ? undefined : FOUND[view.found]}
        focused={on === undefined ? undefined : String(on)}
        current={current === undefined ? undefined : String(current.number)}
        onShow={(key) => showTarget({ kind: 'layer', layer: Number(key) })}
        onMenu={(key, event: MouseEvent<HTMLElement>) => {
          // The browser's own event for the key that opened a menu, which is open.
          if (currentMenu() !== undefined) {
            event.preventDefault();
            return;
          }
          const layer = Number(key);
          focused.set(tab.id, layer);
          if (openMenu({ kind: 'layer', layer }, { x: event.clientX, y: event.clientY })) {
            event.preventDefault();
          }
        }}
        callout={
          view.callout === null ? undefined : (
            <Callout tone="info">
              <p>{view.callout}</p>
              <div className="mt-8">
                <Button size="sm" onClick={() => makeStack(tab.id, tab.number)}>
                  Make this a GitHub stack…
                  {convert && <Key keys={convert} decorative />}
                </Button>
              </div>
            </Callout>
          )
        }
        notes={view.notes.map((note, index) => ({
          key: `${note.kind}-${index}`,
          text: withoutBidi(note.text),
        }))}
        treeRef={treeRef}
        data-lo-scope="stack"
      />
    </div>
  );
}
