// Whether a name is drawn whole, for a tooltip that shows it only while it isn't: `Tooltip`'s
// `cut`, and a code view's `data-tip-cut`.

/**
 * What's drawn for a screen reader alone: an icon's character, which `Glyphs` and a key chip keep
 * in a 1 px box that its text always overflows.
 */
const HIDDEN = '.sr-only, .lo-sr';

/**
 * Whether `element`'s text is cut short where it's drawn, in it or in a part of it, as a path
 * whose folder ellipsizes, or a part of it its row gave up (`data-gives`), as a path drawn as its
 * name alone: a name drawn whole needs no tooltip to say it again.
 */
export function cutShort(element: Element): boolean {
  return [element, ...element.querySelectorAll('*')].some(
    (each) =>
      !each.closest(HIDDEN) &&
      ((each.clientWidth > 0 && each.scrollWidth > each.clientWidth) || givenUp(each)),
  );
}

/** Whether `element` is a part a row it's in gave up (`data-gives`), which the row doesn't draw. */
export function givenUp(element: Element): boolean {
  const step = element.getAttribute('data-gives');
  if (step === null) return false;
  for (let row = element.parentElement; row; row = row.parentElement) {
    if (row.getAttribute('data-gave-up')?.split(' ').includes(step)) return true;
  }
  return false;
}
