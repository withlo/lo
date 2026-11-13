// Whether an element is on screen or near it, within the area its nearest scrolling box shows and
// as much again above and below, which posts use to ask for their HTML before they're reached. One
// observer watches every element of a scrolling box.

/** How far past what its scrolling box shows an element counts as near: the box's height again. */
const MARGIN = '100% 0px';

const observers = new WeakMap<Element | Document, IntersectionObserver>();
const listeners = new WeakMap<Element, (near: boolean) => void>();

/** The nearest box around `element` that scrolls up and down, or the document. */
function scrollerOf(element: Element): Element | Document {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return element.ownerDocument;
}

/**
 * Calls `listener` with whether `element` is on screen or near it, as that changes, until the
 * returned function is called. Where the window can't tell, as in a test without layout, it's near.
 */
export function watchNear(element: Element, listener: (near: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    listener(true);
    return () => {};
  }
  const root = scrollerOf(element);
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: MARGIN },
    );
    observers.set(root, observer);
  }
  const watching = observer;
  listeners.set(element, listener);
  watching.observe(element);
  return () => {
    watching.unobserve(element);
    listeners.delete(element);
  };
}

/**
 * Whether `element` is where the reader can see it: drawn, not hidden, and not in a part of the
 * window that's set aside, as a middle view is while another is on screen.
 */
export function seen(element: Element | null): boolean {
  if (!element?.isConnected || element.closest('[inert]') !== null) return false;
  return typeof element.checkVisibility === 'function'
    ? element.checkVisibility({ visibilityProperty: true })
    : true;
}
