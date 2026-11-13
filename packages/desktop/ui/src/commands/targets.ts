// What a command acts on. A key takes it from the focused scope, a right-click from what was
// clicked, and the palette from what had focus before it, so one handler serves all three.

/** A side of a diff: the base's lines (`old`) or the head's (`new`). */
export type Side = 'old' | 'new';

/** A line in a code view, and a column on it. `file` is the caller's id for the file. */
export interface Place {
  file: string;
  side: Side;
  /** From 1. */
  line: number;
  /** From 0, in UTF-16 code units. */
  column?: number;
}

/** Lines `from` to `to` on one side of a file, as `v` selects them. */
export interface Span {
  file: string;
  side: Side;
  from: number;
  to: number;
}

/** A line, or the lines `v` selected, with the thread on it when there's one to act on. */
export interface LineTarget {
  kind: 'line';
  at: Place | Span;
  /** The thread `]t` landed on, or the only one on the cursor's line. */
  thread?: string;
}

export interface FileTarget {
  kind: 'file';
  file: string;
}

/** A file's header in a code view that shows one, on one side: where `]f` lands. */
export interface HeaderTarget {
  kind: 'header';
  file: string;
  side: Side;
}

export interface ThreadTarget {
  kind: 'thread';
  thread: string;
}

/** A layer of a stack, by its pull request's number. */
export interface LayerTarget {
  kind: 'layer';
  layer: number;
}

/** A block of an overview. */
export interface BlockTarget {
  kind: 'block';
  block: string;
}

export interface TabTarget {
  kind: 'tab';
  tab: string;
}

/** A row of a list that isn't code, such as an event of a pull request's timeline, by its key. */
export interface RowTarget {
  kind: 'row';
  row: string;
}

/** Nothing in particular: the command acts on the window or the review. */
export interface NoTarget {
  kind: 'none';
}

export type Target =
  | LineTarget
  | HeaderTarget
  | FileTarget
  | ThreadTarget
  | LayerTarget
  | BlockTarget
  | TabTarget
  | RowTarget
  | NoTarget;

export type TargetKind = Target['kind'];

/** The target of one kind. */
export type TargetOf<K extends TargetKind> = Extract<Target, { kind: K }>;

/** Every kind of target. */
export const targetKinds: readonly TargetKind[] = [
  'line',
  'header',
  'file',
  'thread',
  'layer',
  'block',
  'tab',
  'row',
  'none',
];

export const NO_TARGET: NoTarget = { kind: 'none' };

/**
 * `target` as one of `kinds`, which a command takes, or undefined if it's none of them. A target of
 * one of the kinds is taken as it is. Otherwise, in `kinds`' order: a line or a header gives its file, a line its
 * thread, and a command that takes `none` takes anything.
 */
export function fit<K extends TargetKind>(
  kinds: readonly K[],
  target: Target,
): TargetOf<K> | undefined {
  if (isOneOf(target, kinds)) return target;
  for (const kind of kinds) {
    const fitted = derive(kind, target);
    if (fitted && isOneOf(fitted, kinds)) return fitted;
  }
  return undefined;
}

function isOneOf<K extends TargetKind>(target: Target, kinds: readonly K[]): target is TargetOf<K> {
  return kinds.some((kind) => kind === target.kind);
}

/** The target of kind `kind` that `target` gives, if any. */
function derive(kind: TargetKind, target: Target): Target | undefined {
  switch (kind) {
    case 'none':
      return NO_TARGET;
    case 'file':
      if (target.kind === 'line') return { kind: 'file', file: target.at.file };
      return target.kind === 'header' ? { kind: 'file', file: target.file } : undefined;
    case 'thread':
      return target.kind === 'line' && target.thread !== undefined
        ? { kind: 'thread', thread: target.thread }
        : undefined;
    case 'line':
    case 'header':
    case 'layer':
    case 'block':
    case 'tab':
    case 'row':
      return undefined;
    default:
      kind satisfies never;
      return undefined;
  }
}

/**
 * A copy of `target` with only a target's own fields, as plain data: whatever else the object a
 * caller handed over carries, such as an editor, isn't kept.
 */
export function plainTarget(target: Target): Target {
  switch (target.kind) {
    case 'line': {
      const at = plainAt(target.at);
      return target.thread === undefined
        ? { kind: 'line', at }
        : { kind: 'line', at, thread: target.thread };
    }
    case 'header':
      return { kind: 'header', file: target.file, side: target.side };
    case 'file':
      return { kind: 'file', file: target.file };
    case 'thread':
      return { kind: 'thread', thread: target.thread };
    case 'layer':
      return { kind: 'layer', layer: target.layer };
    case 'block':
      return { kind: 'block', block: target.block };
    case 'tab':
      return { kind: 'tab', tab: target.tab };
    case 'row':
      return { kind: 'row', row: target.row };
    case 'none':
      return NO_TARGET;
    default:
      // Never kept as it came: it could be anything.
      target satisfies never;
      throw new Error('A target of an unknown kind.');
  }
}

function plainAt(at: Place | Span): Place | Span {
  if ('line' in at) {
    const place: Place = { file: at.file, side: at.side, line: at.line };
    if (at.column !== undefined) place.column = at.column;
    return place;
  }
  return { file: at.file, side: at.side, from: at.from, to: at.to };
}
