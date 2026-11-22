import { cva } from 'class-variance-authority';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

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
  /**
   * It can't be changed now, as a comment box's Write | Preview while its comment is sent: dimmed,
   * the chosen segment still marked.
   */
  disabled?: boolean | undefined;
}

const segment = cva(
  'relative inline-flex items-center rounded-pill whitespace-nowrap move-tint focus-visible:shadow-ring',
  {
    variants: {
      chosen: {
        // Drawn on the segment itself until the thumb has been measured, and where it can't be.
        true: 'bg-bg-element ring-1 ring-border-strong',
        thumb: '',
        false: '',
      },
      // Dimmed, as the control is when it can't be changed, the chosen segment too.
      tone: { chosen: 'text-fg', rest: 'text-fg-muted hover:text-fg', off: 'text-fg-disabled' },
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
 * and choose as they go; the control's own key, when it has one, follows it. One thumb marks the
 * chosen segment and slides to the next: the Slide move.
 */
export function SegmentedControl<T extends string>({
  label,
  kind,
  items,
  value,
  onChange,
  size = 'md',
  keys,
  disabled = false,
}: SegmentedControlProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  // Where the thumb is: under the chosen segment, measured, so it can slide from one to the next.
  const [thumb, setThumb] = useState<{ left: number; width: number } | undefined>();
  // The segments there are, which a caller's new array of the same ones doesn't change: a label
  // that changes is the observer's to see.
  const segments = JSON.stringify(items.map((item) => item.value));
  useLayoutEffect(() => {
    const chosen = value === undefined ? undefined : buttons.current.get(value);
    const measure = () => {
      const next =
        chosen && chosen.offsetWidth > 0
          ? { left: chosen.offsetLeft, width: chosen.offsetWidth }
          : undefined;
      setThumb((was) => (was?.left === next?.left && was?.width === next?.width ? was : next));
    };
    measure();
    if (!chosen || typeof ResizeObserver === 'undefined') return undefined;
    // A label that changes, or a font that loads, moves the segments under it.
    const watch = new ResizeObserver(measure);
    for (const button of buttons.current.values()) watch.observe(button);
    return () => watch.disconnect();
  }, [value, segments, size]);
  // It's put in place, not slid there, the first time.
  const placed = thumb !== undefined;
  const [slides, setSlides] = useState(false);
  useEffect(() => {
    if (!placed) {
      setSlides(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setSlides(true));
    return () => cancelAnimationFrame(frame);
  }, [placed]);
  // The chosen segment takes focus by `Tab`, else the first.
  const tabbable = items.some((item) => item.value === value) ? value : items[0]?.value;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || disabled) return;
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
        aria-disabled={disabled || undefined}
        className="relative inline-flex items-center gap-2 rounded-pill bg-bg-well p-2 inset-ring inset-ring-border"
        onKeyDown={onKeyDown}
      >
        {thumb && (
          <span
            aria-hidden="true"
            className={`absolute inset-y-2 left-0 rounded-pill bg-bg-element ring-1 ring-border-strong ${slides ? 'move-slide' : ''}`}
            style={{ translate: `${thumb.left}px 0`, width: thumb.width }}
          />
        )}
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
              aria-disabled={disabled || undefined}
              className={segment({
                chosen: chosen ? (thumb ? 'thumb' : true) : false,
                tone: disabled ? 'off' : chosen ? 'chosen' : 'rest',
                size,
              })}
              onClick={() => {
                if (!chosen && !disabled) onChange(item.value);
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
