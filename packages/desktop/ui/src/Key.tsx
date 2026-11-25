import { cva } from 'class-variance-authority';

import { Glyphs } from './Icon.tsx';

/**
 * A key cap's outside, and inside it a row of the key's letters and icons, centred, with no gap:
 * `key-icons` sets each icon's margins. `keyCap` makes the same inside in a code view's own DOM.
 */
const cap = cva(
  'key-icons inline-flex h-kbd-h min-w-kbd-h flex-none items-center justify-center rounded-xs key-cap px-4 whitespace-nowrap text-fg-muted code-key',
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
  /**
   * `focus` for a control repeated on every card or row: the chip shows only on the one the
   * keyboard is on, the nearest element marked `data-key-scope` that has `data-focused` or keyboard
   * focus in it. The others give the key in their tooltip (`hint` and `hintKeys` on `Button`).
   * Scopes don't nest.
   */
  when?: 'always' | 'focus' | undefined;
}

/** The attributes that say a control's key to a screen reader. */
export interface KeyAria {
  'aria-keyshortcuts'?: string;
  'aria-description'?: string;
}

/**
 * The attributes that say a control's key to a screen reader in place of its key caps: its
 * `aria-keyshortcuts` for one key or a chord, and for a sequence, whose spaces `aria-keyshortcuts`
 * can't write, a description. With `command`, for a control whose words say something other than
 * the command it runs, as the merge status's verdict does, the description names the command first,
 * as its tooltip does.
 */
export function keyAria(
  keys: readonly string[] | undefined,
  shortcut: string | undefined,
  command?: string,
): KeyAria {
  const sequence =
    shortcut === undefined && keys !== undefined && keys.length > 1
      ? `Keys ${keys.join(' then ')}`
      : undefined;
  const description = [command, sequence].filter((part) => part !== undefined).join(', ');
  return {
    ...(shortcut === undefined ? {} : { 'aria-keyshortcuts': shortcut }),
    ...(description === '' ? {} : { 'aria-description': description }),
  };
}

/**
 * A key, or a sequence of keys, shown wherever an action has one. A chord is one key (`⌘⇧P`); a
 * sequence's keys sit side by side, never joined with a plus sign. In a control it comes last,
 * after the label. It takes its control's state by itself: on a main button's fill it's drawn in
 * the fill's text colour, and on a dimmed control it dims with the label.
 *
 * A key's symbols, which the fonts don't hold (`⌘ ⌃ ⌥ ⇧ ⏎ ⇥ ⌫ ⌦` and the arrows), are icons from
 * `glyphs.ts`, 12 px at a 1.25 px stroke, so they weigh what its letters do; its words (`Esc`,
 * `Ctrl+Shift+P`) and letters stay text. The cap's text is the key as given, for a screen reader,
 * a copy and a test.
 */
export function Key({
  keys,
  quiet = false,
  className,
  decorative = false,
  when = 'always',
}: KeyProps) {
  const caps = keys.map((key, index) => (
    <kbd
      key={index}
      aria-hidden={decorative ? true : undefined}
      className={cap({ quiet, className })}
    >
      <Glyphs text={key} size={12} />
    </kbd>
  ));
  // A wrapper of its own carries the rule, since a key cap sets its own display.
  if (when === 'focus')
    return <span className="key-focus flex-none items-center gap-2">{caps}</span>;
  if (caps.length === 1) return caps[0];
  return <span className="inline-flex flex-none items-center gap-2">{caps}</span>;
}
