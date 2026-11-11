import { cva } from 'class-variance-authority';

const cap = cva(
  'inline-flex h-kbd-h min-w-kbd-h flex-none items-center justify-center rounded-xs px-4 whitespace-nowrap text-fg-muted code-key',
  {
    variants: {
      quiet: {
        true: 'bg-hover',
        false: 'border border-border-strong key-edge',
      },
    },
  },
);

export interface KeyProps {
  /**
   * One key sequence, as the system shows each of its keys: `['⌘⇧P']` for a chord, `[']', 'f']`
   * for a sequence.
   */
  keys: readonly string[];
  /** Without the outline, for dense rows of hints. */
  quiet?: boolean | undefined;
  /** More classes for each key, such as how it looks on a fill of its own. */
  className?: string | undefined;
  /**
   * Hidden from screen readers, for a control that gives its key with `aria-keyshortcuts` (see
   * `keyAria`) instead of having the key caps read out as letters.
   */
  decorative?: boolean | undefined;
}

/** The attributes that say a control's key to a screen reader. */
export interface KeyAria {
  'aria-keyshortcuts'?: string;
  'aria-description'?: string;
}

/**
 * The attributes that say a control's key to a screen reader in place of its key caps: its
 * `aria-keyshortcuts` for one key or a chord, and for a sequence, whose spaces `aria-keyshortcuts`
 * can't write, a description.
 */
export function keyAria(
  keys: readonly string[] | undefined,
  shortcut: string | undefined,
): KeyAria {
  if (shortcut !== undefined) return { 'aria-keyshortcuts': shortcut };
  if (keys !== undefined && keys.length > 1)
    return { 'aria-description': `Keys ${keys.join(' then ')}` };
  return {};
}

/**
 * A key, or a sequence of keys, shown wherever an action has one. A chord is one key (`⌘⇧P`); a
 * sequence's keys sit side by side, never joined with a plus sign.
 */
export function Key({ keys, quiet = false, className, decorative = false }: KeyProps) {
  const caps = keys.map((key, index) => (
    <kbd
      key={index}
      aria-hidden={decorative ? true : undefined}
      className={cap({ quiet, className })}
    >
      {key}
    </kbd>
  ));
  if (caps.length === 1) return caps[0];
  return <span className="inline-flex flex-none items-center gap-2">{caps}</span>;
}
