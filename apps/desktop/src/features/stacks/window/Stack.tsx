// The stack, at the top of a pull request's tab's left panel, above the files: its tree, a row a
// layer, with each layer's review, checks, place in the merge queue, overview, viewed count and
// unresolved threads, the arrows that step through the layers, the offer to convert the chain to a
// GitHub stack while Lo could, and what Lo couldn't read. Layers being selected, or on screen as
// one diff, share a band, and while they're selected the tree says which layers, with a hint row
// of their keys. Nothing shows while there's no stack, and nothing holds its place while Lo looks
// for one.

import {
  Button,
  HintButton,
  Key,
  Problem,
  StackTree,
  type StackChecks,
  type StackOverview,
  type StackReview,
  type StackRun,
  type StackTreeLayer,
  type StackTreeLink,
  type StackTreeNote,
} from '@lo/ui';
import { controlOf, runControl, setScopeSource, type Target } from '@lo/ui/commands';
import { useCallback, useEffect, useRef, type MouseEvent } from 'react';

import { currentMenu, openMenu } from '../../../window/commands/menus.tsx';
import { useKeys } from '../../../window/commands/registry.ts';
import { useOverviewMark, type OverviewMark } from '../../overview/window/shared.ts';
import { useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import { useViewedCount } from '../../tree/window/shared.ts';
import type { Checks, Link, Note, Review, Row } from '../contract.ts';
import { makeStack } from './actions.ts';
import { useLayerCount } from './counts.ts';
import { catchUp, choosing, focused, keyboardLayer, runTrouble, stacks } from './layers.ts';
import { chainIn, choiceLine, type Choice } from './runs.ts';
import { showTarget, stackTarget, stopChoosing, takeRefocus } from './walk.ts';

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

const LINKS: Readonly<Record<Link, StackTreeLink>> = {
  github: 'github',
  baseBranch: 'base',
  sharedCommits: 'commits',
};

/** Where each layer of `band`, bottom first, sits in it, for its row: its ends, or between. */
export function bandOf(band: readonly number[]): ReadonlyMap<number, StackRun> {
  if (band.length === 1) return new Map(band.map((number) => [number, 'only']));
  return new Map(
    band.map((number, index) => [
      number,
      index === 0 ? 'start' : index === band.length - 1 ? 'end' : 'middle',
    ]),
  );
}

/**
 * A button in the stack's head that steps through its layers as `]s` (`down`) or `[s` does: its
 * command's label and key in its tooltip, dimmed with why while it can't.
 */
function StepButton({ id, down }: { id: string; down: boolean }) {
  const control = controlOf(id);
  if (!control) return null;
  const off = control.off !== undefined;
  return (
    <Button
      variant="ghost"
      size="sm"
      icon
      aria-label={control.label}
      disabled={off}
      hint={control.off ?? control.label}
      hintKeys={off ? undefined : control.keys}
      hintShortcut={off ? undefined : control.shortcut}
      // A click leaves focus where it was, so the keys there go on working.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={() => {
        if (!off) runControl(id);
      }}
    >
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <path d={down ? 'M4.5 6.25 8 9.75l3.5-3.5' : 'M4.5 9.75 8 6.25l3.5 3.5'} />
      </svg>
    </Button>
  );
}

/**
 * The offer to convert the chain through the layer on screen to a GitHub stack: one line, and the
 * command's button.
 */
function Offer({ line, tab }: { line: string; tab: PullTab }) {
  const control = controlOf('stacks.convert');
  const off = control?.off;
  return (
    <div className="flex flex-col items-start gap-6">
      <p className="m-0 text-fg-muted text-small">{withoutBidi(line)}</p>
      <Button
        size="sm"
        disabled={off !== undefined}
        hint={off ?? null}
        onClick={() => {
          if (control) runControl('stacks.convert');
          else makeStack(tab.id, tab.number);
        }}
      >
        {control?.label ?? 'Convert to GitHub stack…'}
        {control?.keys && <Key keys={control.keys} decorative />}
      </Button>
    </div>
  );
}

/**
 * What the tree says while layers are selected: the layer it started from, or which layers and
 * what they're compared with, and a hint row of the keys that grow, show and stop the selection.
 */
function Selecting({
  rows,
  root,
  choice,
  target,
}: {
  rows: readonly Row[];
  root: string;
  choice: Choice;
  target: Target;
}) {
  const line = choiceLine(rows, root, choice);
  const from = line.code ? <span className="code-small">{line.from}</span> : line.from;
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0">
        {line.name === undefined ? (
          <>Selecting layers from {from}</>
        ) : (
          <>
            {line.name}, compared with {from}
          </>
        )}
      </p>
      <div className="-ms-8 flex min-w-0 flex-nowrap items-center gap-4">
        {line.name === undefined ? (
          <>
            <HintButton command="stacks.down">Next</HintButton>
            <HintButton command="stacks.up">Previous</HintButton>
          </>
        ) : (
          <HintButton command="stacks.show" target={target}>
            Show {line.name.toLowerCase()}
          </HintButton>
        )}
        <HintButton command="stacks.cancel">Stop</HintButton>
      </div>
    </div>
  );
}

/** A note main sent, as the tree draws it: one that says what failed is a problem. */
function noteOf(note: Note, index: number): StackTreeNote {
  const key = `${note.kind}-${index}`;
  if (note.kind === 'mergedFailed') {
    return { key, bare: true, text: <Problem layout="inline" title={withoutBidi(note.text)} /> };
  }
  return { key, text: withoutBidi(note.text) };
}

/**
 * What the layer on screen's viewed count says: of the files its diff shows, as `e` marks them, with
 * whether there may be more than GitHub has listed; and how many of its review threads are
 * unresolved, once they're read.
 */
export interface OnScreen {
  readonly count:
    { readonly viewed: number; readonly total: number; readonly partial: boolean } | undefined;
  readonly overview: OverviewMark | undefined;
  readonly threads?: number | undefined;
}

/**
 * `row` as the tree draws it: its text without what would turn its direction around, and the layer
 * on screen's overview, viewed count and unresolved threads from its tab, which change as they're
 * read; until its threads are, what was read with the layers.
 */
export function layerOf(row: Row, onScreen: OnScreen): StackTreeLayer {
  const { viewed, threads } = row;
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
          partial: onScreen.count.partial,
        }
      : viewed?.source === 'layers'
        ? { viewed: viewed.viewed, total: viewed.files, partial: !viewed.complete }
        : undefined,
    threads:
      row.current && onScreen.threads !== undefined
        ? { unresolved: onScreen.threads }
        : threads === null
          ? undefined
          : { unresolved: threads.unresolved, partial: !threads.complete },
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
  const choice = useTabState(choosing, tab.id);
  const trouble = useTabState(runTrouble, tab.id);
  const overview = useOverviewMark(tab.id);
  const count = useViewedCount(tab.id);
  const threads = useLayerCount(tab.id);

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
  const onScreen = { count, overview, threads };
  // A run on screen, or being chosen, is a band; it has no one layer on screen.
  const band = choice
    ? (chainIn(view.rows, choice.anchor, choice.end) ?? [choice.anchor])
    : (tab.run?.layers ?? []);
  const runs = bandOf(band);
  const current = tab.run ? undefined : view.rows.find((row) => row.current);
  const on = keyboardLayer(view, keyboard, tab.number);
  const notes = view.notes.map(noteOf);
  if (trouble !== undefined) {
    notes.unshift({
      key: 'run',
      bare: true,
      text: <Problem layout="inline" title={trouble.title} details={trouble.details} />,
    });
  }
  // While layers are selected, the bar saying so takes the offer's place, which can't be used
  // then: the two are as tall, so the layers under them stay where they are.
  const callout = choice ? (
    <Selecting
      rows={view.rows}
      root={withoutBidi(view.root)}
      choice={choice}
      target={on === undefined ? { kind: 'none' } : { kind: 'layer', layer: on }}
    />
  ) : view.callout === null ? undefined : (
    <Offer line={view.callout} tab={tab} />
  );
  return (
    <div className="flex max-h-1/2 min-h-0 flex-none flex-col" data-lo-stack={tab.id}>
      <StackTree
        layers={view.rows.map((row) => {
          const layer = layerOf(row, onScreen);
          const run = runs.get(row.number);
          return run === undefined ? layer : { ...layer, run };
        })}
        root={withoutBidi(view.root)}
        githubStack={view.githubStack}
        // The notes say which layers are a GitHub stack where only some are: the head agrees.
        githubPartly={view.notes.some((note) => note.kind === 'github')}
        found={view.found?.map((link) => LINKS[link])}
        actions={
          <>
            <StepButton id="stacks.previousLayer" down={false} />
            <StepButton id="stacks.nextLayer" down />
          </>
        }
        focused={on === undefined ? undefined : String(on)}
        current={current === undefined ? undefined : String(current.number)}
        choosing={choice !== undefined}
        onShow={(key) => {
          // A click shows the layer clicked, whatever was being chosen.
          stopChoosing(tab.id);
          showTarget({ kind: 'layer', layer: Number(key) });
        }}
        onMenu={(key, event: MouseEvent<HTMLElement>) => {
          // The browser's own event for the key that opened a menu, which is open.
          if (currentMenu() !== undefined) {
            event.preventDefault();
            return;
          }
          const layer = Number(key);
          stopChoosing(tab.id);
          focused.set(tab.id, layer);
          if (openMenu({ kind: 'layer', layer }, { x: event.clientX, y: event.clientY })) {
            event.preventDefault();
          }
        }}
        callout={callout}
        notes={notes}
        treeRef={treeRef}
        onBlur={() => {
          // Leaving the tree stops choosing, though leaving the window doesn't.
          if (document.hasFocus()) stopChoosing(tab.id);
        }}
        data-lo-scope="stack"
      />
    </div>
  );
}
