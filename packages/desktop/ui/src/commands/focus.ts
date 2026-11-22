// Focus that falls to the page: when the focused element leaves it, as a Try again does that goes
// once pressed, the browser drops focus on the page's body, where none of the view's keys reach
// the view. One handler on `window` gives it to the nearest part of the view still there: as focus
// moves, it notes the scopes around the focused element, and once that element has gone and left
// focus on the body, it focuses the nearest of them still on the page. It looks a frame on, after
// React's effects, Base UI's focus and a closing popup giving focus back, and stands aside where
// focus went anywhere by then, as to a dialog's trigger, or where the element is still on the page,
// as after a click on nothing or the window losing focus. A view with a better place for focus
// than the scope, such as a field, puts it there itself first.

import { SCOPE_ATTRIBUTE } from './scopes.ts';

type Win = Window & typeof globalThis;

/**
 * The attribute on a scope while it holds focus it caught this way. It draws no ring: what's
 * focused in it shows as it always does, and the reader didn't put focus on the scope itself.
 */
export const CAUGHT_ATTRIBUTE = 'data-lo-caught';

/** The focused element, and the scopes around it, the nearest first. */
interface Held {
  readonly element: Element;
  readonly scopes: readonly HTMLElement[];
}

/** A scope that caught focus, and whether it was given a `tabindex` to take it. */
interface Caught {
  readonly scope: HTMLElement;
  readonly madeFocusable: boolean;
}

/**
 * Starts catching focus that falls to the page in `win`. Returns a function that stops.
 *
 * The `window` scope is never a place to catch it: it's wherever no other scope is, which the
 * body is already, and a view that draws takes focus only from nowhere in particular. A scope
 * that can't take focus is made to (`tabIndex = -1`) only while it holds what it caught.
 */
export function catchFocus(win: Win): () => void {
  let held: Held | undefined;
  let caught: Caught | undefined;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };

  const release = () => {
    if (!caught) return;
    caught.scope.removeAttribute(CAUGHT_ATTRIBUTE);
    if (caught.madeFocusable) caught.scope.removeAttribute('tabindex');
    caught = undefined;
  };

  const land = (fell: Held) => {
    // Still on the page, focus left it by a click on nothing or the window losing focus.
    if (fell.element.isConnected) return;
    // Something took it since: a dialog gave it back to its trigger, or a view to its own place.
    const { activeElement, body } = win.document;
    if (activeElement !== null && activeElement !== body) return;
    for (const scope of fell.scopes) {
      if (!scope.isConnected) continue;
      const took = take(win, scope);
      if (took === undefined) continue;
      release();
      caught = took;
      return;
    }
  };

  const onFocusIn = (event: FocusEvent) => {
    cancel();
    const into = event.target;
    if (caught && into !== caught.scope) release();
    held =
      into instanceof win.Element ? { element: into, scopes: scopesAround(win, into) } : undefined;
  };

  const onFocusOut = (event: FocusEvent) => {
    // Focus going on to another element doesn't fall.
    if (event.relatedTarget !== null || !held || event.target !== held.element) return;
    const fell = held;
    cancel();
    // The browser drops focus as the element goes, before it's gone: look once all else has run.
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      timer = setTimeout(() => {
        timer = undefined;
        land(fell);
      }, 0);
    });
  };

  const capture = { capture: true } as const;
  win.addEventListener('focusin', onFocusIn, capture);
  win.addEventListener('focusout', onFocusOut, capture);
  return () => {
    cancel();
    release();
    win.removeEventListener('focusin', onFocusIn, capture);
    win.removeEventListener('focusout', onFocusOut, capture);
  };
}

/** The scopes around `element`, itself among them, the nearest first, but the `window` scope. */
function scopesAround(win: Win, element: Element): HTMLElement[] {
  const scopes: HTMLElement[] = [];
  let scope = element.closest(`[${SCOPE_ATTRIBUTE}]`);
  while (scope) {
    if (scope instanceof win.HTMLElement && scope.getAttribute(SCOPE_ATTRIBUTE) !== 'window') {
      scopes.push(scope);
    }
    scope = scope.parentElement?.closest(`[${SCOPE_ATTRIBUTE}]`) ?? null;
  }
  return scopes;
}

/**
 * Focuses `scope`, with no ring, making it focusable first if it isn't, and says how, or nothing
 * if it can't take focus, as when it's hidden or inert.
 */
function take(win: Win, scope: HTMLElement): Caught | undefined {
  const focused = () => win.document.activeElement === scope;
  scope.setAttribute(CAUGHT_ATTRIBUTE, '');
  scope.focus({ preventScroll: true });
  if (focused()) return { scope, madeFocusable: false };
  if (!scope.hasAttribute('tabindex')) {
    scope.tabIndex = -1;
    scope.focus({ preventScroll: true });
    if (focused()) return { scope, madeFocusable: true };
    scope.removeAttribute('tabindex');
  }
  scope.removeAttribute(CAUGHT_ATTRIBUTE);
  return undefined;
}
