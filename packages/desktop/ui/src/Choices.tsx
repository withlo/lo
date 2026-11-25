import { cva } from 'class-variance-authority';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

/** One option among a few. */
export interface ChoiceItem<T extends string> {
  value: T;
  title: ReactNode;
  /** A line that explains it, and when it can't be chosen, why. */
  description?: ReactNode;
  /** It can't be chosen; its description says why. */
  disabled?: boolean | undefined;
  /**
   * What the option looks like, for cards drawn `across`: one of `@lo/ui`'s pictures, over the
   * card's ball and title. The card holds it 64 px high and as wide as its inside.
   */
  picture?: ReactNode;
}

export interface ChoicesProps<T extends string> {
  /** What is being chosen, for screen readers: "Account". */
  label: string;
  items: readonly ChoiceItem<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  /**
   * The cards side by side, sharing the row equally, each a picture over its title, rather than
   * stacked: for choices a person makes by looking. `←` and `→` choose, and `↑` and `↓` go to the
   * chosen card of the group drawn across above or below.
   */
  across?: boolean | undefined;
}

const choice = cva(
  'flex w-full cursor-default rounded-md border text-start move-tint focus-visible:shadow-ring',
  {
    variants: {
      // The chosen one keeps the hairline: its tint and filled ball mark it, and the accent's edge
      // is focus's alone.
      checked: {
        true: 'border-border bg-accent-soft',
        false: 'border-border hover:bg-hover',
      },
      disabled: { true: 'hover:bg-transparent', false: '' },
      across: {
        true: 'min-w-0 flex-col gap-8 p-8',
        false: 'items-start gap-8 px-12 py-8',
      },
    },
  },
);

const ball = cva('size-16 flex-none rounded-pill move-tint', {
  variants: {
    checked: { true: 'ball-on', false: 'text-border-strong hollow' },
    disabled: { true: 'text-fg-disabled', false: '' },
    across: { true: '', false: 'mt-2' },
  },
});

const title = cva('flex items-center gap-6 text-ui-strong', {
  variants: { disabled: { true: 'text-fg-muted', false: 'text-fg' } },
});

/** Stacked, the keys that choose the next choice and the one before: Vim's and the arrows. */
const NEXT = new Set(['ArrowDown', 'ArrowRight', 'j']);
const PREVIOUS = new Set(['ArrowUp', 'ArrowLeft', 'k']);
/** Across, the keys that choose along the row, and those that go to the group above or below. */
const RIGHT = new Set(['ArrowRight', 'l']);
const LEFT = new Set(['ArrowLeft', 'h']);
const DOWN = new Set(['ArrowDown', 'j']);
const UP = new Set(['ArrowUp', 'k']);

/** What marks a group of cards drawn across, which `↑` and `↓` go between. */
const ACROSS = '[role="radiogroup"][data-choices="across"]';

/**
 * Focuses the chosen card of the group drawn across before `group` (`-1`) or after it, among those
 * in its scope that a key can reach: nothing past the first or the last.
 */
function focusGroup(group: HTMLElement, by: 1 | -1): void {
  const scope = group.closest('[data-lo-scope]') ?? group.ownerDocument;
  const groups = [...scope.querySelectorAll<HTMLElement>(ACROSS)].filter(
    (each) => each.closest('[inert]') === null,
  );
  const next = groups[groups.indexOf(group) + by];
  next?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
}

/**
 * One option among a few, as radio buttons: stacked, each with a line that explains it, or
 * `across`, each card a picture of what it does over its title. Stacked, the arrows, or `j` and
 * `k`, move through those that can be chosen and choose as they go. Across, `←` and `→`, or `h` and
 * `l`, do, round the ends, and `↑` and `↓`, or `k` and `j`, go to the chosen card of the group above
 * or below, choosing nothing. `Space` and a click choose a card. Offer only what's allowed, and say
 * in its line why any other can't be chosen.
 */
export function Choices<T extends string>({
  label,
  items,
  value,
  onChange,
  across = false,
}: ChoicesProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => item.disabled !== true);
  // The checked choice takes focus by `Tab`, else the first that can be chosen.
  const tabbable = enabled.some((item) => item.value === value) ? value : enabled[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (across && (UP.has(event.key) || DOWN.has(event.key))) {
      event.preventDefault();
      focusGroup(event.currentTarget, DOWN.has(event.key) ? 1 : -1);
      return;
    }
    const forward = across ? RIGHT : NEXT;
    const backward = across ? LEFT : PREVIOUS;
    const step = forward.has(event.key) ? 1 : backward.has(event.key) ? -1 : 0;
    if (step === 0 || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((item) => item.value === value);
    const next = enabled[at < 0 ? 0 : (at + step + enabled.length) % enabled.length] ?? enabled[0];
    if (next === undefined) return;
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      // How its cards are laid out, and that they're cards: chosen by reaching them, so a form's
      // ⏎ on one goes on rather than choosing it again.
      data-choices={across ? 'across' : 'stacked'}
      className={across ? 'grid choices-across gap-8' : 'grid gap-8'}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        const checked = item.value === value;
        const disabled = item.disabled === true;
        const ballMark = (
          <span className={ball({ checked, disabled, across })} aria-hidden="true" />
        );
        const description = item.description !== undefined && (
          <span className="text-fg-muted text-small">{item.description}</span>
        );
        return (
          <button
            key={item.value}
            ref={(element) => {
              if (element) buttons.current.set(item.value, element);
              else buttons.current.delete(item.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={item.value === tabbable ? 0 : -1}
            onClick={() => {
              if (!disabled) onChange(item.value);
            }}
            className={choice({ checked, disabled, across })}
          >
            {across ? (
              <>
                {item.picture !== undefined && (
                  <span className="pointer-events-none flex h-64 w-full">{item.picture}</span>
                )}
                {/* Its description starts at the card's edge, under the ball. */}
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="flex items-center gap-8">
                    {ballMark}
                    <span className={title({ disabled })}>{item.title}</span>
                  </span>
                  {description}
                </span>
              </>
            ) : (
              <>
                {ballMark}
                <span className="flex min-w-0 flex-col gap-2">
                  <span className={title({ disabled })}>{item.title}</span>
                  {description}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
