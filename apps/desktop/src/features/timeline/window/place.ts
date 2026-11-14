// Where the reader is in a timeline on screen, kept as rows come and go, and how far from the top it
// is: the box at its end while they write in it, or while the list is scrolled to its end, so what
// comes last shows above it; or else the row the keyboard is on, while it's on screen; or else the
// first row on screen. Taken just before what main sent goes on screen, and put back once it's
// drawn, so what the reader looks at stays where it is, and what changed above or below it moves
// instead.

/** A place in a timeline: what's kept in place, by its row's key or `box`, and how far down it is. */
export interface ReadingPlace {
  readonly key: string;
  readonly offset: number;
}

/** What a place is kept by: a row, by its key, or the box at the end. */
const KEPT = 'li[data-key], [data-lo-timeline="box"]';

/** The key an element of `KEPT` is kept by. */
function keyOf(element: Element): string | undefined {
  if (element instanceof HTMLElement && element.dataset['key'] !== undefined) {
    return element.dataset['key'];
  }
  return element.matches('[data-lo-timeline="box"]') ? 'box' : undefined;
}

/** The element `key` names in `root`. */
function elementOf(root: HTMLElement, key: string): Element | undefined {
  for (const element of root.querySelectorAll(KEPT)) if (keyOf(element) === key) return element;
  return undefined;
}

/** How near the end, in pixels, a list scrolled there is, as a fraction of a pixel may be left. */
const AT_END = 1;

/**
 * Where the reader is in `root`, the timeline's scrolling element, the keyboard on the row
 * `keyboard`: the box at its end while focus is in it, or while `root` is scrolled to its end; or
 * else that row while it's on screen; or else the first row on screen. Nothing when nothing is.
 */
export function readingPlace(
  root: HTMLElement,
  keyboard: string | undefined,
): ReadingPlace | undefined {
  const frame = root.getBoundingClientRect();
  const onScreen = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > frame.top && rect.top < frame.bottom;
  };
  const elements = [...root.querySelectorAll(KEPT)];
  const box = elements.find((element) => keyOf(element) === 'box');
  const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - AT_END;
  const writing = box?.contains(root.ownerDocument.activeElement) ?? false;
  const rows = elements.filter((element) => keyOf(element) !== 'box' && onScreen(element));
  const kept =
    (box && onScreen(box) && (writing || atEnd) ? box : undefined) ??
    rows.find((element) => keyboard !== undefined && keyOf(element) === keyboard) ??
    rows[0];
  const key = kept && keyOf(kept);
  if (!kept || key === undefined) return undefined;
  return { key, offset: kept.getBoundingClientRect().top - frame.top };
}

/**
 * Scrolls `root` so what `place` names is as far down as it was. Nothing when it's gone, as a row
 * deleted is.
 */
export function keepPlace(root: HTMLElement, place: ReadingPlace): void {
  const element = elementOf(root, place.key);
  if (!element) return;
  const offset = element.getBoundingClientRect().top - root.getBoundingClientRect().top;
  const by = offset - place.offset;
  if (Math.abs(by) >= 0.5) root.scrollTop += by;
}
