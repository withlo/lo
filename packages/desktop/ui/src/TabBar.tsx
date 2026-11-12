import { Menu } from '@base-ui/react/menu';
import { cva } from 'class-variance-authority';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

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
      selected: {
        true: 'tab-flares bg-bg-chrome text-fg',
        false: 'text-fg-muted hover:bg-hover hover:text-fg',
      },
    },
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
 * fold into a menu after the last that does, "N more". The tab on screen never folds.
 */
export function TabBar({
  tabs,
  selected,
  onSelect,
  onClose,
  onNew,
  menuContainer,
  moreOpen,
  onMoreOpenChange,
  onFold,
}: TabBarProps) {
  const list = useRef<HTMLDivElement>(null);
  const plus = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const room = useRoom(list, plus, more, tabs.length);
  const { shown, folded } = foldTabs(tabs, selected, room);
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
        {shown.map((item) => (
          <TabItem
            key={item.id}
            tab={item}
            selected={item.id === selected}
            onSelect={onSelect}
            onClose={onClose}
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
 * known): the first that fit, in order, but with the tab on screen always among them, in the last
 * place when it's further along.
 */
export function foldTabs<T extends { readonly id: string }>(
  tabs: readonly T[],
  selected: string | undefined,
  room: number | undefined,
): { shown: T[]; folded: T[] } {
  if (room === undefined || tabs.length <= room) return { shown: [...tabs], folded: [] };
  const fits = Math.max(1, room);
  const at = tabs.findIndex((item) => item.id === selected);
  if (at < fits) return { shown: tabs.slice(0, fits), folded: tabs.slice(fits) };
  const shown = [...tabs.slice(0, fits - 1), ...tabs.slice(at, at + 1)];
  return { shown, folded: tabs.filter((item) => !shown.includes(item)) };
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
): number | undefined {
  const [room, setRoom] = useState<number | undefined>(undefined);
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
    setRoom(fits);
  });

  return room;
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

function TabItem({
  tab: item,
  selected,
  onSelect,
  onClose,
}: {
  tab: Tab;
  selected: boolean;
  onSelect: TabBarProps['onSelect'];
  onClose: TabBarProps['onClose'];
}) {
  const { id } = item;
  const loading = item.kind === 'pull' && isLoading(item);
  return (
    <div
      role="tab"
      aria-selected={selected}
      aria-busy={loading ? true : undefined}
      tabIndex={selected ? 0 : -1}
      data-tab={id}
      onClick={() => onSelect?.(id)}
      className={`group ${tab({ selected })}`}
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
