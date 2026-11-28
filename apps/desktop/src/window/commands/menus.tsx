// Right-click menus: the menu of what was clicked, or of what has focus when its key asks, read
// live from the registry. A menu runs a command through `registry().run`, the handler a key uses,
// on the target it was opened for.
//
// A command that can't run on the target stays in its menu, dimmed, with the reason under its
// label: what to do first, or the fact, in a few words with no full stop, as a tab's menu has
// "Already first". The same words are the toast its key gives where no control shows them.

import { ContextMenu, menuOpenedByKey, menuOpener, type ContextMenuAnchor } from '@lo/ui';
import {
  findScope,
  hasEditMenu,
  menuSections,
  scopeTarget,
  setScopeSource,
  textKind,
  type NoticeTarget,
  type Target,
  type TargetKind,
} from '@lo/ui/commands';
import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type MouseEvent,
  type RefCallback,
} from 'react';

import { focusedTarget } from './bar.ts';
import { registry, useKeys } from './registry.ts';

/** The menu that's open: what it's for, and where. */
interface Open {
  readonly target: Target;
  readonly anchor: ContextMenuAnchor;
  /** It was opened from the keyboard, so its first action is highlighted. */
  readonly keyboard: boolean;
  /**
   * What had focus when it was asked to open, which gets focus back when it closes: an element of
   * the page or of a drawing in it, such as a figure's part.
   */
  readonly from: HTMLElement | SVGElement | undefined;
  /** The `⋯` it was opened from, if one opened it, which says it's expanded meanwhile. */
  readonly opener: Element | undefined;
}

let current: Open | undefined;
/** The menu that's closing, whose action runs once focus is back where it was. */
let closing: Open | undefined;
const listeners = new Set<() => void>();

function set(next: Open | undefined): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The menu that's open now. */
export function currentMenu(): Open | undefined {
  return current;
}

/** Calls `listener` as a menu opens or closes. Returns a function that stops it. */
export function followMenu(listener: () => void): () => void {
  return subscribe(listener);
}

/**
 * Opens the menu of `target` at `anchor`, as the keyboard does with `keyboard`, or a `⋯` a key
 * pressed (`menuOpenedByKey`). Returns whether it did: a target no command has a menu item for has
 * no menu.
 */
export function openMenu(
  target: Target,
  anchor: ContextMenuAnchor,
  keyboard: boolean = false,
): boolean {
  if (menuSections(registry(), target).length === 0) return false;
  closing = undefined;
  const active = document.activeElement;
  const from = active instanceof HTMLElement || active instanceof SVGElement ? active : undefined;
  set({ target, anchor, keyboard: keyboard || menuOpenedByKey(), from, opener: menuOpener() });
  return true;
}

/** Closes the menu, as `Esc` and a click outside do. */
export function closeMenu(): void {
  if (current === undefined) return;
  closing = current;
  set(undefined);
}

/**
 * Where the menu of `element` opens when its key asks: under a control, and near the corner of a
 * region, which fills too much of the window to put a menu under.
 */
function anchorOf(element: Element | null): ContextMenuAnchor {
  const box = element?.getBoundingClientRect();
  if (!box) return { x: 0, y: 0 };
  if (box.height > window.innerHeight / 3) return { x: box.left + 16, y: box.top + 16 };
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/**
 * Opens the menu of what has focus, where focus is, as the menu key and ⇧F10 do. The target is
 * the focused scope's, as a key's is. A text field has none.
 */
export function openMenuAtFocus(): boolean {
  // A form field gets the system's Edit menu by right-click only; Lo's menus skip it.
  if (hasEditMenu(document.activeElement)) return false;
  return openMenu(focusedTarget(), anchorOf(document.activeElement), true);
}

/**
 * Opens the menu of `element`'s scope under it, as the keyboard does, with its first row ready,
 * and leaves focus where it is: for a command whose key presses a control that opens a menu, such
 * as an offer's Dismiss.
 */
export function openMenuOf(element: Element): boolean {
  return openMenu(scopeTarget(findScope(element)), anchorOf(element), true);
}

/**
 * Props for an element whose right-click opens the menu of `target`, or of what `target` makes of
 * the click, such as the line under the pointer. The innermost target with a menu takes the click;
 * one with no menu leaves it to the next around it. Spread them on the element.
 */
export function useMenuTarget(
  target: Target | ((event: MouseEvent<HTMLElement>) => Target | undefined),
): { onContextMenu: (event: MouseEvent<HTMLElement>) => void } {
  return {
    onContextMenu(event) {
      // An inner target took it. Events from a portal reach here through React's tree, not the
      // page's, so one that isn't inside this element isn't a click on its target.
      if (event.defaultPrevented) return;
      // A menu is open: this is the browser's own context-menu event for the key that opened it,
      // where it sends one as well, and a second opening would take the first's place. A click
      // elsewhere closes the menu before its right-click gets here.
      if (current !== undefined) {
        event.preventDefault();
        return;
      }
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      // A form field gets the system's Edit menu, which main shows: cut, copy, paste, spelling.
      if (event.target instanceof Element && hasEditMenu(event.target)) return;
      const clicked = typeof target === 'function' ? target(event) : target;
      if (clicked && openMenu(clicked, { x: event.clientX, y: event.clientY })) {
        event.preventDefault();
      }
    },
  };
}

/**
 * Props for an offer whose Dismiss asks where: its right-click opens the menu of `target`, and it's
 * a `notice` scope whose keys act on `target`, so `⇧F10` on its Dismiss opens the same menu. Spread
 * them on the offer's element.
 */
export function useNoticeTarget(target: NoticeTarget): {
  ref: RefCallback<HTMLElement>;
  'data-lo-scope': 'notice';
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
} {
  const latest = useRef(target);
  latest.current = target;
  const ref = useCallback(
    (element: HTMLElement | null) =>
      element ? setScopeSource(element, { target: () => latest.current }) : undefined,
    [],
  );
  return { ref, 'data-lo-scope': 'notice', ...useMenuTarget(target) };
}

/** What a menu of each kind of target is called, for screen readers. */
function nameOf(kind: TargetKind): string {
  switch (kind) {
    case 'line':
    case 'draft':
    case 'note':
      return 'Line actions';
    case 'header':
    case 'file':
      return 'File actions';
    case 'thread':
      return 'Thread actions';
    case 'layer':
      return 'Layer actions';
    case 'block':
      return 'Block actions';
    case 'term':
      return 'Term actions';
    case 'tab':
      return 'Tab actions';
    case 'row':
      return 'Row actions';
    case 'box':
      return 'Comment box actions';
    case 'lines':
      return 'Change lines';
    case 'notice':
      return 'Dismiss';
    case 'none':
      return 'Actions';
    default:
      kind satisfies never;
      throw new Error(`There’s no target of kind ${String(kind)}.`);
  }
}

/**
 * A right-click in a code view's text that no menu took gets no menu at all. Its text is editable
 * to the page, so the system would offer cut and paste for code that nothing can change.
 */
function keepEditMenuFromCode(event: Event): void {
  const { target } = event;
  if (event.defaultPrevented || !(target instanceof Element)) return;
  if (textKind(target) !== undefined && !hasEditMenu(target)) event.preventDefault();
}

/** The right-click menu, over the window. */
export function Menus() {
  const open = useSyncExternalStore(subscribe, currentMenu);
  useKeys();
  useEffect(() => {
    // After the page's own handlers, which are on its root and so run before this one on `document`.
    document.addEventListener('contextmenu', keepEditMenuFromCode);
    return () => document.removeEventListener('contextmenu', keepEditMenuFromCode);
  }, []);
  const shown = open ?? closing;
  const container = document.getElementById('root');
  return (
    <ContextMenu
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) closeMenu();
      }}
      label={nameOf(shown?.target.kind ?? 'none')}
      anchor={shown?.anchor}
      sections={shown ? menuSections(registry(), shown.target) : []}
      finalFocus={shown?.from}
      opener={shown?.opener}
      highlightFirst={shown?.keyboard}
      onClosed={(chosen) => {
        const done = closing;
        closing = undefined;
        // Focus is back where it was, so the command acts where its key would have.
        if (chosen !== undefined && done) registry().run(chosen, done.target);
      }}
      container={container}
    />
  );
}
