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
  const fit = useCallback(() => {
    const element = row.current;
    if (element) setGiven(giveUp(element, steps));
  }, [row, steps]);
  useLayoutEffect(fit);
  useEffect(() => {
    const element = row.current;
    if (!element) return undefined;
    let sized: ResizeObserver | undefined;
    // Each box watched once: watched again, a box is measured again, which would fit it again.
    const watched = new Set<Element>();
    const watch = () => {
      if (!sized) return;
      // What it has to keep whole narrows as other things in the row come, as a key chip on focus;
      // and what it's given up comes back as the room it can have grows.
      for (const each of [element, ...element.querySelectorAll('[data-fit]'), ...roomOf(element)]) {
        if (watched.has(each)) continue;
        watched.add(each);
        sized.observe(each);
      }
    };
    const refit = () => {
      fit();
      watch();
    };
    if (typeof ResizeObserver !== 'undefined') sized = new ResizeObserver(refit);
    const said = new MutationObserver(refit);
    said.observe(element, { subtree: true, childList: true, characterData: true });
    watch();
    return () => {
      said.disconnect();
      sized?.disconnect();
    };
  }, [row, fit]);
  return given;
}

/**
 * Has `row` give up what it draws, a step at a time in `steps`' order, until it fits, as
 * `useGiveUp` does, for a row React doesn't draw, such as a code view's file header: drawn whole and
 * measured, then without each step until it fits, in one go, so no frame shows it cut short. Call it
 * as the row is drawn and each time its room changes. Says how many steps it gave up.
 */
export function giveUp(row: HTMLElement, steps: readonly string[]): number {
  let count = 0;
  row.removeAttribute('data-gave-up');
  while (count < steps.length && !fits(row)) {
    count += 1;
    row.setAttribute('data-gave-up', steps.slice(0, count).join(' '));
  }
  return count;
}

/** How far out {@link roomOf} looks for a box as wide as its container lets it be. */
const ROOM_DEPTH = 8;

/**
 * What the room `row` can have comes from, besides itself. A row as wide as what it draws, as one
 * beside a spacer is, keeps its width as the window widens, so its own size never says it has room
 * again: what's beside it, and beside each box out from it that's as wide as what it holds, up to
 * the first that's as wide as its container lets it be, which grows with the window, do.
 */
function roomOf(row: HTMLElement): Element[] {
  const room: Element[] = [];
  let at: Element = row;
  for (let depth = 0; depth < ROOM_DEPTH && !fills(at); depth += 1) {
    const holder = boxParent(at);
    if (!holder) break;
    for (const each of boxChildren(holder)) if (each !== at) room.push(each);
    room.push(holder);
    at = holder;
  }
  return room;
}

/**
 * Whether `element`'s width is its container's to set, not what it holds: a block in the flow, a
 * flex item that grows along its row or stretches across its column, a grid item. One taken out of
 * the flow ends the search: its room isn't its container's.
 */
function fills(element: Element): boolean {
  const style = getComputedStyle(element);
  if (style.position === 'absolute' || style.position === 'fixed') return true;
  const holder = boxParent(element);
  if (!holder) return true;
  const outer = getComputedStyle(holder);
  if (outer.display === 'flex' || outer.display === 'inline-flex') {
    if (outer.flexDirection.startsWith('row')) return Number.parseFloat(style.flexGrow) > 0;
    const align = style.alignSelf === 'auto' ? outer.alignItems : style.alignSelf;
    return align === 'stretch' || align === 'normal';
  }
  if (outer.display === 'grid' || outer.display === 'inline-grid') return true;
  return !style.display.startsWith('inline') && style.float === 'none';
}

/** The box `element` is laid out in: its parent, past any that draw no box (`display: contents`). */
function boxParent(element: Element): Element | null {
  let holder = element.parentElement;
  while (holder && getComputedStyle(holder).display === 'contents') holder = holder.parentElement;
  return holder;
}

/** The boxes laid out in `holder`: its children, and those of any that draw no box of their own. */
function boxChildren(holder: Element): Element[] {
  return [...holder.children].flatMap((each) =>
    getComputedStyle(each).display === 'contents' ? boxChildren(each) : [each],
  );
}

/** Whether `element` draws all it has: it, and what in it is marked `data-fit`, isn't cut short. */
function fits(element: HTMLElement): boolean {
  if (element.scrollWidth > element.clientWidth) return false;
  for (const each of element.querySelectorAll<HTMLElement>('[data-fit]')) {
    if (each.scrollWidth > each.clientWidth) return false;
  }
  return true;
}
