import { Menu } from '@base-ui/react/menu';
import { Separator } from '@base-ui/react/separator';
import { Fragment, useMemo, useRef } from 'react';

import { Key, keyAria } from './Key.tsx';

/** One action in a context menu. */
export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  /** Its key, as the system shows each key of it: `['e']`, or `['g', 'f']` for a sequence. */
  readonly keys?: readonly string[] | undefined;
  /**
   * That key as `aria-keyshortcuts` says it, which a screen reader hears in place of the key caps.
   * A sequence has none, so it's described instead.
   */
  readonly shortcut?: string | undefined;
  /**
   * Why it can't be done now. The item is greyed, says so, and does nothing when chosen; the
   * arrows still reach it, so its reason can be read.
   */
  readonly disabled?: string | undefined;
}

/** Where a menu opens in the window: a point, or the box of what it's for, in window pixels. */
export interface ContextMenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface ContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the menu is, for screen readers: "File actions". */
  label: string;
  /** Where it opens. Its top left corner is at the anchor, or under its box, unless that's off screen. */
  anchor: ContextMenuAnchor | undefined;
  /** The actions, with a separator between sections. */
  sections: readonly (readonly ContextMenuItem[])[];
  /**
   * Where focus goes when the menu closes: the element that had it when the menu was asked to
   * open. Without one, wherever Base UI found focus to give back.
   */
  finalFocus?: HTMLElement | undefined;
  /**
   * Highlights the first action as the menu opens, as a menu opened from the keyboard does, so
   * `⏎` acts at once. A pointer opens it with nothing highlighted.
   */
  highlightFirst?: boolean | undefined;
  /**
   * The menu has closed, and focus has gone back to where it was, with the action chosen, by `⏎`
   * or a click, if one was. A caller runs it here, so it acts where its key would have.
   */
  onClosed?: ((chosen: string | undefined) => void) | undefined;
  /** Where the menu is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

/**
 * A menu at a point: the actions that can be done to what was right-clicked, each with its key,
 * and greyed with the reason when it can't be done now. Keys move through it (`j` and `k` as the
 * arrows do, in the `menu` scope), `⏎` chooses, and `Esc` closes it and gives focus back.
 */
export function ContextMenu({
  open,
  onOpenChange,
  label,
  anchor,
  sections,
  finalFocus,
  highlightFirst = false,
  onClosed,
  container,
}: ContextMenuProps) {
  const chosen = useRef<string | undefined>(undefined);
  const popup = useRef<HTMLDivElement>(null);
  const at = useMemo(() => (anchor ? virtual(anchor) : undefined), [anchor]);
  return (
    <Menu.Root
      open={open && at !== undefined}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (next) {
          // Focusing an action is what highlights it.
          if (highlightFirst)
            popup.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
          return;
        }
        const id = chosen.current;
        chosen.current = undefined;
        onClosed?.(id);
      }}
    >
      <Menu.Portal container={container}>
        <Menu.Positioner
          anchor={at}
          side="bottom"
          align="start"
          sideOffset={0}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Menu.Popup
            ref={popup}
            finalFocus={() => (finalFocus?.isConnected ? finalFocus : true)}
            aria-label={label}
            data-lo-scope="menu"
            className="min-w-menu-w rounded-md bg-bg-overlay p-4 text-fg shadow-pop outline-none text-ui"
          >
            {sections.map((section, index) => (
              <Fragment key={section.map((item) => item.id).join(' ')}>
                {index > 0 && <Separator className="mx-6 my-4 h-px bg-border" />}
                {section.map((item) => (
                  <Menu.Item
                    key={item.id}
                    label={item.label}
                    disabled={item.disabled !== undefined}
                    {...keyAria(item.keys, item.shortcut)}
                    onClick={() => {
                      chosen.current = item.id;
                    }}
                    className="group flex min-h-menu-item-h cursor-default items-center gap-8 rounded-sm px-8 py-2 text-fg outline-none select-none focus-visible:shadow-none data-disabled:text-fg-disabled data-highlighted:bg-accent data-highlighted:text-on-accent data-highlighted:data-disabled:bg-hover data-highlighted:data-disabled:text-fg-disabled"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>{item.label}</span>
                      {item.disabled !== undefined && (
                        <span className="text-fg-muted text-micro">{item.disabled}</span>
                      )}
                    </span>
                    {item.keys && item.keys.length > 0 && (
                      <Key
                        keys={item.keys}
                        decorative
                        className="group-data-highlighted:border-current group-data-highlighted:text-inherit group-data-highlighted:opacity-70 group-data-highlighted:shadow-none"
                      />
                    )}
                  </Menu.Item>
                ))}
              </Fragment>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A box for the menu to open at, as a position the menu is placed against. */
function virtual(anchor: ContextMenuAnchor) {
  const { x, y, width = 0, height = 0 } = anchor;
  const rect = {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({ x, y, width, height }),
  };
  return { getBoundingClientRect: () => rect };
}
