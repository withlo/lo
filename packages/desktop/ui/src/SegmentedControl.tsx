import { cva } from 'class-variance-authority';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { Key } from './Key.tsx';

/** One segment: what it stands for, and what it says. */
export interface Segment<T extends string> {
  value: T;
  /** A word or two, with anything that goes before it, such as a mark. */
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  /** What is being chosen, for screen readers: "View". */
  label: string;
  /**
   * `views`, for segments that each show something else, as the middle-view switch's do (a tab
   * list); `choice`, for a setting (radio buttons).
   */
  kind: 'views' | 'choice';
  items: readonly Segment<T>[];
  /** The segment chosen, if any is. */
  value: T | undefined;
  onChange: (value: T) => void;
  /** `sm` in panel toolbars and Settings' rows. */
  size?: 'md' | 'sm' | undefined;
  /** The key that steps through the segments, as this system shows it, after the control. */
  keys?: readonly string[] | undefined;
}

const segment = cva(
  'inline-flex items-center rounded-pill whitespace-nowrap focus-visible:shadow-ring',
  {
    variants: {
      chosen: {
        true: 'bg-bg-element text-fg ring-1 ring-border-strong',
        false: 'text-fg-muted hover:text-fg',
      },
      size: {
        md: 'h-24 gap-6 px-12 text-small-medium',
        sm: 'h-20 gap-6 px-8 text-small-medium',
      },
    },
  },
);

/** The keys that move to the next segment and the one before. */
const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp']);

/**
 * Two to four options in a pill track, exactly one chosen at a time, each a state rather than an
 * action: the middle-view switch, or a setting's choices. The arrow keys move between the segments
 * and choose as they go; the control's own key, when it has one, follows it.
 */
export function SegmentedControl<T extends string>({
  label,
  kind,
  items,
  value,
  onChange,
  size = 'md',
  keys,
}: SegmentedControlProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  // The chosen segment takes focus by `Tab`, else the first.
  const tabbable = items.some((item) => item.value === value) ? value : items[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = NEXT.has(event.key) ? 1 : PREVIOUS.has(event.key) ? -1 : 0;
    if (step === 0 || items.length === 0) return;
    event.preventDefault();
    const at = items.findIndex((item) => item.value === value);
    const next = items[at < 0 ? 0 : (at + step + items.length) % items.length];
    if (next === undefined) return;
    onChange(next.value);
    buttons.current.get(next.value)?.focus();
  };

  return (
    <span className="inline-flex flex-none items-center gap-6">
      <div
        role={kind === 'views' ? 'tablist' : 'radiogroup'}
        aria-label={label}
        className="inline-flex items-center gap-2 rounded-pill bg-bg-well p-2 inset-ring inset-ring-border"
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          const chosen = item.value === value;
          return (
            <button
              key={item.value}
              ref={(element) => {
                if (element) buttons.current.set(item.value, element);
                else buttons.current.delete(item.value);
              }}
              type="button"
              role={kind === 'views' ? 'tab' : 'radio'}
              aria-selected={kind === 'views' ? chosen : undefined}
              aria-checked={kind === 'choice' ? chosen : undefined}
              tabIndex={item.value === tabbable ? 0 : -1}
              className={segment({ chosen, size })}
              onClick={() => {
                if (!chosen) onChange(item.value);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {keys !== undefined && <Key keys={keys} decorative />}
    </span>
  );
}
