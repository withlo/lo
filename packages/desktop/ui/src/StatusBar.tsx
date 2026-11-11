import type { ReactNode } from 'react';

/**
 * The strip at the bottom of a pull request's tab: background work on the left, a dot and a word
 * each, then where you are on the right. Nothing in it needs a decision; that's a banner's job.
 */
export function StatusBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <footer
      aria-label="Status"
      className="flex h-statusbar-h min-w-0 flex-none items-center gap-2 bg-bg-chrome px-8 whitespace-nowrap text-fg-muted statusbar-edge text-micro"
    >
      {start}
      <span className="flex-1" />
      {end}
    </footer>
  );
}

const DOTS = {
  ok: 'bg-success',
  busy: 'bg-accent',
  warn: 'bg-warning',
  fail: 'bg-danger',
  idle: 'bg-fg-dim',
} as const;

/** One process in the status bar: a dot for how it is, its name, and its progress while it has some. */
export function StatusItem({
  dot,
  children,
  title,
}: {
  dot?: keyof typeof DOTS | undefined;
  children: ReactNode;
  title?: string | undefined;
}) {
  return (
    <span className="inline-flex h-20 min-w-0 items-center gap-6 rounded-xs px-6" title={title}>
      {dot !== undefined && <span className={`size-8 flex-none rounded-full ${DOTS[dot]}`} />}
      {children}
    </span>
  );
}
