import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

const callout = cva('flex items-start gap-8 rounded-md border px-12 py-8 text-small', {
  variants: {
    tone: {
      info: 'border-info-border bg-info-bg',
      warning: 'border-warning-border bg-warning-bg',
      danger: 'border-danger-border bg-danger-bg',
    },
  },
});

const icon = cva('mt-2 flex-none', {
  variants: {
    tone: { info: 'text-info', warning: 'text-warning', danger: 'text-danger' },
  },
});

export type CalloutTone = 'info' | 'warning' | 'danger';

/** The icon each tone shows, so a status color never stands without one. */
const ICONS: Readonly<Record<CalloutTone, ReactNode>> = {
  info: (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.75v.01" />
    </svg>
  ),
  warning: (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6.25v3M8 11.25v.01" />
    </svg>
  ),
  danger: (
    <svg className="lo-i lo-i--sm" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.75 13 3.5v4c0 3.2-2.1 5.6-5 6.75C5.1 13.1 3 10.7 3 7.5v-4Z" />
    </svg>
  ),
};

export interface CalloutProps {
  tone: CalloutTone;
  children: ReactNode;
  /** `alert` for what went wrong just now, so a screen reader says it at once. */
  role?: 'alert' | 'status' | undefined;
}

/**
 * A note inside a dialog or a section: what to know before going on, or why something can't
 * happen and what to do about it.
 */
export function Callout({ tone, children, role }: CalloutProps) {
  return (
    <div role={role} className={callout({ tone })}>
      <span className={icon({ tone })}>{ICONS[tone]}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
