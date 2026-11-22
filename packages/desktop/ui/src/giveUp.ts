import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Has a row on one line give up what it draws, a step at a time in `steps`' order, until it fits:
 * nothing in it runs past its end, and nothing in it marked `data-fit`, such as a name, is cut
 * short. Each step given up is named in the row's `data-gave-up`, which the stylesheet hides what
 * it draws by (`give-up`). It's measured, never given a width to give a step up at, since what it
 * draws is wider on one system than another and with one name than another: as it's drawn, as what
 * it says changes, as a key chip shows on focus, and as it's made narrower or wider.
 *
 * Returns how many steps it has given up. Pass `steps` that stay the same from draw to draw.
 */
export function useGiveUp(row: RefObject<HTMLElement | null>, steps: readonly string[]): number {
  const [given, setGiven] = useState(0);
  // Drawn whole and measured, then without each step until it fits, in one go, so no frame shows
  // it cut short.
  const fit = useCallback(() => {
    const element = row.current;
    if (!element) return;
    let count = 0;
    element.removeAttribute('data-gave-up');
    while (count < steps.length && !fits(element)) {
      count += 1;
      element.setAttribute('data-gave-up', steps.slice(0, count).join(' '));
    }
    setGiven(count);
  }, [row, steps]);
  useLayoutEffect(fit);
  useEffect(() => {
    const element = row.current;
    if (!element) return undefined;
    const said = new MutationObserver(fit);
    said.observe(element, { subtree: true, childList: true, characterData: true });
    const sized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    if (sized) {
      sized.observe(element);
      // What it has to keep whole narrows as other things in the row come, as a key chip on focus.
      for (const each of element.querySelectorAll('[data-fit]')) sized.observe(each);
    }
    return () => {
      said.disconnect();
      sized?.disconnect();
    };
  }, [row, fit]);
  return given;
}

/** Whether `element` draws all it has: it, and what in it is marked `data-fit`, isn't cut short. */
function fits(element: HTMLElement): boolean {
  if (element.scrollWidth > element.clientWidth) return false;
  for (const each of element.querySelectorAll<HTMLElement>('[data-fit]')) {
    if (each.scrollWidth > each.clientWidth) return false;
  }
  return true;
}
