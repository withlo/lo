// Where a view's review threads go on its overview's code blocks: under the lines of the block's
// file at the commit the overview describes, as `@lo/review`'s `place` says for that commit's whole
// diff, or, for a stack's layer, with the base side its own, where no thread shows. A thread placed
// on another commit's lines, as on a newer push than an out-of-date overview's, shows on no block.
// Unresolved threads start open and resolved ones collapsed, as in the diff.

import { place, Screen, Thread } from '@lo/review';
import type { ThreadView } from '@lo/ui/code';

import type { DrawnBlock } from '../../overview/window/shared.ts';
import type { ThreadRow } from '../contract.ts';
import { threadOf, versionOf } from './placing.ts';

/** What a block's lines show: its commit's whole diff, or a layer's, its base side its own. */
export function blockScreen(block: Pick<DrawnBlock, 'commit' | 'from'>): Screen {
  return block.from === null
    ? Screen.full(block.commit)
    : Screen.replayed(block.from, block.commit);
}

/**
 * `rows`, a view's threads, placed on `block`'s lines: those on lines of its file at its commit,
 * each under its last line, on the side it's on. The block's code view leaves out those on lines
 * it doesn't show.
 */
export function threadsOnBlock(rows: readonly ThreadRow[], block: DrawnBlock): ThreadView[] {
  const screen = blockScreen(block);
  const placed: ThreadView[] = [];
  for (const row of rows) {
    if (row.path !== block.path || row.subject !== 'LINE') continue;
    const thread = threadOf(row);
    const placement = place(thread, screen);
    if (placement.kind !== 'lines') continue;
    const { end } = placement.lines;
    placed.push({
      id: thread.id,
      at: { file: block.file, side: end.side === 'RIGHT' ? 'new' : 'old', line: end.number },
      open: Thread.startsOpen(thread),
      version: versionOf(JSON.stringify(row)),
    });
  }
  return placed;
}
