// Tooltips for the controls a code view draws in the DOM, where React's `Tooltip` doesn't reach:
// the viewed ball in a file's header, the `+` in the gutter. They look and wait as `Tooltip` does:
// a control's name and its key, after the pointer rests on it, and never a state or an error. A
// control that can't run says why instead.

/** What a control's tooltip says: its name, or why it can't run, and its key. */
export interface Tip {
  readonly label: string;
  /** Its key, as the system shows each key of it. */
  readonly keys?: readonly string[] | undefined;
}

/** How long the pointer rests on a control before its tip comes, in milliseconds, as `Tooltip`'s. */
export const TIP_DELAY = 500;

/** The gap between a control and its tip, and between a tip and the window's edge. */
const GAP = 6;
const EDGE = 8;

/** What marks an element as a control with a tip: the command it runs, or a tip of its own. */
export const TIPPED = '[data-command], [data-tip]';

/**
 * Shows a tip under each control in `root` the pointer rests on, as `tipOf` says it, and takes it
 * away as the pointer leaves, a button goes down, a key is pressed or anything scrolls. Returns a
 * function that stops.
 */
export function tips(
  root: HTMLElement,
  tipOf: (control: HTMLElement) => Tip | undefined,
): () => void {
  let over: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: HTMLElement | undefined;

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
    over = undefined;
    shown?.remove();
    shown = undefined;
  };

  const show = (control: HTMLElement): void => {
    const tip = control.isConnected ? tipOf(control) : undefined;
    if (!tip) return;
    const popup = document.createElement('div');
    popup.className = 'lo-tip';
    popup.setAttribute('role', 'tooltip');
    popup.append(tip.label);
    if (tip.keys && tip.keys.length > 0) {
      const keys = document.createElement('span');
      keys.className = 'lo-tip__keys';
      keys.setAttribute('aria-hidden', 'true');
      for (const key of tip.keys) {
        const cap = document.createElement('kbd');
        cap.textContent = key;
        keys.append(cap);
      }
      popup.append(keys);
    }
    (root.closest('.lo-app') ?? document.body).append(popup);
    const at = control.getBoundingClientRect();
    const size = popup.getBoundingClientRect();
    const below = at.bottom + GAP + size.height <= window.innerHeight - EDGE;
    const left = at.left + at.width / 2 - size.width / 2;
    popup.style.left = `${Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - size.width))}px`;
    popup.style.top = `${below ? at.bottom + GAP : at.top - GAP - size.height}px`;
    shown = popup;
  };

  const onOver = (event: Event): void => {
    const control =
      event.target instanceof Element ? event.target.closest<HTMLElement>(TIPPED) : null;
    if (control === (over ?? null)) return;
    hide();
    if (!control || !root.contains(control)) return;
    over = control;
    timer = setTimeout(() => show(control), TIP_DELAY);
  };
  const onOut = (event: MouseEvent): void => {
    const to = event.relatedTarget;
    if (over && !(to instanceof Node && over.contains(to))) hide();
  };

  root.addEventListener('mouseover', onOver);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('mousedown', hide, true);
  root.addEventListener('keydown', hide, true);
  root.addEventListener('wheel', hide, { capture: true, passive: true });
  root.addEventListener('scroll', hide, { capture: true, passive: true });
  return () => {
    hide();
    root.removeEventListener('mouseover', onOver);
    root.removeEventListener('mouseout', onOut);
    root.removeEventListener('mousedown', hide, true);
    root.removeEventListener('keydown', hide, true);
    root.removeEventListener('wheel', hide, true);
    root.removeEventListener('scroll', hide, true);
  };
}
