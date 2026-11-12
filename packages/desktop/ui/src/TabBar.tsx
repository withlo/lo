import { Menu } from '@base-ui/react/menu';
import { cva } from 'class-variance-authority';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import { Skeleton, Spinner } from './Spinner.tsx';

/** A tab in the strip: a pull request's (or a whole stack's), or one of Lo's own. */
export type Tab = PullTab | RecentTab | SettingsTab;

/** A pull request, or a whole stack, open in a tab. */
export interface PullTab {
  kind: 'pull';
  id: string;
  /** The repository's name, without its owner. */
  repo: string;
  number: number;
  /** Its title, once known. Until then the tab shows the repository and number alone. */
  title?: string | undefined;
  /** Its state, once known. */
  state?: 'open' | 'draft' | 'merged' | 'closed' | undefined;
  /** How many pull requests the tab's stack holds, when it holds one. */
  stack?: number | undefined;
  /**
   * Whether it's still opening, with no title yet: it shows a spinner where its state goes, and a
   * placeholder where its title will be.
   */
  loading?: boolean | undefined;
}

/** "Recent pull requests": the only tab while nothing else is open. It has no close button. */
export interface RecentTab {
  kind: 'recent';
  id: string;
}

/** Lo's settings. */
export interface SettingsTab {
  kind: 'settings';
  id: string;
}

export interface TabBarProps {
  tabs: readonly Tab[];
  /** The tab on screen. */
  selected?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onClose?: ((id: string) => void) | undefined;
  /** Opens a pull request. Without it, the `+` button does nothing. */
  onNew?: (() => void) | undefined;
  /**
   * Moves a tab to place `to` among `tabs`, from 0, counted without it: one dragged along the
   * strip, or the tab on screen, brought into the strip from past the last place that fits.
   * Without it, tabs don't drag, and a tab brought in is only drawn there. The strip shows a
   * dragged tab at its new place until `tabs` comes in another order, or until what this returns
   * settles.
   */
  onMove?: ((id: string, to: number) => void | Promise<unknown>) | undefined;
  /** Where the menu of tabs that don't fit is put in the page: an element inside `.lo-app`. */
  menuContainer?: HTMLElement | null | undefined;
  /** Whether the menu of tabs that don't fit is open, for a key to open it. */
  moreOpen?: boolean | undefined;
  /** Hears the menu of tabs that don't fit open or close. */
  onMoreOpenChange?: ((open: boolean) => void) | undefined;
  /** Hears which tabs don't fit, by id, each time that changes. */
  onFold?: ((folded: readonly string[]) => void) | undefined;
}

const tab = cva(
  'relative mt-8 flex max-w-tab-w min-w-tab-w-min shrink grow-0 basis-tab-w items-center gap-6 rounded-t-md ps-12 pe-6 whitespace-nowrap no-drag text-small focus-visible:shadow-ring-inset',
  {
    variants: {
      selected: { true: 'tab-flares bg-bg-chrome text-fg', false: '' },
      // Over the tabs it passes, on a ground of its own, so theirs don't show through it.
      dragged: { true: 'tab-dragged', false: '' },
    },
    compoundVariants: [
      { selected: false, dragged: false, class: 'text-fg-muted hover:bg-hover hover:text-fg' },
      { selected: false, dragged: true, class: 'bg-bg-raised text-fg' },
    ],
  },
);

const state = cva('size-8 flex-none rounded-full', {
  variants: {
    state: {
      open: 'bg-state-open',
      draft: 'text-state-draft hollow',
      merged: 'bg-state-merged',
      closed: 'bg-state-closed',
    },
  },
});

/**
 * The strip of tabs at the top of the window, which Lo draws on every system. It's where the
 * window is dragged from; its tabs and buttons aren't. It starts after macOS's traffic lights and
 * ends before Linux's window controls (`--lo-window-inset-start` and `-end`). Each tab carries its
 * id in `data-tab`, for what a right-click on it acts on.
 *
 * Tabs shrink as more open, down to their repository and number, and those that still don't fit
 * fold into a menu after the last that does, "N more". So the strip shows the first tabs, in order.
 * The tab on screen never folds: once it's further along, as when it's chosen from "N more", it
 * moves into the last place that fits, through `onMove`, and the tab there folds.
 *
 * With `onMove`, a tab dragged along the strip follows the pointer, within the tabs shown, and the
 * others slide aside to show where it will land; letting go moves it there, and `Esc` puts it
 * back. A click that barely moves is still a click. Recent pull requests, the only tab while
 * nothing else is open, stays where it is. A tab that has focus keeps it as the strip reorders.
 */
export function TabBar({
  tabs,
  selected,
  onSelect,
  onClose,
  onNew,
  onMove,
  menuContainer,
  moreOpen,
  onMoreOpenChange,
  onFold,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [landed, setLanded] = useState<Landed | undefined>(undefined);
  const measured = useRoom(list, plus, more, tabs.length);
  const room = measured?.fits;
  const { tabs: ordered, moved } = bringIn(inOrder(tabs, landed), selected, room);
  const { shown, folded } = foldTabs(ordered, room);
  // The tab on screen, brought into the strip, moves there in the order, once each time, as it's
  // drawn there, so whatever's asked of main after goes to that order. Only by a room measured
  // with these tabs: one measured before a tab opened would fold the tabs before it.
  const bringing =
    moved && measured?.count === tabs.length && `${moved.id}\n${moved.to}\n${orderOf(tabs)}`;
  useLayoutEffect(() => {
    if (bringing && moved) void onMove?.(moved.id, moved.to);
  }, [bringing]);
  const drag = useDrag(list, shown, onMove !== undefined, (id, to) => {
    if (!onMove) return;
    // The strip shows the first tabs, so the place among those shown is the place among all.
    const mine: Landed = {
      from: orderOf(tabs),
      order: ordered
        .filter((item) => item.id !== id)
        .map((item) => item.id)
        .toSpliced(to, 0, id),
    };
    setLanded(mine);
    const settle = () => setLanded((current) => (current === mine ? undefined : current));
    void Promise.resolve(onMove(id, to)).then(settle, settle);
  });
  useKeptFocus(list);
  const foldedIds = folded.map((item) => item.id).join('\n');
  useEffect(() => {
    onFold?.(foldedIds === '' ? [] : foldedIds.split('\n'));
  }, [foldedIds, onFold]);
  return (
    <div className="h-tabbar-h shrink-0 bg-bg ps-window-inset-start pe-window-inset-end drag">
      <div
        ref={list}
        role="tablist"
        aria-label="Pull requests"
        className="relative flex h-full min-w-0 gap-2 px-8"
      >
        {shown.map((item, index) => (
          <TabItem
            key={item.id}
            tab={item}
            selected={item.id === selected}
            position={ordered.indexOf(item) + 1}
            count={ordered.length}
            onSelect={onSelect}
            onClose={onClose}
            drag={drag(item, index)}
          />
        ))}
        {folded.length > 0 && (
          <MoreTabs
            trigger={more}
            tabs={folded}
            onSelect={onSelect}
            container={menuContainer}
            open={moreOpen}
            onOpenChange={onMoreOpenChange}
          />
        )}
        <button
          ref={plus}
          type="button"
          aria-label="Review a pull request"
          aria-disabled={onNew ? undefined : true}
          onClick={onNew}
          className="ms-6 grid size-control-h-sm flex-none place-items-center self-center rounded-sm text-fg-muted no-drag hover:bg-hover hover:text-fg focus-visible:shadow-ring"
        >
          <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.25v9.5M3.25 8h9.5" />
          </svg>
        </button>
        <div className="flex-1 self-stretch" />
      </div>
    </div>
  );
}

/**
 * The tabs the strip shows and those it folds, when `room` tabs fit (all of them while it isn't
 * known): the first that fit, and the rest, in order.
 */
export function foldTabs<T extends { readonly id: string }>(
  tabs: readonly T[],
  room: number | undefined,
): { shown: T[]; folded: T[] } {
  if (room === undefined || tabs.length <= room) return { shown: [...tabs], folded: [] };
  const fits = Math.max(1, room);
  return { shown: tabs.slice(0, fits), folded: tabs.slice(fits) };
}

/**
 * `tabs` with the tab on screen in the last place that fits, when it's further along, so the strip
 * shows it; and where it moved to, from 0, counted without it. The tab that was there folds.
 */
export function bringIn<T extends { readonly id: string }>(
  tabs: readonly T[],
  selected: string | undefined,
  room: number | undefined,
): { tabs: readonly T[]; moved?: { id: string; to: number } } {
  if (room === undefined || tabs.length <= room) return { tabs };
  const to = Math.max(1, room) - 1;
  const at = tabs.findIndex((item) => item.id === selected);
  const onScreen = tabs[at];
  if (!onScreen || at <= to) return { tabs };
  return {
    tabs: tabs.toSpliced(at, 1).toSpliced(to, 0, onScreen),
    moved: { id: onScreen.id, to },
  };
}

/** The strip's room, in CSS pixels, as `tabsThatFit` reads it. */
export interface StripRoom {
  /** The width tabs and buttons share. */
  readonly width: number;
  /** The narrowest a tab gets. */
  readonly tab: number;
  /** The gap between neighbours. */
  readonly gap: number;
  /** The `+` button, with its margin. */
  readonly plus: number;
  /** The "N more" button, with its margin. */
  readonly more: number;
}

/**
 * How many of `count` tabs fit in the strip at their narrowest: all of them beside `+`, or else
 * as many as fit beside both `+` and the "N more" button, and at least one.
 */
export function tabsThatFit({ width, tab: narrowest, gap, plus, more }: StripRoom, count: number) {
  const each = narrowest + gap;
  if (count * each + plus + gap <= width) return count;
  return Math.max(1, Math.floor((width - plus - more - 2 * gap) / each));
}

/** How many tabs fit, and how many there were when that was measured. */
interface Room {
  readonly fits: number;
  readonly count: number;
}

/**
 * How many tabs fit in the strip, measured after each render and as the window resizes, or
 * undefined until it's known. The "N more" button is held at the widest it has been, so its
 * count's digits can't make the strip fold and unfold in turn.
 */
function useRoom(
  list: RefObject<HTMLDivElement | null>,
  plus: RefObject<HTMLButtonElement | null>,
  more: RefObject<HTMLButtonElement | null>,
  count: number,
): Room | undefined {
  const [room, setRoom] = useState<Room | undefined>(undefined);
  const widest = useRef(0);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [list]);

  // After every render, since the buttons' widths and the count change with what's shown.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || width === 0) return;
    const style = getComputedStyle(element);
    const gap = parseFloat(style.columnGap) || 0;
    const outer = (button: HTMLElement | null) =>
      button
        ? button.offsetWidth + (parseFloat(getComputedStyle(button).marginInlineStart) || 0)
        : 0;
    widest.current = Math.max(widest.current, outer(more.current));
    const fits = tabsThatFit(
      {
        width:
          element.clientWidth -
          (parseFloat(style.paddingInlineStart) || 0) -
          (parseFloat(style.paddingInlineEnd) || 0),
        tab: parseFloat(style.getPropertyValue('--lo-tab-w-min')) || 0,
        gap,
        plus: outer(plus.current),
        more: widest.current,
      },
      count,
    );
    setRoom((last) => (last?.fits === fits && last.count === count ? last : { fits, count }));
  });

  return room;
}

/** The tabs' ids, in order, as one string to compare. */
function orderOf(tabs: readonly { readonly id: string }[]): string {
  return tabs.map((item) => item.id).join('\n');
}

/** A tab let go at a new place, which the strip shows there until `tabs` has it there too. */
interface Landed {
  /** The order of `tabs` it was let go in. */
  readonly from: string;
  /** The tabs' ids in their new order. */
  readonly order: readonly string[];
}

/** `tabs` in the strip's order: the one a tab just let go made, while `tabs` hasn't changed. */
function inOrder<T extends { readonly id: string }>(
  tabs: readonly T[],
  landed: Landed | undefined,
): readonly T[] {
  if (!landed || orderOf(tabs) !== landed.from) return tabs;
  const byId = new Map(tabs.map((item) => [item.id, item]));
  return landed.order.flatMap((id) => byId.get(id) ?? []);
}

/** A tab shown in the strip, as a drag starts: its left edge, from the strip's, and its width. */
export interface Slot {
  readonly left: number;
  readonly width: number;
}

/** How far the tab in `slots[from]` follows a pointer moved by `moved`: within the tabs shown. */
export function dragOffset(slots: readonly Slot[], from: number, moved: number): number {
  const self = slots[from];
  const first = slots[0];
  const last = slots.at(-1);
  if (!self || !first || !last) return 0;
  const least = first.left - self.left;
  const most = last.left + last.width - (self.left + self.width);
  return Math.min(Math.max(moved, least), most);
}

/**
 * How many of the other tabs shown the tab in `slots[from]`, dragged by `offset`, lands after:
 * those whose middle its own middle has passed, or reached, for those it started before. So at
 * either end of the strip it passes them all.
 */
export function dragPlace(slots: readonly Slot[], from: number, offset: number): number {
  const self = slots[from];
  if (!self) return from;
  const middle = self.left + self.width / 2 + offset;
  return slots.filter((slot, index) => {
    const theirs = slot.left + slot.width / 2;
    return index < from ? theirs < middle : index > from && theirs <= middle;
  }).length;
}

/**
 * How far the tab shown at `index` slides aside for the one at `from` to land after `place` of the
 * others: by `space`, the room the dragged tab leaves, toward where it came from, if it's passed.
 */
export function slideOf(index: number, from: number, place: number, space: number): number {
  if (index < from && index >= place) return space;
  if (index > from && index <= place) return -space;
  return 0;
}

/** How far, in CSS pixels, a pressed tab moves before it drags: a click that wobbles is a click. */
const DRAG_START = 4;

/** A tab being dragged, or sliding back after `Esc`. */
interface Drag {
  readonly id: string;
  /** The tabs shown as it started, in order, and the dragged one's index among them. */
  readonly slots: readonly Slot[];
  readonly from: number;
  /** The shown tabs' order as it started: a change puts the tab back. */
  readonly order: string;
  /** The room the dragged tab leaves: its width and a gap. */
  readonly space: number;
  /** How far it's dragged. */
  readonly offset: number;
  /** How many of the other tabs shown it lands after. */
  readonly place: number;
  /** Whether it's sliding back to where it was. */
  readonly back: boolean;
}

/** What a tab takes from a drag: its handlers, how it's drawn, and whether a click selects it. */
interface TabDrag {
  readonly handlers: Pick<
    HTMLAttributes<HTMLDivElement>,
    | 'onPointerDown'
    | 'onPointerMove'
    | 'onPointerUp'
    | 'onPointerCancel'
    | 'onLostPointerCapture'
    | 'onKeyDown'
    | 'onKeyUp'
    | 'onBlur'
    | 'onTransitionEnd'
  >;
  readonly dragged: boolean;
  readonly className: string | undefined;
  readonly style: CSSProperties | undefined;
  /** Whether the click on hand ends a drag, and selects nothing. */
  clickEndsDrag(): boolean;
}

/**
 * Dragging tabs along the strip, with the pointer. A press on a tab, but not on its close button,
 * holds the pointer; past a few pixels the tab follows it, within the tabs shown, and the others
 * slide aside. Letting go hands `drop` the tab and how many of the other tabs it lands after.
 * `Esc`, focus leaving the tab (as `Esc` sends it to the middle view), a lost pointer or the strip
 * changing puts it back. Returns what each tab shown, at its index, takes.
 */
function useDrag(
  list: RefObject<HTMLDivElement | null>,
  shown: readonly Tab[],
  movable: boolean,
  drop: (id: string, place: number) => void,
): (item: Tab, index: number) => TabDrag {
  const press = useRef<{ id: string; pointer: number; x: number } | undefined>(undefined);
  const live = useRef<Drag | undefined>(undefined);
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  /** A drag ended under the pointer, so the click that follows selects nothing. */
  const ended = useRef(false);

  const set = (next: Drag | undefined) => {
    live.current = next;
    setDrag(next);
  };

  /** Puts the dragged tab back where it was, sliding, and forgets a press. */
  const putBack = () => {
    press.current = undefined;
    const current = live.current;
    if (!current || current.back) return;
    ended.current = true;
    set(
      current.offset === 0 ? undefined : { ...current, offset: 0, place: current.from, back: true },
    );
  };

  const order = orderOf(shown);
  useEffect(() => {
    if (live.current && live.current.order !== order) {
      press.current = undefined;
      set(undefined);
    }
  }, [order]);

  /** Starts dragging `element`, the tab pressed, from where it is. */
  const start = (id: string, element: HTMLElement): Drag | undefined => {
    const strip = list.current;
    if (!strip) return undefined;
    const elements = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
    const from = elements.indexOf(element);
    // Layout's places, which a tab still sliding doesn't change.
    const slots = elements.map((each) => ({ left: each.offsetLeft, width: each.offsetWidth }));
    const self = slots[from];
    if (!self) return undefined;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 0;
    if (element.ownerDocument.activeElement !== element) element.focus({ preventScroll: true });
    return { id, slots, from, order, space: self.width + gap, offset: 0, place: from, back: false };
  };

  /**
   * `Esc` on the dragged tab. Lo's keys take its press first, and send focus to the middle view,
   * which puts the tab back as it blurs; its release reaches the tab when focus stays.
   */
  const escape = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !live.current || live.current.back) return;
    event.preventDefault();
    putBack();
  };

  const clickEndsDrag = () => {
    const was = ended.current;
    ended.current = false;
    return was;
  };

  return (item, index) => {
    const handlers: TabDrag['handlers'] = {
      onPointerDown(event) {
        ended.current = false;
        press.current = undefined;
        if (live.current?.back) set(undefined);
        const plain = !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
        if (!movable || item.kind === 'recent' || event.button !== 0 || !plain) return;
        if (event.target instanceof Element && event.target.closest('button')) return;
        press.current = { id: item.id, pointer: event.pointerId, x: event.clientX };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event) {
        const pressed = press.current;
        if (pressed?.id !== item.id || pressed.pointer !== event.pointerId) return;
        const moved = event.clientX - pressed.x;
        const current =
          live.current ??
          (Math.abs(moved) >= DRAG_START ? start(item.id, event.currentTarget) : undefined);
        if (!current) return;
        const offset = dragOffset(current.slots, current.from, moved);
        set({ ...current, offset, place: dragPlace(current.slots, current.from, offset) });
      },
      onPointerUp(event) {
        const pressed = press.current;
        press.current = undefined;
        const current = live.current;
        if (pressed?.pointer !== event.pointerId || !current || current.back) return;
        ended.current = true;
        set(undefined);
        // Where it's let go, which the last move drawn may not have reached: moves wait for a frame.
        const offset = dragOffset(current.slots, current.from, event.clientX - pressed.x);
        const place = dragPlace(current.slots, current.from, offset);
        if (place !== current.from) drop(current.id, place);
      },
      onPointerCancel: putBack,
      onLostPointerCapture: putBack,
      onKeyDown: escape,
      onKeyUp: escape,
      onBlur() {
        if (live.current?.id === item.id) putBack();
      },
      onTransitionEnd(event) {
        const current = live.current;
        if (event.target !== event.currentTarget || event.propertyName !== 'transform') return;
        if (current?.back && current.id === item.id) set(undefined);
      },
    };
    if (!drag) {
      return { handlers, dragged: false, className: undefined, style: undefined, clickEndsDrag };
    }
    if (item.id === drag.id) {
      return {
        handlers,
        dragged: !drag.back,
        // Put back, it slides home over the others.
        className: drag.back ? 'tab-dragged tab-slide' : undefined,
        style: { transform: `translateX(${drag.offset}px)` },
        clickEndsDrag,
      };
    }
    return {
      handlers,
      dragged: false,
      className: 'tab-slide',
      style: { transform: `translateX(${slideOf(index, drag.from, drag.place, drag.space)}px)` },
      clickEndsDrag,
    };
  };
}

/**
 * Gives focus back to the tab that had it as the strip drew, if focus fell to nothing as it was
 * drawn: React moves a tab's element to reorder the strip, which drops its focus.
 */
function useKeptFocus(list: RefObject<HTMLDivElement | null>): void {
  const had = focusedTab(list.current);
  useLayoutEffect(() => {
    const strip = list.current;
    if (had === undefined || !strip) return;
    const { activeElement, body } = strip.ownerDocument;
    if (activeElement !== null && activeElement !== body) return;
    for (const each of strip.querySelectorAll<HTMLElement>('[role="tab"]')) {
      if (each.getAttribute('data-tab') === had) each.focus({ preventScroll: true });
    }
  });
}

/** The id of the tab in `strip` that has focus, if one has. */
function focusedTab(strip: HTMLElement | null): string | undefined {
  const focused = strip?.ownerDocument.activeElement;
  if (!strip || !focused || !strip.contains(focused)) return undefined;
  return focused.getAttribute('role') === 'tab'
    ? (focused.getAttribute('data-tab') ?? undefined)
    : undefined;
}

/**
 * The "N more" button, and the menu of the tabs it holds. Choosing one shows it. `Tab` reaches the
 * button, and a key can open the menu, through `open`.
 */
function MoreTabs({
  trigger,
  tabs,
  onSelect,
  container,
  open,
  onOpenChange,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  tabs: readonly Tab[];
  onSelect: TabBarProps['onSelect'];
  container: HTMLElement | null | undefined;
  open: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
}) {
  return (
    <Menu.Root
      {...(open === undefined ? {} : { open })}
      onOpenChange={(next) => onOpenChange?.(next)}
    >
      <Menu.Trigger
        ref={trigger}
        aria-label={`${tabs.length} more tabs`}
        className="ms-4 inline-flex h-control-h-sm flex-none items-center gap-4 self-center rounded-sm px-8 text-fg-muted no-drag text-small hover:bg-hover hover:text-fg focus-visible:shadow-ring data-popup-open:bg-press data-popup-open:text-fg"
      >
        <span className="lo-num">{tabs.length}</span> more
        <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal container={container}>
        <Menu.Positioner
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Menu.Popup
            aria-label="More tabs"
            data-lo-scope="menu"
            className="max-h-palette-list-h max-w-tab-w min-w-menu-w overflow-y-auto rounded-md bg-bg-overlay p-4 text-fg shadow-pop outline-none text-small"
          >
            {tabs.map((item) => (
              <Menu.Item
                key={item.id}
                label={labelOf(item)}
                onClick={() => onSelect?.(item.id)}
                className="flex min-h-menu-item-h cursor-default items-center gap-6 rounded-sm px-8 py-2 whitespace-nowrap text-fg outline-none select-none focus-visible:shadow-none data-highlighted:bg-hover"
              >
                <TabLabel tab={item} selected={false} />
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A tab as words, for typing ahead in the menu of tabs that don't fit. */
function labelOf(item: Tab): string {
  switch (item.kind) {
    case 'pull':
      return `${item.repo} #${item.number} ${item.title ?? ''}`.trim();
    case 'recent':
      return 'Recent pull requests';
    case 'settings':
      return 'Settings';
    default:
      item satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(item)}.`);
  }
}

/**
 * A tab in the strip. It says its place among every tab open, `position` of `count`, folded ones
 * included, as `⌘1` to `⌘9` count them.
 */
function TabItem({
  tab: item,
  selected,
  position,
  count,
  onSelect,
  onClose,
  drag,
}: {
  tab: Tab;
  selected: boolean;
  position: number;
  count: number;
  onSelect: TabBarProps['onSelect'];
  onClose: TabBarProps['onClose'];
  drag: TabDrag;
}) {
  const { id } = item;
  const loading = item.kind === 'pull' && isLoading(item);
  return (
    <div
      role="tab"
      aria-selected={selected}
      aria-posinset={position}
      aria-setsize={count}
      aria-busy={loading ? true : undefined}
      tabIndex={selected ? 0 : -1}
      data-tab={id}
      onClick={() => {
        if (!drag.clickEndsDrag()) onSelect?.(id);
      }}
      {...drag.handlers}
      style={drag.style}
      className={['group', tab({ selected, dragged: drag.dragged }), drag.className]
        .filter(Boolean)
        .join(' ')}
    >
      <TabLabel tab={item} selected={selected} />
      {item.kind !== 'recent' && (
        <button
          type="button"
          aria-label="Close tab"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onClose?.(id);
          }}
          // Another tab's button takes no room until it's hovered, so a narrow tab keeps its name.
          className={`size-20 flex-none place-items-center rounded-xs text-fg-muted hover:bg-press hover:text-fg ${selected ? 'grid' : 'hidden group-hover:grid'}`}
        >
          <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** Whether a pull request's tab is still opening: it has no title yet, and says it's loading. */
function isLoading(item: PullTab): boolean {
  return item.loading === true && item.title === undefined;
}

/**
 * What a tab says: a pull request's state, place and title, or the name of one of Lo's own. As
 * the tab narrows, its title goes first, then its repository's name shortens, but never past
 * its first letter and an ellipsis, and never past half the tab; its number stays whole.
 */
function TabLabel({ tab: item, selected }: { tab: Tab; selected: boolean }) {
  const title = `min-w-0 flex-1 truncate ${selected ? 'font-medium' : ''}`;
  switch (item.kind) {
    case 'pull':
      return (
        <>
          {isLoading(item) ? (
            <Spinner size="xs" />
          ) : (
            item.state && <span className={state({ state: item.state })} title={item.state} />
          )}
          <span className="max-w-1/2 min-w-16 shrink truncate text-fg-muted">{item.repo} </span>
          <span className="lo-num flex-none text-fg-muted">#{item.number}</span>
          {isLoading(item) ? (
            <Skeleton className="w-48 min-w-0 shrink" />
          ) : (
            <span className={title}>{item.title}</span>
          )}
          {item.stack !== undefined && (
            <span
              className="inline-flex flex-none items-center gap-4 text-fg-muted text-micro"
              title={`Stack of ${item.stack}`}
            >
              <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2.25 13.75 5 8 7.75 2.25 5Z" />
                <path d="M2.25 8 8 10.75 13.75 8M2.25 11 8 13.75 13.75 11" />
              </svg>
              {item.stack}
            </span>
          )}
        </>
      );
    case 'recent':
      return (
        <>
          <svg className="lo-i lo-i--sm flex-none" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.25" />
            <path d="M8 4.75V8l2 1.5" />
          </svg>
          <span className={title}>Recent pull requests</span>
        </>
      );
    case 'settings':
      return (
        <>
          <svg className="lo-i lo-i--sm flex-none" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.25" />
            <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
          </svg>
          <span className={title}>Settings</span>
        </>
      );
    default:
      item satisfies never;
      throw new Error(`A tab of an unknown kind: ${JSON.stringify(item)}.`);
  }
}
