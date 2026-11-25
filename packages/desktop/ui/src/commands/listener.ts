// The key path's DOM side: one keydown listener in the capture phase on `window`, which sees every
// key before widgets and CodeMirror and hands it to the registry, telling the element it's for once
// it's the reader's input, and the `Tab` backstop. A focus change and the window's blur clear the
// code view focus left and drop the pending sequence, but for one typed with focus nowhere in
// particular that goes on where Lo moved focus; a press or a click, with the pointer or without,
// drops the pending sequence.

import { holdRegistry } from './control.ts';
import { contradicts, eventStrokes, type KeyEventLike, type Layout } from './notation.ts';
import type { Registry } from './registry.ts';
import { endsTab, findScope, isEditable, isNowhere, textKind } from './scopes.ts';

type Win = Window & typeof globalThis;

/**
 * What a key sends to the element it's for, bubbling, once it's the reader's input, so what listens
 * for the reader's keys listens for this rather than `keydown`: it hears those the registry takes,
 * which go no further, and a sequence's only as it ends. A key pressed while no sequence is pending,
 * and that starts none, sends it at once, before the command it runs. While one is pending, no key
 * does, whether it goes on with the sequence, repeats as it's held, is a modifier alone or is
 * composed by the system's input method, until the sequence ends: run, broken by another key, or
 * dropped, as by a press or a click, a focus change, a command from the app menu or the wait running
 * out. Then it's sent once, before the command the sequence completes runs. So nothing that waits
 * for the reader's next input comes between the keys of a sequence, for its command to act on. A
 * command chosen in the app menu, which makes no event in the page either, is sent the same way.
 */
export const KEY_EVENT = 'lo-key';

/** The part of `navigator.keyboard` Lo reads, where Chromium has it. */
interface Keyboard {
  getLayoutMap?(): Promise<Layout>;
}

/** How `listen` checks the scopes it's given. */
export interface ListenOptions {
  /**
   * The scopes said to hold no field, so that the keys that edit text run commands there
   * (`checkEditingKeys`). Focus on an editable element whose nearest scope is one of them is
   * reported, as the check is then wrong.
   */
  readonly fieldless?: readonly string[] | undefined;
  /** Where that report goes: `console.error` unless given. */
  readonly report?: ((message: string) => void) | undefined;
}

/** What takes keys ahead of the registry while it's there, the newest first. */
const takers: ((event: KeyboardEvent) => boolean)[] = [];

/**
 * Hands every key to `take` before the registry sees it, until the function this returns is
 * called. A key `take` says it took goes no further: for what holds a key while it lasts, as a
 * drag holds `Esc`, which ends it, where the key would otherwise run a command.
 */
export function takeKeys(take: (event: KeyboardEvent) => boolean): () => void {
  takers.unshift(take);
  return () => {
    const at = takers.indexOf(take);
    if (at >= 0) takers.splice(at, 1);
  };
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
export function listen(win: Win, registry: Registry, options: ListenOptions = {}): () => void {
  const fieldless = new Set(options.fieldless);
  const report = options.report ?? ((message: string) => console.error(message));
  /** A `Tab` the browser may still act on, pressed in a scope that ends it. */
  let tab: { event: KeyboardEvent; from: Element; scope: Element } | undefined;
  let tabTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * What the keyboard's keys type on their own, once Chromium has said. Chromium says nothing when
   * the layout changes, so a key pressed on its own that disagrees with it drops it and asks
   * again; until the answer comes, keys are read as on a US keyboard.
   */
  let layout: Layout | undefined;
  /** The last key pressed on its own, which a layout must agree with to be taken. */
  let lastPlain: KeyEventLike | undefined;
  /** The newest read of the layout: an older one that answers later is ignored. */
  let reads = 0;

  const readLayout = () => {
    const keyboard: Keyboard | undefined = Reflect.get(win.navigator, 'keyboard');
    const read = ++reads;
    keyboard
      ?.getLayoutMap?.()
      .then((map) => {
        if (read !== reads) return;
        layout = lastPlain && contradicts(map, lastPlain) ? undefined : map;
      })
      .catch(() => {
        // Keys are read as on a US keyboard.
      });
  };

  /** Notes a key pressed on its own, and drops a layout it shows is out of date. */
  const checkLayout = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    const plain = {
      key: event.key,
      code: event.code,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: event.shiftKey,
      getModifierState: (name: string) => event.getModifierState(name),
    };
    lastPlain = plain;
    if (!contradicts(layout, plain)) return;
    layout = undefined;
    readLayout();
  };

  const onKey = (event: KeyboardEvent) => {
    tab = undefined;
    if (takers.some((take) => take(event))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    checkLayout(event);
    const element = focused(win, event);
    const scope = findScope(element);
    const reading = { system: registry.system, layout };
    const handled = registry.handle(
      { strokes: eventStrokes(event, reading), repeat: event.repeat, composing: composing(event) },
      {
        scope,
        text: textKind(element),
        nowhere: isNowhere(element),
        editable: isEditable(element),
      },
      () =>
        (element ?? win.document.body).dispatchEvent(new win.Event(KEY_EVENT, { bubbles: true })),
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
    const into = event.target instanceof win.Element ? event.target : null;
    const intoScope = findScope(into);
    if (fieldless.has(intoScope.name) && isEditable(into)) {
      report(
        `\`${intoScope.name}\` is listed as holding no field, but a field there has focus: the keys that edit text run commands in it.`,
      );
    }
    registry.focusMoved({ scope: intoScope, text: textKind(into) }, undefined);
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
    const to = event.relatedTarget instanceof win.Element ? event.relatedTarget : null;
    const scope = findScope(to);
    // Focus moving within one scope, to Vim's prompt say, leaves its Vim as it is. A box nested
    // in the diff is a scope of its own: focus moving there leaves the diff.
    const leaving = from?.element && scope.element !== from.element ? from.source : undefined;
    registry.focusMoved({ scope, text: textKind(to) }, leaving);
  };

  const onBlur = (event: FocusEvent) => {
    // An element's blur passes through here too; focusout has it.
    if (event.target instanceof win.Node) return;
    registry.leave(findScope(win.document.activeElement).source);
  };

  // The reader pressing, clicking or asking for a right-click menu, with the pointer or without:
  // VoiceOver's and Voice Control's presses make a mouse down and a click but no pointer down, and
  // VoiceOver's menu key makes a right-click menu alone. Wherever the press moves focus, the held
  // keys are gone before the next key. Focus VoiceOver moves by itself reaches the page as a move
  // like Lo's own, so it can't be told apart.
  const onPress = () => {
    tab = undefined;
    registry.drop();
  };
  const presses = ['pointerdown', 'mousedown', 'click', 'contextmenu'] as const;

  const capture = { capture: true } as const;
  win.addEventListener('keydown', onKey, capture);
  win.addEventListener('keydown', backstop);
  win.addEventListener('focusin', onFocusIn, capture);
  win.addEventListener('focusout', onFocusOut, capture);
  for (const type of presses) win.addEventListener(type, onPress, capture);
  win.addEventListener('blur', onBlur, capture);
  // The keyboard's layout, read again whenever the window comes back, in case it changed.
  win.addEventListener('focus', readLayout);
  readLayout();
  // The window's controls run their commands through the registry its keys go through.
  const release = holdRegistry(registry);

  return () => {
    release();
    clearTimeout(tabTimer);
    win.removeEventListener('keydown', onKey, capture);
    win.removeEventListener('keydown', backstop);
    win.removeEventListener('focusin', onFocusIn, capture);
    win.removeEventListener('focusout', onFocusOut, capture);
    for (const type of presses) win.removeEventListener(type, onPress, capture);
    win.removeEventListener('blur', onBlur, capture);
    win.removeEventListener('focus', readLayout);
  };
}

/**
 * The element a key event is for: its target, or the focused element. A key pressed on the body is
 * for what focus went to while it was dispatched, as when `catchFocus` caught it first.
 */
function focused(win: Win, event: Event): Element | null {
  const { activeElement, body } = win.document;
  if (event.target === body && activeElement !== null && activeElement !== body)
    return activeElement;
  return event.target instanceof win.Element ? event.target : activeElement;
}

/** Whether a key is part of an IME composition, including the keydown that starts one. */
function composing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
