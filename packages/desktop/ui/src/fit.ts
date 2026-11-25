// What a pull request's tab draws in its row: the left panel, one view or two, and the threads
// panel, at the width the row has. The layout saved is what the reader arranged, and never changes
// because the window did: `fit` gives what's drawn from it. Nothing draws under its minimum. As the
// row narrows, the views shrink to their minimum first, then the threads panel to its own, then the
// left panel. Then the threads panel is put away, then the left panel, then the view without focus,
// but what was asked for last goes after the others. Each comes back, at its saved width, as soon as
// there's room for it. Widths are CSS pixels, so zoom counts: at 200 %, a 720 px window is 360.

/** A panel's default width and the narrowest and widest it's drawn. */
export interface Limits {
  readonly width: number;
  readonly min: number;
  readonly max: number;
}

/** The sizes the row is laid out in, from the design tokens. */
export interface Sizes {
  /** `lo-panel-left-w`, `-min-w` and `-max-w`. */
  readonly left: Limits;
  /** `lo-panel-right-w`, `-min-w` and `-max-w`. */
  readonly threads: Limits;
  /** The narrowest a view is drawn: `lo-view-min-w`. */
  readonly view: number;
  /** The reading view's width with code beside, until its edge is dragged: `lo-reading-w`. */
  readonly reading: number;
  /** The gap between two views, which is the edge between them: `lo-splitter-w`. */
  readonly gap: number;
}

/** What reads a CSS variable: a computed style, in the window. */
export interface Variables {
  getPropertyValue(name: string): string;
}

/** The sizes, from the variables the design tokens set, as `style` has them. */
export function readSizes(style: Variables): Sizes {
  const px = (name: string) => parseFloat(style.getPropertyValue(`--lo-${name}`)) || 0;
  return {
    left: { width: px('panel-left-w'), min: px('panel-left-min-w'), max: px('panel-left-max-w') },
    threads: {
      width: px('panel-right-w'),
      min: px('panel-right-min-w'),
      max: px('panel-right-max-w'),
    },
    view: px('view-min-w'),
    reading: px('reading-w'),
    gap: px('splitter-w'),
  };
}

/** A panel as the layout keeps it: open or not, and its width, unset while it's the default. */
export interface PanelLayout {
  readonly open: boolean;
  readonly width?: number | undefined;
}

/** The layout the reader arranged. */
export interface Layout {
  readonly left: PanelLayout;
  readonly threads: PanelLayout;
  /** Code beside: a reading view, then the code view, where one view is otherwise. */
  readonly beside: boolean;
  /** The reading view's share of the two views' room, once its edge has been dragged. */
  readonly reading?: number | undefined;
}

/** What the reader asked for last: a panel, by its key or its button, or code beside. */
export type Asked = 'left' | 'threads' | 'beside';

/** Which of two views has focus. */
export type ViewFocus = 'reading' | 'code';

/** What can be put away: a panel, or one of two views. */
export type Part = 'left' | 'threads' | 'reading' | 'code';

/** How far an edge goes: the narrowest and widest it makes what it sizes. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

/** What's drawn. */
export interface Fitted {
  /** The left panel's width, or nothing while it isn't drawn. */
  readonly left?: number | undefined;
  /** The threads panel's width, or nothing while it isn't drawn. */
  readonly threads?: number | undefined;
  /** The views drawn, left to right: one, or with code beside the reading view and the code view. */
  readonly views: readonly number[];
  /** What the layout has open that the row has no room for, put away until it has. */
  readonly away: readonly Part[];
  /** What couldn't be drawn beside one view at its minimum, open or not, at this width. */
  readonly cramped: { readonly left: boolean; readonly threads: boolean; readonly beside: boolean };
  /**
   * How far each edge drawn goes: a panel's to its limits, with the views kept at their minimum,
   * and the one between two views as far as each keeps its own.
   */
  readonly edges: {
    readonly left?: Range | undefined;
    readonly threads?: Range | undefined;
    readonly views?: Range | undefined;
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The narrowest `count` views are drawn, with the gap between two. */
function viewsMin(count: number, sizes: Sizes): number {
  return count * sizes.view + (count - 1) * sizes.gap;
}

/**
 * What's drawn of `saved` in a row `width` wide, with `asked` asked for last and `focus` on one of
 * two views: what doesn't fit at its minimum put away, and the rest sized to the row.
 */
export function fit(
  saved: Layout,
  width: number,
  asked: Asked | undefined,
  focus: ViewFocus,
  sizes: Sizes,
): Fitted {
  const open = { left: saved.left.open, threads: saved.threads.open, beside: saved.beside };
  const needed = () =>
    (open.left ? sizes.left.min : 0) +
    (open.threads ? sizes.threads.min : 0) +
    viewsMin(open.beside ? 2 : 1, sizes);
  const order: readonly Asked[] = ['threads', 'left', 'beside'];
  const turns = asked === undefined ? order : [...order.filter((each) => each !== asked), asked];
  for (const part of turns) {
    if (needed() <= width) break;
    open[part] = false;
  }
  const away: Part[] = [];
  if (saved.left.open && !open.left) away.push('left');
  if (saved.threads.open && !open.threads) away.push('threads');
  if (saved.beside && !open.beside) away.push(focus === 'reading' ? 'code' : 'reading');
  const drawn = fitWidths(
    {
      left: { ...saved.left, open: open.left },
      threads: { ...saved.threads, open: open.threads },
      beside: open.beside,
      reading: saved.reading,
    },
    width,
    sizes,
  );
  return { ...drawn, away };
}

/**
 * What's open in `saved`, sized to a row `width` wide, with nothing put away: the views shrink to
 * their minimum, then the threads panel to its own, then the left panel, and past that the views
 * are drawn under their minimum.
 */
export function fitWidths(saved: Layout, width: number, sizes: Sizes): Fitted {
  const count = saved.beside ? 2 : 1;
  const least = viewsMin(count, sizes);
  let left = saved.left.open
    ? clamp(saved.left.width ?? sizes.left.width, sizes.left.min, sizes.left.max)
    : undefined;
  let threads = saved.threads.open
    ? clamp(saved.threads.width ?? sizes.threads.width, sizes.threads.min, sizes.threads.max)
    : undefined;
  const middle = () => width - (left ?? 0) - (threads ?? 0);
  if (threads !== undefined && middle() < least) {
    threads = Math.max(sizes.threads.min, threads - (least - middle()));
  }
  if (left !== undefined && middle() < least) {
    left = Math.max(sizes.left.min, left - (least - middle()));
  }
  const room = middle();
  const edge = (limits: Limits, other: number | undefined): Range => ({
    min: limits.min,
    max: Math.max(limits.min, Math.min(limits.max, width - (other ?? 0) - least)),
  });
  const edges = {
    left: left === undefined ? undefined : edge(sizes.left, threads),
    threads: threads === undefined ? undefined : edge(sizes.threads, left),
    views: undefined as Range | undefined,
  };
  let views: number[];
  if (count === 1) {
    views = [room];
  } else {
    const both = room - sizes.gap;
    const max = both - sizes.view;
    const wanted =
      saved.reading === undefined ? Math.min(sizes.reading, both / 2) : saved.reading * both;
    // Too narrow for both at their minimum, they split it evenly.
    const reading = max < sizes.view ? both / 2 : clamp(wanted, sizes.view, max);
    views = [reading, both - reading];
    edges.views = { min: sizes.view, max: Math.max(sizes.view, max) };
  }
  return {
    left,
    threads,
    views,
    away: [],
    cramped: {
      left: sizes.left.min + sizes.view > width,
      threads: sizes.threads.min + sizes.view > width,
      beside: viewsMin(2, sizes) > width,
    },
    edges,
  };
}
