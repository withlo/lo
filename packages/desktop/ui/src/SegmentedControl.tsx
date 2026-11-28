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
import { Tooltip } from './Tooltip.tsx';

/** One segment: what it stands for, and what it says. */
export interface Segment<T extends string> {
  value: T;
  /** A word or two, with anything that goes before it, such as a mark. */
  label: ReactNode;
  /**
   * Its name, for a segment whose label is sometimes its icon alone: a screen reader hears it
   * throughout.
   */
  name?: string | undefined;
  /**
   * Its tooltip, while its label is its icon alone: its name. `null` meanwhile, for a segment that
   * has one some of the time, so it's the same element throughout.
   */
  tip?: string | null | undefined;
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
  /**
   * For `views`, the segments whose views are on screen, where more than the chosen one is, as with
   * the code beside a reading view: neighbours, which the thumb spans, each `aria-current`. A click
   * on any of them calls `onChange`, as its view takes focus.
   */
  current?: readonly T[] | undefined;
  onChange: (value: T) => void;
  /** `sm` in panel toolbars and Settings' rows. */
  size?: 'md' | 'sm' | undefined;
  /**
   * The key that steps through the segments, as this system shows it, after the control, and only
   * while it can be changed.
   */
  keys?: readonly string[] | undefined;
  /**
   * It can't be changed now, as a comment box's Write | Preview while its comment is sent: dimmed,
   * the chosen segment still marked.
   */
  disabled?: boolean | undefined;
  /**
   * Why it can't be changed while it's `disabled`, in a few words: each segment's tooltip then, and
   * what a screen reader hears on it, as the Files panel's "Reading files…".
   */
  why?: string | undefined;
  /**
   * The thumb goes to a choice that changes in this render at once, in one frame, rather than
   * sliding there: for one the reader didn't make and hasn't seen coming, as a tab that has just
   * opened goes to another view by itself before its wait shows. A choice the reader makes, by key
   * or click, always slides.
   */
  jump?: boolean | undefined;
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
 * action: the middle-view switch, the Files panel's Tree | Review order, or a setting's choices.
 * Never draw such a choice as buttons of its own. The arrow keys move between the segments
 * and choose as they go; the control's own key, when it has one, follows it. One thumb marks the
 * chosen segment and slides to the next: the Slide move. Segments that come or go around a choice
 * that stays move it at once, with the segments.
 */
export function SegmentedControl<T extends string>({
  label,
  kind,
  items,
  value,
  current,
  onChange,
  size = 'md',
  keys,
  disabled = false,
  why,
  jump: jumps = false,
}: SegmentedControlProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());
  // Where the thumb is: under the chosen segment, measured, so it can slide from one to the next.
  // It's put there at once (`jump`) when the segments change around a choice that doesn't, as
  // when a segment leaves: the choice didn't move. So it is where the caller says the choice
  // jumps.
  const [thumb, setThumb] = useState<{ left: number; width: number; jump: boolean } | undefined>();
  // The segments there are, which a caller's new array of the same ones doesn't change: a label
  // that changes is the observer's to see.
  const segments = JSON.stringify(items.map((item) => item.value));
  // The segments the thumb covers: the chosen one, or those on screen with it.
  const spanned =
    current !== undefined && value !== undefined && current.includes(value) && current.length > 1
      ? current
      : value === undefined
        ? []
        : [value];
  const covered = JSON.stringify(spanned);
  // What the thumb was last measured under.
  const measured = useRef(covered);
  useLayoutEffect(() => {
    const under = spanned
      .map((each) => buttons.current.get(each))
      .filter((button): button is HTMLButtonElement => button !== undefined);
    const jump = measured.current === covered || jumps;
    measured.current = covered;
    const measure = (at = false) => {
      const laid = under.filter((button) => button.offsetWidth > 0);
      const left = Math.min(...laid.map((button) => button.offsetLeft));
      const right = Math.max(...laid.map((button) => button.offsetLeft + button.offsetWidth));
      const next = laid.length > 0 ? { left, width: right - left, jump: at } : undefined;
      setThumb((was) => (was?.left === next?.left && was?.width === next?.width ? was : next));
    };
    measure(jump);
    if (under.length === 0 || typeof ResizeObserver === 'undefined') return undefined;
    // A label that changes, or a font that loads, moves the segments under it.
    const watch = new ResizeObserver(() => measure());
    for (const button of buttons.current.values()) watch.observe(button);
    return () => watch.disconnect();
    // `spanned` is what `covered` says.
  }, [covered, segments, size, jumps]);
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
  // Why it's dimmed, while it is: each segment's tooltip, and its description to a screen reader.
  const refused = disabled && why !== undefined ? why : undefined;

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
            className={`absolute inset-y-2 left-0 rounded-pill bg-bg-element ring-1 ring-border-strong ${slides && !thumb.jump ? 'move-slide' : ''}`}
            style={{ translate: `${thumb.left}px 0`, width: thumb.width }}
          />
        )}
        {items.map((item) => {
          const chosen = item.value === value;
          const onScreen = spanned.length > 1 && spanned.includes(item.value);
          const button = (
            <button
              key={item.value}
              ref={(element) => {
                if (element) buttons.current.set(item.value, element);
                else buttons.current.delete(item.value);
              }}
              type="button"
              role={kind === 'views' ? 'tab' : 'radio'}
              aria-selected={kind === 'views' ? chosen : undefined}
              aria-current={onScreen || undefined}
              aria-checked={kind === 'choice' ? chosen : undefined}
              tabIndex={item.value === tabbable ? 0 : -1}
              aria-disabled={disabled || undefined}
              aria-description={refused}
              aria-label={item.name}
              className={segment({
                chosen: chosen || onScreen ? (thumb ? 'thumb' : true) : false,
                tone: disabled ? 'off' : chosen || onScreen ? 'chosen' : 'rest',
                size,
              })}
              onClick={() => {
                if ((!chosen || onScreen) && !disabled) onChange(item.value);
              }}
            >
              {item.label}
            </button>
          );
          // A control that can give a reason has its tooltips throughout, so its segments are the
          // same elements whether it's dimmed or not.
          return item.tip === undefined && why === undefined ? (
            button
          ) : (
            <Tooltip key={item.value} label={refused ?? item.tip ?? null}>
              {button}
            </Tooltip>
          );
        })}
      </div>
      {/* While it can't be changed, neither can its key change it: the chip goes, keeping its
          room, so nothing beside it moves. */}
      {keys !== undefined && (
        <Key keys={keys} decorative className={disabled ? 'invisible' : undefined} />
      )}
    </span>
  );
}
