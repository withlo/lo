// Focus that falls to the page: when the focused element leaves it, as a Try again does that goes
// once pressed, the browser drops focus on the page's body, where none of the view's keys reach
// the view. One handler on `window` gives it to the nearest part of the view still there: as focus
// moves, it notes the scopes around the focused element, and once that element has gone and left
// focus on the body, it focuses the nearest of them still on the page, or what that scope names to
// take it (`data-lo-focus`), as a code view names its text. It looks a frame on, after React's
// effects, Base UI's focus and a closing popup giving focus back, and stands aside where focus went
// anywhere by then, as to a dialog's trigger, or where the element is still on the page, as after a
// click on nothing or the window losing focus. Should the browser drop focus without a word, the
// next key pressed on the body catches it first. A view with a better place for focus than the
// scope, such as a field, puts it there itself first.

import { FOCUS_ATTRIBUTE, SCOPE_ATTRIBUTE } from './scopes.ts';

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

/**
 * What caught focus: a scope's own element, marked so it draws no ring, and given a `tabindex` if
 * it took one to take focus, or the target the scope names, which is left as it was.
 */
interface Caught {
  readonly element: HTMLElement;
  readonly marked: boolean;
  readonly madeFocusable: boolean;
}

/**
 * Starts catching focus that falls to the page in `win`. Returns a function that stops. Start it
 * before the key listener (`listen`), so that a key that catches focus goes where it was caught.
 *
 * The `window` scope is never a place to catch it: it's wherever no other scope is, which the
 * body is already, and a view that draws takes focus only from nowhere in particular. A scope
 * that can't take focus is made to (`tabIndex = -1`) only while it holds what it caught.
 */
export function catchFocus(win: Win): () => void {
  let held: Held | undefined;
  let caught: Caught | undefined;
  /** The target each scope names that had focus last, so a diff's caught focus goes to its pane. */
  const targets = new WeakMap<HTMLElement, Element>();
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaving: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };

  const release = () => {
    clearTimeout(leaving);
    leaving = undefined;
    if (!caught) return;
    if (caught.marked) caught.element.removeAttribute(CAUGHT_ATTRIBUTE);
    if (caught.madeFocusable) caught.element.removeAttribute('tabindex');
    caught = undefined;
  };

  /** Whether focus is on the page itself, on nothing in particular. */
  const onBody = () => {
    const { activeElement, body } = win.document;
    return activeElement === null || activeElement === body;
  };

  const land = (fell: Held) => {
    if (fell.element.isConnected) {
      // A click on nothing put focus on the body on purpose: it stays there, even once the element
      // goes. The window losing focus leaves it where it was, to come back to.
      if (held === fell && onBody() && win.document.hasFocus()) held = undefined;
      return;
    }
    // Something took it since: a dialog gave it back to its trigger, or a view to its own place.
    if (!onBody()) return;
    for (const scope of fell.scopes) {
      if (!scope.isConnected) continue;
      const took = take(win, scope, targets.get(scope));
      if (took === undefined) continue;
      release();
      caught = took;
      return;
    }
    // Nowhere is left to go but the window, which the body is.
    if (held === fell) held = undefined;
  };

  const onFocusIn = (event: FocusEvent) => {
    cancel();
    const into = event.target;
    if (caught && into !== caught.element) release();
    if (!(into instanceof win.Element)) {
      held = undefined;
      return;
    }
    const scopes = scopesAround(win, into);
    held = { element: into, scopes };
    const [nearest] = scopes;
    const named = nearest?.getAttribute(FOCUS_ATTRIBUTE);
    if (nearest && named && into.matches(named)) targets.set(nearest, into);
  };

  const onFocusOut = (event: FocusEvent) => {
    // Focus going on to another element doesn't fall.
    if (event.relatedTarget !== null) return;
    // What caught focus is as it was once focus leaves it for the body, though not as the window
    // loses focus, which comes back to it.
    if (caught && event.target === caught.element) {
      clearTimeout(leaving);
      leaving = setTimeout(() => {
        leaving = undefined;
        if (caught && win.document.activeElement !== caught.element) release();
      }, 0);
    }
    if (!held || event.target !== held.element) return;
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

  // A key pressed on the body with what had focus gone catches it at once, before the key is
  // matched: the browser may have dropped focus without a word, or the reader typed before the
  // frame was out.
  const onKey = () => {
    if (!held || held.element.isConnected || !onBody()) return;
    cancel();
    land(held);
  };

  const capture = { capture: true } as const;
  win.addEventListener('focusin', onFocusIn, capture);
  win.addEventListener('focusout', onFocusOut, capture);
  win.addEventListener('keydown', onKey, capture);
  return () => {
    cancel();
    release();
    win.removeEventListener('focusin', onFocusIn, capture);
    win.removeEventListener('focusout', onFocusOut, capture);
    win.removeEventListener('keydown', onKey, capture);
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
 * What `scope` names to take the focus it catches: the one that had focus last, while it's still
 * there, or else the first. Only its own, never one in a scope nested in it, as a box in the diff.
 */
function targetOf(
  win: Win,
  scope: HTMLElement,
  last: Element | undefined,
): HTMLElement | undefined {
  const named = scope.getAttribute(FOCUS_ATTRIBUTE);
  if (!named) return undefined;
  const own = (each: Element): each is HTMLElement =>
    each instanceof win.HTMLElement &&
    each.isConnected &&
    each.matches(named) &&
    each.closest(`[${SCOPE_ATTRIBUTE}]`) === scope;
  if (last && own(last)) return last;
  return [...scope.querySelectorAll(named)].find(own);
}

/**
 * Focuses what `scope` names to take focus, or else the scope itself, with no ring, made focusable
 * first if it isn't, and says what took it, or nothing if neither can, as when it's hidden or
 * inert.
 */
function take(win: Win, scope: HTMLElement, last: Element | undefined): Caught | undefined {
  const target = targetOf(win, scope, last);
  if (target) {
    target.focus({ preventScroll: true });
    if (win.document.activeElement === target) {
      return { element: target, marked: false, madeFocusable: false };
    }
  }
  const focused = () => win.document.activeElement === scope;
  scope.setAttribute(CAUGHT_ATTRIBUTE, '');
  scope.focus({ preventScroll: true });
  if (focused()) return { element: scope, marked: true, madeFocusable: false };
  if (!scope.hasAttribute('tabindex')) {
    scope.tabIndex = -1;
    scope.focus({ preventScroll: true });
    if (focused()) return { element: scope, marked: true, madeFocusable: true };
    scope.removeAttribute('tabindex');
  }
  scope.removeAttribute(CAUGHT_ATTRIBUTE);
  return undefined;
}
