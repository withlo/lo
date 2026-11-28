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

/**
 * A line, or the lines `v` selected, with the thread on it when there's one to act on, and the
 * comment box a key in one under it is in.
 */
export interface LineTarget {
  kind: 'line';
  at: Place | Span;
  /**
   * The lines a key takes, as they show, where they're more than one run of lines of one file on
   * one side: those `v` selected, inline the other side's between them too; or, with a count, as
   * `4yy` takes, that many from the cursor's. `at` is the cursor's line, or the lines `v` selected
   * when they start and end on one side of one file, for what acts on those.
   */
  across?: readonly Span[];
  /** The thread `]t` landed on, or the only one on the cursor's line. */
  thread?: string;
  /**
   * A draft's mark is on the line, beside lines: its own, or the dot on the threads' mark there. A
   * line gives it as a draft only where it gives no thread.
   */
  draft?: true;
  /** The comment box the key is in, by its caller's name for it. */
  box?: string;
  /**
   * A right-click inside lines selected, more than one of one file on one side: those lines, which
   * the commands that comment take. `at` is the line and column clicked, for the rest.
   */
  selected?: Span;
}

/** A draft's mark beside lines, by the line it's on: what `⏎` there opens. */
export interface DraftTarget {
  kind: 'draft';
  at: Place;
}

export interface FileTarget {
  kind: 'file';
  file: string;
}

/**
 * A file's header in a code view that shows one, on one side: where `]f` lands. With the comment
 * box on the file a key is in.
 */
export interface HeaderTarget {
  kind: 'header';
  file: string;
  side: Side;
  /** The thread on the file `]t` landed on, or the only one under the header. */
  thread?: string;
  /** The comment box the key is in, by its caller's name for it. */
  box?: string;
}

export interface ThreadTarget {
  kind: 'thread';
  thread: string;
  /**
   * It's drawn collapsed to one line, where what names it knows: what opens or collapses it is
   * called by which it would do.
   */
  collapsed?: boolean;
  /** The comment of it the keyboard's ring is on, as in a thread's popover: what `i` edits. */
  comment?: string;
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

/** A comment box, by its caller's name for it: what its frame's buttons do. */
export interface BoxTarget {
  kind: 'box';
  box: string;
}

/**
 * Something Lo offers or advises unasked, such as the offer over a stack's tree to convert it to a
 * GitHub stack, by its id (`stacks.convert`), in the tab it's shown in: what its Dismiss's menu
 * acts on, there, whichever tab is on screen by the time it runs.
 */
export interface NoticeTarget {
  kind: 'notice';
  notice: string;
  /** The tab it's shown in, by its id. */
  tab: string;
  /** The pull request it's about, by its number, where it's about one: "Dismiss for #84". */
  pull?: number;
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
  | DraftTarget
  | LayerTarget
  | BlockTarget
  | TabTarget
  | RowTarget
  | BoxTarget
  | NoticeTarget
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
  'draft',
  'layer',
  'block',
  'tab',
  'row',
  'box',
  'notice',
  'none',
];

export const NO_TARGET: NoTarget = { kind: 'none' };

/**
 * `target` as one of `kinds`, which a command takes, or undefined if it's none of them. A target of
 * one of the kinds is taken as it is. Otherwise, in `kinds`' order: a line or a header gives its file, a line its
 * thread, a line or a header in a comment box the box, and a command that takes `none` takes
 * anything.
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

/**
 * Whether a key acts on a target of kind `kind` at `target`, as a command's `when.on` asks: it's
 * one, or a line that gives one. A header names its file before anything on it.
 */
export function isOn(target: Target, kind: TargetKind): boolean {
  return target.kind === kind || (target.kind === 'line' && fit([kind], target) !== undefined);
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
      return (target.kind === 'line' || target.kind === 'header') && target.thread !== undefined
        ? { kind: 'thread', thread: target.thread }
        : undefined;
    case 'box':
      return (target.kind === 'line' || target.kind === 'header') && target.box !== undefined
        ? { kind: 'box', box: target.box }
        : undefined;
    // Never with a thread: the thread's commands take the line, and the draft is in the thread.
    case 'draft':
      return target.kind === 'line' &&
        target.draft === true &&
        target.thread === undefined &&
        'line' in target.at
        ? { kind: 'draft', at: target.at }
        : undefined;
    case 'line':
    case 'header':
    case 'layer':
    case 'block':
    case 'tab':
    case 'row':
    case 'notice':
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
      const line: LineTarget = { kind: 'line', at: plainAt(target.at) };
      if (target.thread !== undefined) line.thread = target.thread;
      if (target.draft === true) line.draft = true;
      if (target.box !== undefined) line.box = target.box;
      return line;
    }
    case 'header': {
      const header: HeaderTarget = { kind: 'header', file: target.file, side: target.side };
      if (target.thread !== undefined) header.thread = target.thread;
      if (target.box !== undefined) header.box = target.box;
      return header;
    }
    case 'file':
      return { kind: 'file', file: target.file };
    case 'thread':
      return target.comment === undefined
        ? { kind: 'thread', thread: target.thread }
        : { kind: 'thread', thread: target.thread, comment: target.comment };
    case 'draft':
      return { kind: 'draft', at: plainPlace(target.at) };
    case 'layer':
      return { kind: 'layer', layer: target.layer };
    case 'block':
      return { kind: 'block', block: target.block };
    case 'tab':
      return { kind: 'tab', tab: target.tab };
    case 'row':
      return { kind: 'row', row: target.row };
    case 'box':
      return { kind: 'box', box: target.box };
    case 'notice': {
      const notice: NoticeTarget = { kind: 'notice', notice: target.notice, tab: target.tab };
      if (target.pull !== undefined) notice.pull = target.pull;
      return notice;
    }
    case 'none':
      return NO_TARGET;
    default:
      // Never kept as it came: it could be anything.
      target satisfies never;
      throw new Error('A target of an unknown kind.');
  }
}

function plainAt(at: Place | Span): Place | Span {
  if ('line' in at) return plainPlace(at);
  return { file: at.file, side: at.side, from: at.from, to: at.to };
}

function plainPlace(at: Place): Place {
  const place: Place = { file: at.file, side: at.side, line: at.line };
  if (at.column !== undefined) place.column = at.column;
  return place;
}

/**
 * Whether one target can give both kinds `a` and `b`, so that keys for what each acts on meet. A
 * line gives a draft only where it gives no thread.
 */
export function together(a: TargetKind, b: TargetKind): boolean {
  return !((a === 'thread' && b === 'draft') || (a === 'draft' && b === 'thread'));
}
