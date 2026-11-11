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
}

export interface ChoicesProps<T extends string> {
  /** What is being chosen, for screen readers: "Account". */
  label: string;
  items: readonly ChoiceItem<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
}

const choice = cva(
  'flex w-full cursor-default items-start gap-8 rounded-md border px-12 py-8 text-start focus-visible:shadow-ring',
  {
    variants: {
      checked: {
        true: 'border-accent bg-accent-soft',
        false: 'border-border hover:bg-hover',
      },
      disabled: { true: 'hover:bg-transparent', false: '' },
    },
  },
);

const ball = cva('mt-2 size-16 flex-none rounded-pill', {
  variants: {
    checked: { true: 'ball-on', false: 'text-border-strong hollow' },
    disabled: { true: 'text-fg-disabled', false: '' },
  },
});

/** The keys that move to the next choice and the one before, Vim's and the arrows. */
const NEXT = new Set(['ArrowDown', 'ArrowRight', 'j']);
const PREVIOUS = new Set(['ArrowUp', 'ArrowLeft', 'k']);

/**
 * One option among a few, each with a line that explains it, as radio buttons. The arrows, or `j`
 * and `k`, move through those that can be chosen and choose as they go. Offer only what's allowed,
 * and say in its line why any other can't be chosen.
 */
export function Choices<T extends string>({ label, items, value, onChange }: ChoicesProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((item) => item.disabled !== true);
  // The checked choice takes focus by `Tab`, else the first that can be chosen.
  const tabbable = enabled.some((item) => item.value === value) ? value : enabled[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
    if (step === 0 || enabled.length === 0) return;
    event.preventDefault();
    const at = enabled.findIndex((item) => item.value === value);
    const next = enabled[at < 0 ? 0 : (at + step + enabled.length) % enabled.length] ?? enabled[0];
    if (next === undefined) return;
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className="grid gap-8" onKeyDown={onKeyDown}>
      {items.map((item) => {
        const checked = item.value === value;
        const disabled = item.disabled === true;
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
            className={choice({ checked, disabled })}
          >
            <span className={ball({ checked, disabled })} aria-hidden="true" />
            <span className="flex min-w-0 flex-col gap-2">
              <span
                className={
                  disabled
                    ? 'flex items-center gap-6 text-fg-muted text-ui-strong'
                    : 'flex items-center gap-6 text-fg text-ui-strong'
                }
              >
                {item.title}
              </span>
              {item.description !== undefined && (
                <span className="text-fg-muted text-small">{item.description}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
