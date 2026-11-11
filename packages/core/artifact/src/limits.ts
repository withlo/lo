/**
 * The limits an overview is read under. An overview comes from anyone who can push to a pull
 * request's repository, so each is a bound on the work reading it takes, and each is part of the
 * format: `format.md` lists them, and an overview past one is refused, never cut short.
 */

/** The newest format this package reads. It reads every format up to this one. */
export const FORMAT: number = 1;

export const LIMITS = Object.freeze({
  /** The most bytes of UTF-8 in `artifact.md`, a byte-order mark aside. */
  size: 256 * 1024,
  /** The most nodes in its tree, as `@lo/markdown` counts them. */
  nodes: 65_536,
  /** How deep its tree may nest, as `@lo/markdown` counts it. */
  depth: 16,
  /** The most places it points: code, terms and sections, from blocks, steps and links. */
  targets: 500,
  /** The most `:::figure` blocks. */
  figures: 100,
  /** The most steps in one walkthrough. */
  steps: 50,
  /** The most tabs in one `:::tabs` block. */
  tabs: 12,
  /** How deep `:::` blocks may nest. */
  nesting: 4,
  /** The most lines a code block or a step shows. */
  lines: 200,
  /** The most bytes of UTF-8 in a block's argument or a link's target. */
  argument: 1_024,
  /** The most findings reported; errors are kept before warnings. */
  findings: 100,
  /** The most files and folders in the overview's commit. */
  entries: 500,
  /** The most bytes in the overview's commit, figures included. */
  commit: 50 * 1024 * 1024,
  /** The most bytes of a file a target names that Lo reads to show its lines. */
  file: 10 * 1024 * 1024,
  /** The most bytes of code Lo reads for one overview: every file its targets name, together. */
  code: 64 * 1024 * 1024,
  /** The most bytes in an image figure: a PNG, JPEG, GIF or WebP. */
  image: 10 * 1024 * 1024,
  /** The most pixels an image figure is on either side. */
  side: 16_384,
  /** The most pixels in an image figure, its width times its height. */
  pixels: 40_000_000,
  /** The most bytes in an SVG figure: `SVG_LIMITS.size`, as bytes. */
  svg: 512 * 1024,
  /** The most bytes of SVG Lo reads for one overview: every SVG figure it shows, together. */
  svgs: 2 * 1024 * 1024,
});

/**
 * The most bytes of `artifact.md` to read to parse it: its limit, and a byte-order mark. A larger
 * one is too large, and isn't read at all.
 */
export const ARTIFACT_READ = LIMITS.size + 3;

/** How much of the start of a file is looked at for a NUL byte, which makes it binary. */
export const BINARY_WINDOW = 8 * 1024;

/**
 * How much of the start of a figure is read first: enough for its type, and nearly always for an
 * image's header. Only an SVG, or an image whose header goes on past this, is read further.
 */
export const FIGURE_HEAD = 4 * 1024;

/**
 * How long reading an overview's code and figures may take unless the caller says, in
 * milliseconds.
 */
export const CHECK_TIMEOUT = 30_000;

/** The fewest steps in a walkthrough: with fewer, prose reads better. */
export const MIN_STEPS = 3;

/** The fewest tabs in a `:::tabs` block. */
export const MIN_TABS = 2;

/** The most characters of the start of `artifact.md` the header is looked for in. */
export const HEADER_WINDOW = 4_096;
