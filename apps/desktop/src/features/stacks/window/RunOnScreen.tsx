// The bar across the top of the middle while several of a stack's layers are on screen as one
// diff: which layers, the branches its diff goes between, how many files it changes, and the way
// back to a single layer, which `Esc` takes too. While GitHub couldn't compare them, it says so, and
// that the top layer shows alone, which describes what's on screen where the branches and the file
// count wouldn't. Nothing shows for a view of one layer.

import { RunBar } from '@lo/ui';
import { controlOf, keyLabels } from '@lo/ui/commands';
import { useEffect } from 'react';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { useDiffFiles } from '../../diff/window/shared.ts';
import { topOf } from '../../tab/contract.ts';
import { useTabState, withoutBidi, type PullTab, type Run } from '../../tab/window/shared.ts';
import type { StackView } from '../contract.ts';
import { catchUp, stacks } from './layers.ts';
import { layersName } from './runs.ts';
import { leaveRun } from './walk.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/**
 * What the bar says of `run` from its stack, `view`: the layers' span and each one's title, and the
 * branches its diff goes between: from the head of the layer below its bottom one, or the branch the
 * stack sits on, to its top layer's head. Only numbers until the stack is known. When GitHub
 * couldn't compare them (`uncompared`), that they can't show as one diff, and that the top layer
 * shows alone.
 */
export function barOf(
  run: Run,
  view: StackView | undefined,
  uncompared = false,
): {
  layers: { number: number; title: string | undefined }[];
  name: string;
  branches: { from: string; to: string } | undefined;
  problem: { title: string; reason: string } | undefined;
} {
  const rows = view?.kind === 'stack' ? view.rows : [];
  const name = layersName(rows, run.layers);
  const problem = uncompared
    ? {
        title: `Can’t show ${name.toLowerCase()} as one diff`,
        reason: `Showing #${topOf(run)} alone.`,
      }
    : undefined;
  const rowOf = (number: number | undefined) => rows.find((row) => row.number === number);
  const layers = run.layers.map((number) => {
    const title = rowOf(number)?.title;
    return { number, title: title === undefined ? undefined : withoutBidi(title) };
  });
  const bottom = rowOf(run.layers[0]);
  const top = rowOf(run.layers.at(-1));
  if (view?.kind !== 'stack' || !bottom || !top) {
    return { layers, name, branches: undefined, problem };
  }
  const below = bottom.path.at(-2);
  const from = below === undefined ? view.root : rowOf(below)?.head;
  if (from === undefined || from === '' || top.head === '') {
    return { layers, name, branches: undefined, problem };
  }
  return {
    layers,
    name,
    branches: { from: withoutBidi(from), to: withoutBidi(top.head) },
    problem,
  };
}

/** The bar over the layers `tab` shows as one diff, while it shows several. */
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
  const { layers, name, branches, problem } = barOf(run, view, files?.uncompared);
  return (
    <RunBar
      layers={layers}
      name={name}
      branches={branches}
      files={files}
      problem={problem}
      backLabel={controlOf('stacks.back')?.label}
      backKeys={keyOf('stacks.back')}
      onBack={leaveRun}
    />
  );
}
