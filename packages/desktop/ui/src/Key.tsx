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
}

/**
 * A key, or a sequence of keys, shown wherever an action has one. A chord is one key (`⌘⇧P`); a
 * sequence's keys sit side by side, never joined with a plus sign.
 */
export function Key({ keys, quiet = false }: KeyProps) {
  const caps = keys.map((key, index) => (
    <kbd key={index} className={cap({ quiet })}>
      {key}
    </kbd>
  ));
  if (caps.length === 1) return caps[0];
  return <span className="inline-flex flex-none items-center gap-2">{caps}</span>;
}
