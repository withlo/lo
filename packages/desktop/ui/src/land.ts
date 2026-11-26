// The Land move, with nothing but the DOM, so a code view's own DOM marks where a jump landed too.

/** The class of the Land move, for a view that draws its own rows, such as a code view's lines. */
export const LAND_CLASS = 'move-land';

let landed: { element: Element; stop: () => void } | undefined;

/**
 * Marks where a jump landed: the scroll itself is instant, and `element`, the target, takes a tint
 * that fades. One target shows at a time, so a jump made again before the last has faded, as a
 * held key does, takes the tint off the last at once.
 */
export function land(element: Element): void {
  landed?.stop();
  // Taking the class off and reading a size starts the fade afresh on the same target.
  void element.getBoundingClientRect();
  element.classList.add(LAND_CLASS);
  const stop = () => {
    element.classList.remove(LAND_CLASS);
    element.removeEventListener('animationend', ended);
    element.removeEventListener('animationcancel', ended);
    if (landed?.element === element) landed = undefined;
  };
  const ended = (event: Event) => {
    if (event.target === element) stop();
  };
  element.addEventListener('animationend', ended);
  element.addEventListener('animationcancel', ended);
  landed = { element, stop };
}
