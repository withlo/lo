// The bar across the top of the middle while a run of a stack's layers is on screen as one diff:
// which layers, the branches its diff goes between, how many files it changes, and the way back to
// the layer it was chosen from, which `Esc` takes too. While GitHub couldn't compare the run, it
// says so, and that the top layer's pull request shows instead, which describes what's on screen
// where the branches and the file count wouldn't. Nothing shows for a view of one layer.

import { RunBar } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';
import { useEffect } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { untilLocalCopy, useDiffFiles } from '../../diff/window/shared.ts';
import { topOf } from '../../tab/contract.ts';
import {
  useLocalCopy,
  useTabState,
  withoutBidi,
  type PullTab,
  type Run,
} from '../../tab/window/shared.ts';
import type { StackView } from '../contract.ts';
import { catchUp, stacks } from './layers.ts';
import { leaveRun } from './walk.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/**
 * What the bar says of `run` from its stack, `view`: each layer's title, and the branches its diff
 * goes between: from the head of the layer below its bottom one, or the branch the stack sits on,
 * to its top layer's head. Only numbers until the stack is known. When GitHub couldn't compare it
 * (`uncompared`), what shows instead: the top layer's pull request, as GitHub lists it, until the
 * local copy replaces it with the run (`later`, as the status bar words it), if it will.
 */
export function barOf(
  run: Run,
  view: StackView | undefined,
  uncompared = false,
  later = '',
): {
  layers: { number: number; title: string | undefined }[];
  branches: { from: string; to: string } | undefined;
  instead: string | undefined;
} {
  const instead = uncompared
    ? `Showing only #${topOf(run)}’s pull request${later}: GitHub couldn’t compare the run as one diff`
    : undefined;
  const rows = view?.kind === 'stack' ? view.rows : [];
  const rowOf = (number: number | undefined) => rows.find((row) => row.number === number);
  const layers = run.layers.map((number) => {
    const title = rowOf(number)?.title;
    return { number, title: title === undefined ? undefined : withoutBidi(title) };
  });
  const bottom = rowOf(run.layers[0]);
  const top = rowOf(run.layers.at(-1));
  if (view?.kind !== 'stack' || !bottom || !top) return { layers, branches: undefined, instead };
  const below = bottom.path.at(-2);
  const from = below === undefined ? view.root : rowOf(below)?.head;
  if (from === undefined || from === '' || top.head === '') {
    return { layers, branches: undefined, instead };
  }
  return { layers, branches: { from: withoutBidi(from), to: withoutBidi(top.head) }, instead };
}

/** The bar over the run of layers `tab` shows, while it shows one. */
export function RunOnScreen({ tab }: { tab: PullTab }) {
  return tab.run ? <Bar tab={tab} run={tab.run} /> : null;
}

function Bar({ tab, run }: { tab: PullTab; run: Run }) {
  // Key caps follow the keymap file.
  useKeys();
  const view = useTabState(stacks, tab.id);
  const files = useDiffFiles(tab.id);
  useEffect(() => {
    if (stacks.get(tab.id) === undefined) catchUp(tab.id);
  }, [tab.id]);
  const later = untilLocalCopy(useLocalCopy(tab.id));
  const { layers, branches, instead } = barOf(run, view, files?.uncompared, later);
  return (
    <RunBar
      layers={layers}
      branches={branches}
      files={files}
      instead={instead}
      back={run.from}
      backKeys={keyOf('stacks.back')}
      onBack={leaveRun}
    />
  );
}
