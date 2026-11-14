// `e` in the diff: marks the file the diff shows viewed, or clears its mark, through the revisions
// feature. Marking closes the file and goes on to the next one that isn't viewed, in the order the
// diff shows them, round the end; clearing opens it again. With a count, `3e` marks three files
// and clears none. A failed write takes back the mark alone, never where the cursor went or what's
// on screen.

import type { HeaderTarget, LineTarget } from '@lo/ui/code';

import { notify } from '../../../window/commands/notices.tsx';
import type { FileVersions } from '../contract.ts';
import { passedOver, toggleViewed, viewedMarksOf } from '../../revisions/window/shared.ts';
import type { Drawn } from './tabs.ts';

/**
 * The file after `id` in `order` that `done` doesn't pass over, going round to the start: where
 * `e` goes after marking `id`, past files that are viewed, or that it can't mark. Nothing when
 * every other file is one of those.
 */
export function nextUnviewed(
  order: readonly string[],
  id: string,
  done: (id: string) => boolean,
): string | undefined {
  const from = order.indexOf(id);
  if (from < 0) return undefined;
  for (let step = 1; step < order.length; step++) {
    const next = order[(from + step) % order.length];
    if (next !== undefined && !done(next)) return next;
  }
  return undefined;
}

/**
 * `e` on `target` in the diff drawn as `drawn`, which marks the file viewed or clears its mark; or
 * with a count, `3e` or `1e`, which only marks.
 */
export function markViewed(drawn: Drawn, target: LineTarget | HeaderTarget, count?: number): void {
  const id = drawn.fileAt(target);
  const entries = new Map(
    (drawn.loader.snapshot().ready?.entries ?? []).map((entry) => [entry.id, entry]),
  );
  const entry = entries.get(id);
  if (!entry) {
    notify('Mark viewed', 'The diff is still loading, so there’s no file to mark viewed yet.');
    return;
  }
  if (count !== undefined) {
    markMany(drawn, entries, id, count);
    return;
  }
  const { path, previous } = entry.versions;
  const toggled = toggleViewed(drawn.tab, { path, previous });
  switch (toggled.kind) {
    case 'refused':
      notify('Mark viewed', toggled.why);
      return;
    case 'clearing':
      drawn.viewedHere(id, false, undefined);
      return;
    case 'marking': {
      // Read after the toggle, so the file just marked counts as viewed.
      const marks = viewedMarksOf(drawn.tab);
      const next = nextUnviewed(drawn.order, id, (other) => {
        const versions = entries.get(other)?.versions;
        return versions === undefined || passedOver(marks, versions.path, versions.previous);
      });
      drawn.viewedHere(id, true, next);
      return;
    }
    default:
      toggled satisfies never;
      throw new Error(`A toggle Lo doesn't know: ${JSON.stringify(toggled)}.`);
  }
}

/**
 * What `3e` on `id` marks: `count` files, `id` first unless `done` passes over it, then the next it
 * doesn't, in `order`, round the end; and the one after them, where it goes.
 */
export function marksFrom(
  order: readonly string[],
  id: string,
  count: number,
  done: (id: string) => boolean,
): { marks: string[]; next: string | undefined } {
  const marks: string[] = [];
  const passed = (other: string): boolean => done(other) || marks.includes(other);
  let at = passed(id) ? nextUnviewed(order, id, passed) : id;
  while (at !== undefined && marks.length < count) {
    marks.push(at);
    at = nextUnviewed(order, at, passed);
  }
  return { marks, next: at };
}

/** `3e`: marks the files {@link marksFrom} says, and goes on past them. It clears no mark. */
function markMany(
  drawn: Drawn,
  entries: ReadonlyMap<string, { readonly versions: FileVersions }>,
  id: string,
  count: number,
): void {
  const marks = viewedMarksOf(drawn.tab);
  const { marks: marking, next } = marksFrom(drawn.order, id, count, (other) => {
    const versions = entries.get(other)?.versions;
    return versions === undefined || passedOver(marks, versions.path, versions.previous);
  });
  for (const [index, each] of marking.entries()) {
    const versions = entries.get(each)?.versions;
    if (!versions) return;
    const toggled = toggleViewed(drawn.tab, { path: versions.path, previous: versions.previous });
    if (toggled.kind === 'refused') {
      notify('Mark viewed', toggled.why);
      return;
    }
    if (toggled.kind !== 'marking') return;
    drawn.viewedHere(each, true, marking[index + 1] ?? next);
  }
}
