import { Menu } from '@base-ui/react/menu';
import { Separator } from '@base-ui/react/separator';
import { cva } from 'class-variance-authority';
import { Fragment, useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { useTakeFocus } from './focus.ts';
import { Key, keyAria } from './Key.tsx';
import { focusStillIn, giveFocusBack, useHeld, useOnClose } from './motion.ts';

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
   * arrows still reach it, so its reason can be read. `''` greys it with nothing to say, where
   * the greyed label says it all: Back with nowhere to go.
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
   * open, of the page or of a drawing in it. Without one, or once it has left the page, wherever
   * Base UI found focus to give back. Either way only while focus is still the menu's: focus that an
   * action moved somewhere else, such as into the panel an offer it dismissed was in, stays there.
   */
  finalFocus?: HTMLElement | SVGElement | undefined;
  /**
   * Highlights the first action as the menu opens, as a menu opened from the keyboard does, so
   * `⏎` acts at once. A pointer opens it with nothing highlighted.
   */
  highlightFirst?: boolean | undefined;
  /**
   * The menu has closed, and focus has gone back to where it was, with the action chosen, by `⏎`
   * or a click, if one was. A caller runs it here, so it acts where its key would have. This comes
   * as the menu starts to leave, not once it has faded, and the menu keeps what it showed while it
   * fades, so a caller is free to clear its state here.
   */
  onClosed?: ((chosen: string | undefined) => void) | undefined;
  /** Where the menu is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /**
   * A menu that can list more than the window holds, such as the tabs that don't fit: it grows to
   * a palette's list at most, and scrolls.
   */
  long?: boolean | undefined;
}

/**
 * The box a row's key sits in: as tall as the label's line, and at the row's top when a reason
 * makes the row two lines, so the keys of a menu line up with their labels in every row.
 */
const keyBox = cva('flex h-1lh flex-none items-center', {
  variants: { reason: { true: 'self-start', false: '' } },
});

/**
 * A menu at a point: the actions that can be done to what was right-clicked, each with its key,
 * and greyed with the reason when it can't be done now. Keys move through it (`j` and `k` as the
 * arrows do, in the `menu` scope), `⏎` chooses, and `Esc` closes it and gives focus back. It comes
 * and goes with the Pop move.
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
  long = false,
}: ContextMenuProps) {
  const chosen = useRef<string | undefined>(undefined);
  const popup = useRef<HTMLDivElement | null>(null);
  // The menu takes focus as it mounts, not a frame on. An action that has focus by then keeps it.
  const takeFocus = useTakeFocus();
  const mounted = useCallback(
    (element: HTMLDivElement | null) => {
      popup.current = element;
      takeFocus(element);
    },
    [takeFocus],
  );
  const at = useMemo(() => (anchor ? virtual(anchor) : undefined), [anchor]);
  const shown = open && at !== undefined;
  // What it shows, and where, stay as they were while it leaves.
  const held = useHeld(shown, { at, sections, label });
  // Each opening starts with nothing chosen: an action pressed as the last one faded ran nothing,
  // and isn't this one's.
  useLayoutEffect(() => {
    if (shown) chosen.current = undefined;
  }, [shown]);
  useOnClose(shown, () => {
    // Focus goes back to the element itself. Base UI would give it to the element's first
    // tabbable child when the element is focusable only from a script, such as a block of
    // text with a link in it. Focus that has gone somewhere else by itself stays there.
    giveFocusBack(finalFocus, popup.current);
    const id = chosen.current;
    chosen.current = undefined;
    onClosed?.(id);
  });
  // Focusing an action is what highlights it. It waits for the frame in which Base UI has taken
  // note of the menu's actions, and for nothing else: not for the menu to finish coming.
  useLayoutEffect(() => {
    if (!shown || !highlightFirst) return undefined;
    const frame = requestAnimationFrame(() => {
      queueMicrotask(() => popup.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, highlightFirst]);
  return (
    <Menu.Root open={shown} onOpenChange={(next) => onOpenChange(next)}>
      <Menu.Portal container={container}>
        <Menu.Positioner
          anchor={held.at}
          side="bottom"
          align="start"
          sideOffset={0}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Menu.Popup
            ref={mounted}
            // Base UI gives focus back only where Lo couldn't: the element left the page before the
            // menu had gone, and focus with it. Focus that has gone somewhere else by then, as to
            // the panel an offer dismissed from its own Dismiss was in, stays there.
            finalFocus={() => !finalFocus?.isConnected && focusStillIn(popup.current)}
            // Leaving, it takes no focus: a caller that focuses something in it as it closes, a
            // frame or two on, would leave focus on nothing once it's gone.
            inert={!shown}
            aria-label={held.label}
            data-lo-scope="menu"
            className={`move-pop min-w-menu-w rounded-md bg-bg-overlay p-4 text-fg shadow-pop outline-none text-ui ${long ? 'max-h-palette-list-h overflow-y-auto' : ''}`}
          >
            {held.sections.map((section, index) => (
              <Fragment key={section.map((item) => item.id).join(' ')}>
                {index > 0 && <Separator className="mx-6 my-4 h-px bg-border" />}
                {section.map((item) => (
                  <Menu.Item
                    key={item.id}
                    label={item.label}
                    disabled={item.disabled !== undefined}
                    {...keyAria(item.keys, item.shortcut)}
                    onClick={() => {
                      // Leaving, it has said what was chosen already.
                      if (shown) chosen.current = item.id;
                    }}
                    className="group flex min-h-menu-item-h cursor-default items-center gap-8 rounded-sm px-8 py-2 text-fg outline-none select-none focus-visible:shadow-none data-disabled:text-fg-disabled data-highlighted:bg-accent data-highlighted:text-on-accent data-highlighted:data-disabled:bg-hover data-highlighted:data-disabled:text-fg-disabled"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span>{item.label}</span>
                      {item.disabled && (
                        <span className="text-fg-muted text-micro">{item.disabled}</span>
                      )}
                    </span>
                    {item.keys && item.keys.length > 0 && (
                      // On the label's line, where it is in a row with no reason under it.
                      <span className={keyBox({ reason: Boolean(item.disabled) })}>
                        <Key
                          keys={item.keys}
                          decorative
                          className="group-data-highlighted:border-current group-data-highlighted:text-inherit group-data-highlighted:opacity-70 group-data-highlighted:shadow-none"
                        />
                      </span>
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
