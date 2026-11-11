/**
 * What an overview adds to Lo's tree. An overview is `@lo/markdown`'s tree with the format's
 * blocks and two more kinds of target, so a renderer is the same closed switch over `kind`, with
 * these cases added. Like the rest of the tree, it's plain data.
 *
 * What a renderer must do with it, beyond what `@lo/markdown` asks:
 *
 * - Fill each `excerpt` and each step's code view from the repository at the overview's commit,
 *   never from the overview.
 * - Show a figure only as `checkArtifact` kept it. Draw an SVG from the tree the check made, never
 *   from its file again. Show an image from `figures/` in the overview's own commit only as an
 *   image of the type the check read, never letting a browser guess its type or open it as a page,
 *   and decode it, every frame included, no larger than the size the check read.
 * - Link only the parts the check kept for that block, each a name inside its figure, scoped as
 *   anchors are.
 */

import type { Block, Extension, Target, Tree } from '@lo/markdown';

/** Lines of a file, counting from 1, both ends included. */
export interface Lines {
  start: number;
  end: number;
}

/**
 * Code in the repository at the overview's commit: a file, or some of its lines. The path is
 * relative to the repository's root, holds no `.`, `..`, empty or `.git` part and no control
 * character, and is compared with the repository's paths byte for byte.
 */
export interface CodeTarget {
  kind: 'code';
  path: string;
  /** Left out when the target is the whole file, which only a link may name. */
  lines?: Lines;
}

/** Code with its lines, as a code block or a walkthrough's step names it. */
export interface CodeRange extends CodeTarget {
  lines: Lines;
}

/** A term the glossary defines, by its key. */
export interface TermTarget {
  kind: 'term';
  /** The term's name in lower case, with each run of white space as one space. */
  key: string;
}

/** The format's additions to the tree. */
export interface Overview extends Extension {
  block: Excerpt | Figure | Walkthrough | Tabs | Glossary;
  inline: never;
  target: CodeTarget | TermTarget;
}

/** A `:::code` block: lines of the repository's code, which the renderer reads and shows. */
export interface Excerpt {
  kind: 'excerpt';
  target: CodeRange;
}

/** A `:::figure` block. */
export interface Figure {
  kind: 'figure';
  /** `figures/` and the file's name. */
  path: string;
  caption: Block<Overview>[];
  /** The figure's parts that link somewhere, in the order written. Each id is used once. */
  parts: FigurePart[];
}

export interface FigurePart {
  /** The id of an element in the figure. */
  id: string;
  /** Code, a term or a section. */
  target: Target<Overview>;
}

/** A `:::walkthrough` block: ordered steps, each tied to lines of code. */
export interface Walkthrough {
  kind: 'walkthrough';
  title: string;
  steps: Step[];
}

export interface Step {
  target: CodeRange;
  children: Block<Overview>[];
}

/** A `:::tabs` block. */
export interface Tabs {
  kind: 'tabs';
  tabs: Tab[];
}

export interface Tab {
  title: string;
  children: Block<Overview>[];
}

/** The items of the `## Glossary` section, which replace its list. */
export interface Glossary {
  kind: 'glossary';
  /** In the order written. Each key is defined once. */
  terms: Definition[];
}

export interface Definition {
  /** The term as the glossary writes it. */
  name: string;
  /** What `term:` links name it by: see {@link TermTarget}. */
  key: string;
  children: Block<Overview>[];
}

/** An overview's tree. A `:::fold` is `@lo/markdown`'s `details` block, closed. */
export type OverviewTree = Tree<Overview>;
export type OverviewBlock = Block<Overview>;
