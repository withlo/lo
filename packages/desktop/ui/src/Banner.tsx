import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { Button } from './Button.tsx';

const banner = cva('flex min-w-0 items-center gap-12 py-6 ps-16 pe-12 text-fg text-ui', {
  variants: {
    tone: {
      info: 'banner-info',
      warn: 'banner-warn',
      danger: 'banner-danger',
    },
  },
});

const icon = cva('flex-none', {
  variants: {
    tone: { info: 'text-info', warn: 'text-warning', danger: 'text-danger' },
  },
});

/** Something a banner offers to do. Its label starts with a verb. */
export interface BannerAction {
  label: string;
  onClick: () => void;
}

export interface BannerProps {
  tone: 'info' | 'warn' | 'danger';
  /** What happened, in a strong first clause. */
  title: ReactNode;
  /** What else to know, or what to do, after it. */
  detail?: ReactNode;
  actions?: readonly BannerAction[] | undefined;
  /** Dismisses it, for a banner whose state can wait. */
  onDismiss?: (() => void) | undefined;
}

/**
 * A full-width message under the PR header, about the whole tab: what happened, then what to do,
 * with its actions. A tab shows two at most. A `danger` banner is an alert; the others are
 * announced politely.
 */
export function Banner({ tone, title, detail, actions = [], onDismiss }: BannerProps) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={banner({ tone })}>
      <BannerIcon tone={tone} />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">{title}</strong>
        {detail !== undefined && <span className="text-fg-muted"> {detail}</span>}
      </p>
      {(actions.length > 0 || onDismiss) && (
        <div className="flex flex-none items-center gap-6">
          {actions.map((action) => (
            <Button key={action.label} size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
          {onDismiss && (
            <Button size="sm" variant="ghost" icon aria-label="Dismiss" onClick={onDismiss}>
              <svg className="lo-i lo-i--xs" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BannerIcon({ tone }: { tone: BannerProps['tone'] }) {
  return (
    <svg className={`lo-i ${icon({ tone })}`} viewBox="0 0 16 16" aria-hidden="true">
      {tone === 'info' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4M8 4.75v.01" />
        </>
      ) : (
        <>
          <path d="M8 2.25 14.25 13.25H1.75Z" />
          <path d="M8 6.5v3M8 11.25v.01" />
        </>
      )}
    </svg>
  );
}
