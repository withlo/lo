// The key path's DOM side: one keydown listener in the capture phase on `window`, which sees every
// key before widgets and CodeMirror and hands it to the registry, and the `Tab` backstop. A focus
// change and the window's blur drop the pending sequence and clear the code view focus left; a
// pointer down drops the pending sequence.

import { eventStrokes, type Layout } from './notation.ts';
import type { Registry } from './registry.ts';
import { endsTab, findScope, textKind } from './scopes.ts';

type Win = Window & typeof globalThis;

/** The part of `navigator.keyboard` Lo reads, where Chromium has it. */
interface Keyboard {
  getLayoutMap?(): Promise<Layout>;
}

/**
 * Starts listening for keys in `win`. Returns a function that stops.
 *
 * The backstop keeps `Tab` from moving focus between Lo's scopes, where it only moves by commands:
 * otherwise a box would hand its next letters to the diff, or the tree its keys to whatever follows
 * it. A `Tab` that reaches `window` unhandled, with any modifiers, is ended in the bubble phase,
 * except where `endsTab` leaves it to the browser. One a widget stopped on the way never reaches
 * `window`, so the capture phase notes each `Tab` in a scope, and when the browser then moves focus
 * out of it, focus is sent back. Focus a widget moves itself, while handling the key, stays where
 * it went.
 */
export function listen(win: Win, registry: Registry): () => void {
  /** A `Tab` the browser may still act on, pressed in a scope that ends it. */
  let tab: { event: KeyboardEvent; from: Element; scope: Element } | undefined;
  let tabTimer: ReturnType<typeof setTimeout> | undefined;
  /** What the keyboard's keys type on their own, once Chromium has said. */
  let layout: Layout | undefined;

  const readLayout = () => {
    const keyboard: Keyboard | undefined = Reflect.get(win.navigator, 'keyboard');
    keyboard
      ?.getLayoutMap?.()
      .then((map) => {
        layout = map;
      })
      .catch(() => {
        // Keys are read as on a US keyboard.
      });
  };

  const onKey = (event: KeyboardEvent) => {
    tab = undefined;
    const element = focused(win, event);
    const scope = findScope(element);
    const handled = registry.handle(
      { strokes: eventStrokes(event, layout), repeat: event.repeat, composing: composing(event) },
      { scope, text: textKind(element) },
    );
    if (handled.kind === 'pass') {
      const ended = element && scope.element && endsTab(scope, element);
      if (event.key === 'Tab' && !composing(event) && ended) {
        tab = { event, from: element, scope: scope.element };
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
    const element = focused(win, event);
    if (endsTab(findScope(element), element)) event.preventDefault();
  };

  const onFocusIn = (event: FocusEvent) => {
    registry.drop();
    const noted = tab;
    if (!noted || !(event.target instanceof win.Node)) return;
    if (noted.scope.contains(event.target) || !noted.from.isConnected) return;
    // Only the browser's own move, after the event and because nothing prevented it. A widget's
    // move while it handles the key happens during the event, and is the widget's to make.
    if (noted.event.eventPhase !== Event.NONE || noted.event.defaultPrevented) return;
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

  const onPointer = () => {
    tab = undefined;
    registry.drop();
  };

  const capture = { capture: true } as const;
  win.addEventListener('keydown', onKey, capture);
  win.addEventListener('keydown', backstop);
  win.addEventListener('focusin', onFocusIn, capture);
  win.addEventListener('focusout', onFocusOut, capture);
  win.addEventListener('pointerdown', onPointer, capture);
  win.addEventListener('blur', onBlur, capture);
  // The keyboard's layout, read again whenever the window comes back, in case it changed.
  win.addEventListener('focus', readLayout);
  readLayout();
  return () => {
    clearTimeout(tabTimer);
    win.removeEventListener('keydown', onKey, capture);
    win.removeEventListener('keydown', backstop);
    win.removeEventListener('focusin', onFocusIn, capture);
    win.removeEventListener('focusout', onFocusOut, capture);
    win.removeEventListener('pointerdown', onPointer, capture);
    win.removeEventListener('blur', onBlur, capture);
    win.removeEventListener('focus', readLayout);
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
