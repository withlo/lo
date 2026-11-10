import { cva } from 'class-variance-authority';

/** A pull request (or a whole stack) open in a tab. */
export interface Tab {
  id: string;
  /** The repository's name, without its owner. */
  repo: string;
  number: number;
  title: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  /** How many pull requests the tab's stack holds, when it holds one. */
  stack?: number | undefined;
}

export interface TabBarProps {
  tabs: readonly Tab[];
  /** The tab on screen. */
  selected?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  onClose?: ((id: string) => void) | undefined;
  /** Opens a pull request. Without it, the `+` button does nothing. */
  onNew?: (() => void) | undefined;
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
 * The strip of pull request tabs at the top of the window, which Lo draws on every system. It's
 * where the window is dragged from; its tabs and buttons aren't. It starts after macOS's traffic
 * lights and ends before Linux's window controls (`--lo-window-inset-start` and `-end`).
 */
export function TabBar({ tabs, selected, onSelect, onClose, onNew }: TabBarProps) {
  return (
    <div className="h-tabbar-h shrink-0 bg-bg ps-window-inset-start pe-window-inset-end drag">
      <div
        role="tablist"
        aria-label="Pull requests"
        className="relative flex h-full min-w-0 gap-2 px-8"
      >
        {tabs.map((item) => (
          <TabItem
            key={item.id}
            tab={item}
            selected={item.id === selected}
            onSelect={onSelect}
            onClose={onClose}
          />
        ))}
        <button
          type="button"
          aria-label="Open a pull request"
          aria-disabled={onNew ? undefined : true}
          onClick={onNew}
          className="ms-6 grid size-control-h-sm place-items-center self-center rounded-sm text-fg-muted no-drag hover:bg-hover hover:text-fg focus-visible:shadow-ring"
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

function TabItem({
  tab: { id, repo, number, title, state: prState, stack },
  selected,
  onSelect,
  onClose,
}: {
  tab: Tab;
  selected: boolean;
  onSelect: TabBarProps['onSelect'];
  onClose: TabBarProps['onClose'];
}) {
  return (
    <div
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect?.(id)}
      className={`group ${tab({ selected })}`}
    >
      <span className={state({ state: prState })} title={prState} />
      <span className="flex-none text-fg-muted">
        {repo} <span className="lo-num">#{number}</span>
      </span>
      <span className={`min-w-0 flex-1 truncate ${selected ? 'font-medium' : ''}`}>{title}</span>
      {stack !== undefined && (
        <span
          className="inline-flex flex-none items-center gap-4 text-fg-muted text-micro"
          title={`Stack of ${stack}`}
        >
          <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.25 13.75 5 8 7.75 2.25 5Z" />
            <path d="M2.25 8 8 10.75 13.75 8M2.25 11 8 13.75 13.75 11" />
          </svg>
          {stack}
        </span>
      )}
      <button
        type="button"
        aria-label="Close tab"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          onClose?.(id);
        }}
        className={`grid size-20 flex-none place-items-center rounded-xs text-fg-muted hover:bg-press hover:text-fg ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
