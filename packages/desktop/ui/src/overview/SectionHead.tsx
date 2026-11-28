// An overview section's heading, which folds the section: its chevron in the article's 20 px of
// room at its left, the heading, and its `⋯` at the measure's right edge. Nothing is hidden by a
// fold: a collapsed section keeps its heading where it is, in `lo-fg-muted`, and a click on its
// words opens it again. The tl;dr's heading has neither chevron nor menu: it never collapses.

import type { ReactNode, Ref } from 'react';

import { runControl } from '../commands/control.ts';
import { MoreButton } from '../MoreButton.tsx';
import { Chevron } from './Chevron.tsx';
import type { TermHint } from './TermCard.tsx';

export interface SectionHeadProps {
  /** The heading's words, as the overview draws them. */
  children: ReactNode;
  /** The heading as plain text, for its `⋯`: "More actions for Why". */
  name: string;
  /** The heading's id, its anchor, which the outline and links go to. */
  id?: string | undefined;
  /** It takes focus when a link moves to it: `-1`, as a heading in an overview does. */
  tabIndex?: number | undefined;
  /** The section is open, with what's under its heading. */
  open: boolean;
  /**
   * The command its chevron runs, Collapse section and then Expand section, on the section; a click
   * on its words while it's collapsed runs it too. None for the tl;dr's heading: no chevron.
   */
  fold?: Pick<TermHint, 'command' | 'target'> | undefined;
  /** It has a menu, which its `⋯` opens under itself, as a right-click on it does. Not the tl;dr. */
  menu?: boolean | undefined;
  /** What's under the heading, by its id, which the chevron opens and closes. */
  controls?: string | undefined;
  /** The heading itself. */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
}

/**
 * An `h2` of an overview's article with its chevron, in `lo-fg-subtle` until the pointer or focus
 * is on it, and its `⋯`, drawn only under the pointer or with focus in the heading. It draws what
 * it's given: what's under the heading is the caller's, which draws nothing while it's collapsed.
 */
export function SectionHead({
  children,
  name,
  id,
  tabIndex,
  open,
  fold,
  menu = false,
  controls,
  headingRef,
}: SectionHeadProps) {
  // Collapsed, its words take a click, which opens it. Open, they're text to select.
  const opens = !open && fold !== undefined ? fold : undefined;
  return (
    <div className="lo-section-head group/head" data-collapsed={opens ? '' : undefined}>
      {fold !== undefined && (
        <span className="lo-section-head__chevron">
          <Chevron command={fold} open={open} controls={open ? controls : undefined} />
        </span>
      )}
      <h2
        ref={headingRef}
        id={id}
        tabIndex={tabIndex}
        onClick={opens ? () => runControl(opens.command, opens.target) : undefined}
      >
        {children}
      </h2>
      {menu && (
        <span className="lo-section-head__more invisible group-focus-within/head:visible group-hover/head:visible">
          <MoreButton label={`More actions for ${name}`} />
        </span>
      )}
    </div>
  );
}
