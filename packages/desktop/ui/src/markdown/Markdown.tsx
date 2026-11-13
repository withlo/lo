import { useCallback, useId, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';

import { DEFAULT_LIMITS, type Extension, type Image, type Plain, type Tree } from '@lo/markdown';

import {
  firstImages,
  MarkdownBlocks,
  MarkdownNotes,
  MarkdownProvider,
  type Followed,
  type MarkdownExtension,
  type Rendering,
} from './render.tsx';
import { Anchors, generationOf, scopePrefix } from './scope.ts';

export interface MarkdownProps<X extends Extension = Plain> {
  tree: Tree<X>;
  /**
   * A link was followed, from `from`. A web target is always an `https://` page, for main to
   * open. The document has already moved to an anchor; it says so here too.
   */
  onFollow?: ((target: Followed<X>, from: Element) => void) | undefined;
  extension?: MarkdownExtension<X> | undefined;
  /**
   * Where to load an image from, by its address on one of GitHub's image hosts: an address on Lo's
   * image scheme, which main serves, or nothing to show it as a link. Only the first
   * {@link MAX_IMAGES} images in the text load; without this, none do.
   */
  images?: ((url: string) => string | undefined) | undefined;
  className?: string | undefined;
}

/** The most images a text shows: as many as `@lo/markdown` keeps in a post. */
export const MAX_IMAGES = DEFAULT_LIMITS.images;

const NONE: MarkdownExtension<Extension> = {};

/** Text from anyone, such as a comment, drawn as Lo's own elements, with its anchors scoped to it. */
export function Markdown<X extends Extension = Plain>({
  tree,
  onFollow,
  extension,
  images,
  className,
}: MarkdownProps<X>) {
  const prefix = scopePrefix(useId());
  const anchors = useMemo(() => new Anchors(prefix, tree.blocks), [prefix, tree.blocks]);
  const image = useMemo(() => {
    if (!images) return undefined;
    const first = firstImages(tree.blocks, MAX_IMAGES);
    return (node: Image) => (first.has(node) ? images(node.url) : undefined);
  }, [images, tree.blocks]);
  const root = useRef<HTMLDivElement | null>(null);
  const follow = useCallback(
    (target: Followed<X>, from: Element) => {
      if (target.kind === 'anchor' && 'name' in target && typeof target.name === 'string') {
        reveal(root.current, anchors.id(target.name));
      }
      onFollow?.(target, from);
    },
    [anchors, onFollow],
  );
  const rendering = useMemo<Rendering<X>>(
    () => ({ anchors, follow, extension: extension ?? NONE, interactive: true, image }),
    [anchors, follow, extension, image],
  );
  return (
    <MarkdownProvider rendering={rendering}>
      {/* A new tree is drawn afresh, its folds closed or open as it says. */}
      <div key={generationOf(tree)} ref={root} className={className}>
        <MarkdownBlocks blocks={tree.blocks} />
        <MarkdownNotes notes={tree.notes} />
      </div>
    </MarkdownProvider>
  );
}

/**
 * Brings the element with id `id` into view and gives it focus, when it's inside `within`: an
 * anchor's id is the document's own, so this never reaches past the document. A closed fold around
 * it opens first, and a tab panel around it that isn't shown is chosen through its tab, so what
 * a link names is always there to see.
 */
export function reveal(within: Element | null, id: string | undefined): HTMLElement | undefined {
  if (!within || id === undefined) return undefined;
  const element = within.ownerDocument.getElementById(id);
  if (!element || !within.contains(element) || !(element instanceof HTMLElement)) return undefined;
  const hidden = hiders(element, within);
  if (hidden.length > 0) {
    // Drawn at once, so the element is on the page to scroll to.
    flushSync(() => {
      for (const hider of hidden) show(hider);
    });
  }
  // jsdom has no scrolling.
  if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'start' });
  element.focus({ preventScroll: true });
  return element;
}

/** What hides `element`, inside `within`: closed folds and tab panels not shown, outermost first. */
function hiders(element: Element, within: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let at = element.parentElement; at && at !== within; at = at.parentElement) {
    const closedFold = at.localName === 'details' && !at.hasAttribute('open');
    const hiddenPanel = at.getAttribute('role') === 'tabpanel' && at.hasAttribute('hidden');
    if ((closedFold || hiddenPanel) && at instanceof HTMLElement) found.unshift(at);
  }
  return found;
}

/**
 * Shows a closed fold or a tab panel, as the reader would: the fold through its title, the panel
 * through its tab, so what draws them knows they're shown.
 */
function show(hider: HTMLElement): void {
  if (hider.localName === 'details') {
    const title = [...hider.children].find((child) => child.localName === 'summary');
    if (title instanceof HTMLElement) title.click();
    else hider.setAttribute('open', '');
    return;
  }
  const tab = hider.getAttribute('aria-labelledby');
  const button = tab === null ? null : hider.ownerDocument.getElementById(tab);
  button?.click();
}
