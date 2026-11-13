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

/**
 * One process in the status bar: a dot for how it is, its name, and its progress while it has some.
 * With `onClick`, it's a button, for something it does, such as a banner's action folded into the
 * status bar.
 */
export function StatusItem({
  dot,
  children,
  title,
  onClick,
}: {
  dot?: keyof typeof DOTS | undefined;
  children: ReactNode;
  title?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  const content = (
    <>
      {dot !== undefined && <span className={`size-8 flex-none rounded-full ${DOTS[dot]}`} />}
      {children}
    </>
  );
  const item = 'inline-flex h-20 min-w-0 items-center gap-6 rounded-xs px-6';
  if (onClick === undefined) {
    return (
      <span className={item} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={`${item} hover:bg-hover hover:text-fg focus-visible:shadow-ring`}
      title={title}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

/** How each kind of mode draws, as a comment box's foot draws it. */
const MODES = {
  normal: 'mode-chip mode-chip-normal',
  visual: 'mode-chip',
  insert: 'mode-chip mode-chip-insert',
} as const;

/**
 * Vim's mode, at the status bar's end, named as Vim names it: `NORMAL`, `VISUAL`, `V-LINE`,
 * `V-BLOCK` or `INSERT`.
 */
export function StatusMode({ name }: { name: string }) {
  const kind = name === 'NORMAL' ? 'normal' : name === 'INSERT' ? 'insert' : 'visual';
  return (
    <span className={`flex-none ${MODES[kind]}`} title="Vim’s mode in the code that has focus">
      {name}
    </span>
  );
}
