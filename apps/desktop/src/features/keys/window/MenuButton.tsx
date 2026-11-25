// The app menu on Linux, whose frameless window has no menu bar: a button at the end of the tab
// strip opens the same menus macOS's menu bar has, as a menu under it. Like a menu bar's, its
// commands act on what has focus, so opened from the strip by the keyboard, it acts on what had
// focus before the strip, which gets focus back.

import { Icon, SettingsCommand, STRIP_ATTRIBUTE } from '@lo/ui';

import type { Client } from '../../../window/ipc.ts';
import type { contract } from '../contract.ts';

/** The menu button, found by this attribute wherever the strip draws it. */
const BUTTON = 'data-lo-app-menu';

/** The strip's row: its tabs and the buttons at its end. */
const STRIP = `[${STRIP_ATTRIBUTE}]`;

/** What had focus last outside the strip, while focus is somewhere: what the menu acts on. */
let before: HTMLElement | undefined;

/** Whether `target` is in the strip's row. */
function inStrip(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(STRIP) !== null;
}

/** Focus came to `event.target`: what the menu acts on, if it's outside the strip. */
function came(event: FocusEvent): void {
  if (event.target instanceof HTMLElement && !inStrip(event.target)) before = event.target;
}

/** Focus left `event.target`: for nowhere in particular, from outside the strip, it's forgotten. */
function went(event: FocusEvent): void {
  if (event.relatedTarget === null && !inStrip(event.target)) before = undefined;
}

/**
 * Keeps track of what has focus outside the strip, for the menu opened from the strip by the
 * keyboard to act on. Focus that goes nowhere in particular forgets it. Returns a function that
 * stops.
 */
export function watchStripFocus(): () => void {
  window.addEventListener('focusin', came);
  window.addEventListener('focusout', went);
  return () => {
    window.removeEventListener('focusin', came);
    window.removeEventListener('focusout', went);
  };
}

/**
 * Asks main to open the app menu under the menu button, at its start edge, or at the window's top
 * left while the strip draws none. With focus in the strip, as when the button was pressed by the
 * keyboard, focus first goes back to what had it before the strip, or nowhere in particular.
 * `send` sends main the menu as it is then, before main opens it.
 */
export function openAppMenu(main: Client<typeof contract>, send: () => void): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && inStrip(active)) {
    if (before?.isConnected) before.focus({ preventScroll: true });
    else active.blur();
  }
  send();
  const button = document.querySelector(`[${BUTTON}]`);
  const at = button?.getBoundingClientRect();
  main
    .popup({ x: Math.max(0, at?.left ?? 0), y: Math.max(0, at?.bottom ?? 0) })
    .catch((error: unknown) => console.error("Lo couldn't open its menu:", error));
}

/**
 * The menu button: three lines, named "Show menu" with its key in its tooltip. A press keeps focus
 * where it was, so what the menu runs acts on what had it, as a menu bar's would.
 */
export function MenuButton() {
  return (
    <SettingsCommand
      command="keys.appMenu"
      variant="ghost"
      size="sm"
      icon
      aria-label="Show menu"
      aria-haspopup="menu"
      {...{ [BUTTON]: '' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Icon name="menu" size={16} />
    </SettingsCommand>
  );
}
