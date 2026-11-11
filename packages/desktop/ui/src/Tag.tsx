import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

const tag = cva(
  'inline-flex flex-none items-center gap-2 rounded-xs border px-6 whitespace-nowrap text-micro',
  {
    variants: {
      tone: {
        neutral: 'border-border-strong text-fg-muted',
        ok: 'border-success-border bg-success-bg text-success',
        warning: 'border-warning-border bg-warning-bg text-warning',
        danger: 'border-danger-border bg-danger-bg text-danger',
        info: 'border-info-border bg-info-bg text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type TagTone = 'neutral' | 'ok' | 'warning' | 'danger' | 'info';

/** A short label beside a thing, one or two words in sentence case: "Signed out". */
export function Tag({ tone, children }: { tone?: TagTone | undefined; children: ReactNode }) {
  return <span className={tag({ tone })}>{children}</span>;
}
