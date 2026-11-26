import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';

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
const ICONS: Readonly<Record<CalloutTone, IconName>> = {
  info: 'info',
  warning: 'triangle-exclamation-point',
  danger: 'shield',
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
      <Icon name={ICONS[tone]} size={12} className={icon({ tone })} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
