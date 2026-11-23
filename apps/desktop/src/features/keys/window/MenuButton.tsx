// The app menu on Linux, whose frameless window has no menu bar: a button at the end of the tab
// strip opens the same menus macOS's menu bar has, as a menu under it.

import { SettingsCommand } from '@lo/ui';

import type { Client } from '../../../window/ipc.ts';
import type { contract } from '../contract.ts';

/** The menu button, found by this attribute wherever the strip draws it. */
const BUTTON = 'data-lo-app-menu';

/**
 * Asks main to open the app menu under the menu button, at its start edge, or at the window's top
 * left while the strip draws none.
 */
export function openAppMenu(main: Client<typeof contract>): void {
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
      {...{ [BUTTON]: '' }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 4.5h10M3 8h10M3 11.5h10" />
      </svg>
    </SettingsCommand>
  );
}
