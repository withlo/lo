// The key path's DOM side: one keydown listener in the capture phase on `window`, which sees every
// key before widgets and CodeMirror and hands it to the registry, and the `Tab` backstop. A focus
// change and the window's blur drop the pending sequence and clear the code view focus left; a
// pointer down drops the pending sequence.

import { eventStrokes } from './notation.ts';
import type { Registry } from './registry.ts';
import { findScope, keepsTab, textKind } from './scopes.ts';

type Win = Window & typeof globalThis;

/**
 * Starts listening for keys in `win`. Returns a function that stops.
 *
 * The backstop keeps `Tab` from moving focus out of a code view or a box, whose next letters would
 * otherwise run somewhere else: focus leaves them only through commands. A `Tab` that reaches
 * `window` unhandled there, with any modifiers, is ended in the bubble phase. One a widget stopped
 * on the way without preventing it never reaches `window`, so the capture phase notes each such
 * `Tab`, and focus it moves out of the scope is sent back. Everywhere else, form fields keep the
 * browser's `Tab`.
 */
export function listen(win: Win, registry: Registry): () => void {
  /** A `Tab` the browser may still act on, pressed in a scope that keeps `Tab`. */
  let tab: { from: Element; scope: Element } | undefined;
  let tabTimer: ReturnType<typeof setTimeout> | undefined;

  const onKey = (event: KeyboardEvent) => {
    tab = undefined;
    const element = focused(win, event);
    const scope = findScope(element);
    const handled = registry.handle(
      { strokes: eventStrokes(event), repeat: event.repeat, composing: composing(event) },
      { scope, text: textKind(element) },
    );
    if (handled.kind === 'pass') {
      const kept = element && scope.element && keepsTab(scope.name);
      if (event.key === 'Tab' && !composing(event) && kept) {
        tab = { from: element, scope: scope.element };
        // The browser moves focus after the event, before any task runs.
        clearTimeout(tabTimer);
        tabTimer = setTimeout(() => {
          tab = undefined;
        }, 0);
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (handled.kind === 'arrow') {
      const arrow = { key: handled.key, code: handled.key, bubbles: true, cancelable: true };
      (element ?? win.document.body).dispatchEvent(new win.KeyboardEvent('keydown', arrow));
    }
  };

  const backstop = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.defaultPrevented || composing(event)) return;
    if (keepsTab(findScope(focused(win, event)).name)) event.preventDefault();
  };

  const onFocusIn = (event: FocusEvent) => {
    registry.drop();
    const noted = tab;
    if (!noted || !(event.target instanceof win.Node)) return;
    if (noted.scope.contains(event.target) || !noted.from.isConnected) return;
    // An unhandled `Tab` moved focus out of a scope that keeps it: send it back.
    tab = undefined;
    if (noted.from instanceof win.HTMLElement || noted.from instanceof win.SVGElement) {
      noted.from.focus();
    }
  };

  const onFocusOut = (event: FocusEvent) => {
    const from = event.target instanceof win.Element ? findScope(event.target) : undefined;
    const to = event.relatedTarget instanceof win.Node ? event.relatedTarget : null;
    // Focus moving within one code view, to Vim's prompt say, leaves Vim as it is.
    const leaving = from?.element && !(to && from.element.contains(to)) ? from.source : undefined;
    registry.leave(leaving);
  };

  const onBlur = (event: FocusEvent) => {
    // An element's blur passes through here too; focusout has it.
    if (event.target instanceof win.Node) return;
    registry.leave(findScope(win.document.activeElement).source);
  };

  const drop = () => {
    registry.drop();
  };

  const capture = { capture: true } as const;
  win.addEventListener('keydown', onKey, capture);
  win.addEventListener('keydown', backstop);
  win.addEventListener('focusin', onFocusIn, capture);
  win.addEventListener('focusout', onFocusOut, capture);
  win.addEventListener('pointerdown', drop, capture);
  win.addEventListener('blur', onBlur, capture);
  return () => {
    clearTimeout(tabTimer);
    win.removeEventListener('keydown', onKey, capture);
    win.removeEventListener('keydown', backstop);
    win.removeEventListener('focusin', onFocusIn, capture);
    win.removeEventListener('focusout', onFocusOut, capture);
    win.removeEventListener('pointerdown', drop, capture);
    win.removeEventListener('blur', onBlur, capture);
  };
}

/** The element a key event is for: its target, or the focused element. */
function focused(win: Win, event: Event): Element | null {
  return event.target instanceof win.Element ? event.target : win.document.activeElement;
}

/** Whether a key is part of an IME composition, including the keydown that starts one. */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
