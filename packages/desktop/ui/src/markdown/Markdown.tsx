import { useCallback, useId, useMemo, useRef } from 'react';

import type { Extension, Plain, Tree } from '@lo/markdown';

import {
  MarkdownBlocks,
  MarkdownNotes,
  MarkdownProvider,
  type Followed,
  type MarkdownExtension,
  type Rendering,
} from './render.tsx';
import { Anchors, scopePrefix } from './scope.ts';

export interface MarkdownProps<X extends Extension = Plain> {
  tree: Tree<X>;
  /**
   * A link was followed, from `from`. A web target is always an `https://` page, for main to
   * open. The document has already moved to an anchor; it says so here too.
   */
  onFollow?: ((target: Followed<X>, from: HTMLElement) => void) | undefined;
  extension?: MarkdownExtension<X> | undefined;
  className?: string | undefined;
}

const NONE: MarkdownExtension<Extension> = {};

/** Text from anyone, such as a comment, drawn as Lo's own elements, with its anchors scoped to it. */
export function Markdown<X extends Extension = Plain>({
  tree,
  onFollow,
  extension,
  className,
}: MarkdownProps<X>) {
  const prefix = scopePrefix(useId());
  const anchors = useMemo(() => new Anchors(prefix, tree.blocks), [prefix, tree.blocks]);
  const root = useRef<HTMLDivElement | null>(null);
  const follow = useCallback(
    (target: Followed<X>, from: HTMLElement) => {
      if (target.kind === 'anchor' && 'name' in target && typeof target.name === 'string') {
        reveal(root.current, anchors.id(target.name));
      }
      onFollow?.(target, from);
    },
    [anchors, onFollow],
  );
  const rendering = useMemo<Rendering<X>>(
    () => ({ anchors, follow, extension: extension ?? NONE, interactive: true }),
    [anchors, follow, extension],
  );
  return (
    <MarkdownProvider rendering={rendering}>
      <div ref={root} className={className}>
        <MarkdownBlocks blocks={tree.blocks} />
        <MarkdownNotes notes={tree.notes} />
      </div>
    </MarkdownProvider>
  );
}

/**
 * Brings the element with id `id` into view and gives it focus, when it's inside `within`: an
 * anchor's id is the document's own, so this never reaches past the document.
 */
export function reveal(within: Element | null, id: string | undefined): HTMLElement | undefined {
  if (!within || id === undefined) return undefined;
  const element = within.ownerDocument.getElementById(id);
  if (!element || !within.contains(element) || !(element instanceof HTMLElement)) return undefined;
  // jsdom has no scrolling.
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' });
  element.focus({ preventScroll: true });
  return element;
}
