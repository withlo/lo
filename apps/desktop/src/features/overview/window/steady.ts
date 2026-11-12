// What a tab's overview keeps from one check to the next. The view keys each block by the parsed
// tree's objects, and each figure by its checked tree, so a result that arrives again, equal but
// made anew (checked again as the local copy comes, or cloned on its way from the background
// process), must hand the view the objects it already has: new ones would draw the overview again
// from scratch, closing its folds, dropping focus and moving the page.

import type { CheckedArtifact, Outcome } from '@lo/artifact';

import type { CheckedOverview } from './checking.ts';

/**
 * `next`, for the same tab as `previous`, with each part that's equal to `previous`'s replaced by
 * `previous`'s own object; `previous` itself when the two are equal through and through. A result
 * for another commit shares nothing.
 */
export function steady(
  previous: CheckedOverview | undefined,
  next: CheckedOverview | undefined,
): CheckedOverview | undefined {
  if (previous === undefined || next === undefined || previous === next) return next;
  if (previous.commit.id !== next.commit.id || previous.commit.source !== next.commit.source) {
    return next;
  }
  if (previous.kind === 'failed' || next.kind === 'failed') {
    const again =
      previous.kind === 'failed' &&
      next.kind === 'failed' &&
      previous.key === next.key &&
      previous.why === next.why;
    return again ? previous : next;
  }
  const kept: CheckedOverview = {
    kind: 'checked',
    key: next.key,
    commit: same(previous.commit, next.commit),
    parsed: same(previous.parsed, next.parsed),
    checked: steadyCheck(previous.checked, next.checked),
    figures: same(previous.figures, next.figures),
    coming: same(previous.coming, next.coming),
    code: same(previous.code, next.code),
  };
  const unchanged =
    previous.key === kept.key &&
    previous.commit === kept.commit &&
    previous.parsed === kept.parsed &&
    previous.checked === kept.checked &&
    previous.figures === kept.figures &&
    previous.coming === kept.coming &&
    previous.code === kept.code;
  return unchanged ? previous : kept;
}

/** `next`, with its outcome's parts and its findings `previous`'s where they're equal. */
function steadyCheck(previous: CheckedArtifact, next: CheckedArtifact): CheckedArtifact {
  const outcome = steadyOutcome(previous.outcome, next.outcome);
  const findings = same(previous.findings, next.findings);
  if (outcome === previous.outcome && findings === previous.findings) return previous;
  return { outcome, findings };
}

function steadyOutcome(previous: Outcome, next: Outcome): Outcome {
  if (previous.kind !== 'shown' || next.kind !== 'shown') return same(previous, next);
  const header = same(previous.header, next.header);
  const code = next.code.map((each, index) => same(previous.code[index], each));
  const figures = next.figures.map((each, index) => same(previous.figures[index], each));
  const kept =
    header === previous.header &&
    code.length === previous.code.length &&
    code.every((each, index) => each === previous.code[index]) &&
    figures.length === previous.figures.length &&
    figures.every((each, index) => each === previous.figures[index]);
  return kept ? previous : { kind: 'shown', header, code, figures };
}

/** `previous`, when it's equal to `next`; otherwise `next`. */
function same<T>(previous: T | undefined, next: T): T {
  return previous !== undefined && equal(previous, next) ? previous : next;
}

/**
 * Whether `a` and `b` hold the same data: the same primitives, in arrays, plain objects, maps and
 * byte arrays alike. It walks with an explicit stack, so no tree can overflow it.
 */
export function equal(a: unknown, b: unknown): boolean {
  const stack: [unknown, unknown][] = [[a, b]];
  while (stack.length > 0) {
    const [left, right] = stack.pop() ?? [];
    if (Object.is(left, right)) continue;
    if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
      return false;
    }
    if (left instanceof Uint8Array || right instanceof Uint8Array) {
      if (!(left instanceof Uint8Array && right instanceof Uint8Array)) return false;
      if (left.length !== right.length) return false;
      for (let at = 0; at < left.length; at++) if (left[at] !== right[at]) return false;
      continue;
    }
    if (left instanceof Map || right instanceof Map) {
      if (!(left instanceof Map && right instanceof Map) || left.size !== right.size) return false;
      for (const [key, value] of left) {
        if (!right.has(key)) return false;
        stack.push([value, right.get(key)]);
      }
      continue;
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false;
      stack.push([Reflect.get(left, key), Reflect.get(right, key)]);
    }
  }
  return true;
}
