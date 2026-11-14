// The overview's markers in each pull request's tab's diff: the lines each code block, walkthrough
// step, figure part and link to code points at, with what the overview says of them, as the diff
// asks at the commit its newer side shows. At the commit the overview describes they're its lines
// as written. At the head on screen, when the overview was written for an older push, they're mapped
// there from its commit (`since.ts`), each file once Lo has worked out how it changed: lines that
// changed since, or went, get none, nor do lines of a file Lo can't compare. At any other commit,
// as when the diff compares older revisions, there are none. The diff asks again as the overview,
// its check or what's worked out of its files changes. A note draws its words as the overview does.

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import type { Overview, OverviewBlock } from '@lo/artifact';
import type { DrawNote } from '@lo/ui/code';
import { generationOf, secureLink, type Followed } from '@lo/ui/markdown';
import { OverviewNote } from '@lo/ui/overview';

import { explainedChanged, setExplainer, type ExplainedLines } from '../../diff/window/shared.ts';
import { followLink } from '../../open/window/shared.ts';
import { pullOf } from '../../tab/window/shared.ts';
import { setStep } from './blocks.ts';
import { explainedId, explanationsOf, readExplainedId, type Explanation } from './explained.ts';
import { standingOf } from './facts.ts';
import { revealBlock } from './follow.ts';
import { runsOnHead, type Run } from './mapping.ts';
import { fileSince, knownSince } from './since.ts';
import { staleAgainst } from './stale.ts';
import { checked, states } from './store.ts';
import { targetsOf } from './targets.ts';

/**
 * Where lines at the overview's commit are at the commit the diff shows: the file's path there and
 * the runs of them still there; nothing for lines that aren't.
 */
export type Placed = { readonly path: string; readonly runs: readonly Run[] } | undefined;

/**
 * The lines `explanations` mark, each placed where `place` says, by the tree numbered `tree`: a
 * marker for each run of each one's lines that's there, under the section it's in, with its words.
 * One whose place Lo is still working out (`waiting`) marks nothing yet.
 */
export function markedLines(
  tree: number,
  explanations: readonly Explanation[],
  place: (explanation: Explanation) => Placed | 'waiting',
): ExplainedLines[] {
  return explanations.flatMap((explanation) => {
    const placed = place(explanation);
    if (placed === undefined || placed === 'waiting') return [];
    const block = explainedId(tree, explanation);
    const note = {
      label: explanation.section,
      text: explanation.text,
      draw: drawerOf(explanation),
    };
    return placed.runs.map(({ from, to }) => ({ path: placed.path, from, to, block, note }));
  });
}

/** What draws each explanation's words in a note, made once. */
const drawers = new WeakMap<Explanation, DrawNote>();

function drawerOf(explanation: Explanation): DrawNote {
  let draw = drawers.get(explanation);
  if (!draw) {
    draw = drawNote(explanation.content);
    drawers.set(explanation, draw);
  }
  return draw;
}

/**
 * What draws `blocks` in a note's element as the overview draws its words: at once, as the diff
 * measures the note as it draws it. A link to a web page opens through main.
 */
export function drawNote(blocks: readonly OverviewBlock[]): DrawNote {
  return (into) => {
    const root = createRoot(into);
    flushSync(() => root.render(createElement(OverviewNote, { blocks, onFollow: followWeb })));
    // Not while React may be rendering, as when the diff takes notes down in an effect.
    return () => queueMicrotask(() => root.unmount());
  };
}

function followWeb(target: Followed<Overview>): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

/** Each tree's explanations, worked out once. */
const explained = new WeakMap<object, readonly Explanation[]>();

function explanationsIn(tree: Parameters<typeof explanationsOf>[0]): readonly Explanation[] {
  let found = explained.get(tree);
  if (!found) {
    found = explanationsOf(tree);
    explained.set(tree, found);
  }
  return found;
}

/** The reads of files since the overview's commit the markers wait for, each followed once. */
const followed = new WeakSet<Promise<unknown>>();

/** What each tab's diff last asked about, and what the overview was then, to say when it changes. */
const asked = new Map<string, { state: unknown; checked: unknown }>();

/** The lines the overview of tab `tab` explains on its diff's newer side, at commit `at`. */
function linesAt(tab: string, at: string): readonly ExplainedLines[] {
  asked.set(tab, { state: states.get(tab), checked: checked.get(tab) });
  const standing = standingOf(states.get(tab), checked.get(tab));
  if (standing.kind !== 'shown') return [];
  const { header, parsed, result } = standing;
  const { commit } = header;
  const { outcome } = result.checked;
  // A reference that doesn't resolve at the overview's commit marks nothing.
  const found = targetsOf(outcome.kind === 'shown' ? outcome.code : [], result.code);
  const explanations = explanationsIn(parsed.tree).filter(
    ({ target }) => found(target).code.state !== 'broken',
  );
  const tree = generationOf(parsed.tree);
  if (at === commit) {
    return markedLines(tree, explanations, ({ target }) => ({
      path: target.path,
      runs: [{ from: target.lines.start, to: target.lines.end }],
    }));
  }
  // Mapped only to the head on screen, from an overview written for an older push.
  if (staleAgainst(commit, pullOf(tab)) !== at) return [];
  return markedLines(tree, explanations, ({ target }) => {
    const since = knownSince(tab, commit, at, target.path);
    if (since !== undefined) return runsOnHead(since, target.lines);
    // Worked out in the diff's background job, and the diff told once it is.
    const reading = fileSince(tab, commit, at, target.path, { quick: false });
    if (!followed.has(reading)) {
      followed.add(reading);
      reading.then(
        () => explainedChanged(tab),
        (error: unknown) => console.error("Lo couldn't place an overview's markers:", error),
      );
    }
    return 'waiting';
  });
}

/**
 * "Read it in the overview" in a note in tab `tab`'s diff: the overview comes on screen at the
 * block the note is of, a walkthrough at its step, with the block given focus, if the note is of
 * the overview the tab has now. Says whether it is.
 */
function read(tab: string, id: string): boolean {
  const named = readExplainedId(id);
  const standing = standingOf(states.get(tab), checked.get(tab));
  if (!named || standing.kind !== 'shown' || named.tree !== generationOf(standing.parsed.tree)) {
    return false;
  }
  const node = standing.parsed.tree.blocks[named.block];
  if (!node) return false;
  if (named.step !== undefined && node.kind === 'walkthrough') setStep(node, named.step);
  revealBlock(tab, named.block);
  return true;
}

/** Tells each tab's diff that asked for markers when its overview, or what its check found, changed. */
function overviewChanged(): void {
  for (const [tab, was] of asked) {
    if (was.state !== states.get(tab) || was.checked !== checked.get(tab)) explainedChanged(tab);
  }
}

/**
 * Gives the diffs the overviews' markers, and tells a tab's diff when its overview changes. Returns
 * a function that stops it.
 */
export function followMarkers(): () => void {
  const stop = setExplainer({ linesAt, read });
  const stops = [states.subscribe(overviewChanged), checked.subscribe(overviewChanged)];
  return () => {
    stop();
    for (const each of stops) each();
  };
}

/** Forgets the tabs that closed: those not in `open`. */
export function keepMarkersOnly(open: ReadonlySet<string>): void {
  for (const tab of asked.keys()) if (!open.has(tab)) asked.delete(tab);
}
