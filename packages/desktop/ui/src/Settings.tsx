import { cva } from 'class-variance-authority';
import type { ReactNode, Ref, UIEvent } from 'react';

/** One of Settings' sections, as the list beside it names it. */
export interface SettingsNavItem {
  /** The id of the `SettingsSection` it goes to. */
  id: string;
  label: string;
}

const navItem = cva(
  'flex h-control-h items-center rounded-sm px-8 text-start text-ui focus-visible:shadow-ring-inset',
  {
    variants: {
      current: {
        true: 'bg-on-screen text-fg',
        false: 'text-fg-muted hover:bg-hover hover:text-fg',
      },
    },
  },
);

export interface SettingsPageProps {
  /** The list of sections beside the page. */
  items: readonly SettingsNavItem[];
  /** The section on screen. */
  current?: string | undefined;
  /** A section was chosen in the list. */
  onGo?: ((id: string) => void) | undefined;
  /** What sits at the foot of the list: where the settings live. */
  footer?: ReactNode;
  /** The `SettingsSection`s, and whatever is said about the settings as a whole above them. */
  children?: ReactNode;
  /** The scrolling body, to scroll to a section and to see which is on screen. */
  bodyRef?: Ref<HTMLDivElement>;
  onBodyScroll?: ((event: UIEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * Settings: a list of sections beside the sections themselves, which scroll. The page fills the
 * middle of the window and is its own sheet.
 */
export function SettingsPage({
  items,
  current,
  onGo,
  footer,
  children,
  bodyRef,
  onBodyScroll,
}: SettingsPageProps) {
  return (
    <div className="settings-page min-h-0 flex-1 overflow-hidden rounded-t-lg">
      <nav
        aria-label="Settings"
        className="flex min-h-0 flex-col gap-2 overflow-x-hidden overflow-y-auto border-e border-border-subtle bg-bg-chrome px-8 py-24"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={navItem({ current: item.id === current })}
            aria-current={item.id === current ? 'true' : undefined}
            onClick={() => onGo?.(item.id)}
          >
            {item.label}
          </button>
        ))}
        <div className="flex-1" />
        {footer !== undefined && (
          <div className="px-8 break-words text-fg-muted text-small">{footer}</div>
        )}
      </nav>
      <div
        ref={bodyRef}
        onScroll={onBodyScroll}
        className="flex min-h-0 flex-col gap-32 overflow-auto bg-bg px-40 pt-24 pb-64"
      >
        {children}
      </div>
    </div>
  );
}

export interface SettingsSectionProps {
  /** What the list beside Settings goes to. */
  id: string;
  title: string;
  /** A line under the title, for what the whole section is about. */
  description?: ReactNode;
  children?: ReactNode;
}

/** A section of Settings: a title and, under it, its settings, each one a `Setting`. */
export function SettingsSection({ id, title, description, children }: SettingsSectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-settings-section={id}
      className="w-full max-w-settings-w flex-none"
    >
      <h2 id={`${id}-title`} className="m-0 mb-4 read-h3">
        {title}
      </h2>
      {description !== undefined && (
        <p className="m-0 mb-12 text-fg-muted text-ui">{description}</p>
      )}
      {children}
    </section>
  );
}

export interface SettingProps {
  label: ReactNode;
  /** What it does, and what else changes it. */
  description?: ReactNode;
  /** The controls that change it, at the end of the row. */
  children?: ReactNode;
}

/** One setting: what it is called and does, with its controls at the end of the row. */
export function Setting({ label, description, children }: SettingProps) {
  return (
    <div className="setting-row border-t border-border-subtle py-12">
      <div className="text-ui-strong">{label}</div>
      {description !== undefined && (
        <div className="col-start-1 text-fg-muted text-small">{description}</div>
      )}
      {children !== undefined && (
        <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-8">{children}</div>
      )}
    </div>
  );
}
