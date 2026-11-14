// The lines a key acts on in the diff or a file whole, as they show: the cursor's line and those a
// count adds after it, or the lines `v` selected, which can cross files and sides.

import type { LineTarget, Span } from '@lo/ui/commands';

/**
 * The lines `target` is on, as they show: the cursor's line and the `count` - 1 after it, or the
 * lines `v` selected, in one file on one side or across them. Where those aren't one run of one
 * file's lines on one side, the view says them, `across`.
 */
export function spansOf(target: LineTarget, count = 1): readonly Span[] {
  if (target.across) return target.across;
  const { at } = target;
  if (!('line' in at)) return [at];
  return [{ file: at.file, side: at.side, from: at.line, to: at.line + Math.max(1, count) - 1 }];
}
