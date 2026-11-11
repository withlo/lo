// The key path's DOM side: one keydown listener in the capture phase on `window`, which sees every
// key before widgets and CodeMirror and hands it to the registry, and a backstop in the bubble
// phase, which ends any `Tab` that reached `window` unhandled, so focus moves only through
// commands. A focus change, a pointer down and the window's blur drop the pending sequence.

import { eventStroke } from './notation.ts';
import type { Registry } from './registry.ts';
import { findScope, isTextField } from './scopes.ts';

type Win = Window & typeof globalThis;

/** Starts listening for keys in `win`. Returns a function that stops. */
export function listen(win: Win, registry: Registry): () => void {
  const onKey = (event: KeyboardEvent) => {
    const stroke = eventStroke(event);
    if (!stroke) return;
    const element = focused(win, event);
    const handled = registry.handle(
      { stroke, repeat: event.repeat, composing: composing(event) },
      { scope: findScope(element), text: isTextField(element) },
    );
    if (handled.kind === 'pass') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (handled.kind === 'arrow') {
      const arrow = { key: handled.key, code: handled.key, bubbles: true, cancelable: true };
      (element ?? win.document.body).dispatchEvent(new win.KeyboardEvent('keydown', arrow));
    }
  };

  // `Tab` and `⇧Tab` that nothing handled would move focus out of the scope: a box's next
  // letters would then run as the diff's keys. A dialog keeps the browser's focus order.
  const backstop = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.defaultPrevented || composing(event)) return;
    if (findScope(focused(win, event)).name === 'dialog') return;
    event.preventDefault();
  };

  const drop = () => {
    registry.drop();
  };

  const capture = { capture: true } as const;
  win.addEventListener('keydown', onKey, capture);
  win.addEventListener('keydown', backstop);
  win.addEventListener('focusin', drop, capture);
  win.addEventListener('focusout', drop, capture);
  win.addEventListener('pointerdown', drop, capture);
  // The window's own blur, and every element's, which don't bubble but pass through capture.
  win.addEventListener('blur', drop, capture);
  return () => {
    win.removeEventListener('keydown', onKey, capture);
    win.removeEventListener('keydown', backstop);
    win.removeEventListener('focusin', drop, capture);
    win.removeEventListener('focusout', drop, capture);
    win.removeEventListener('pointerdown', drop, capture);
    win.removeEventListener('blur', drop, capture);
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
