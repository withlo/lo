// Whether a name is drawn whole, for a tooltip that shows it only while it isn't: `Tooltip`'s
// `cut`, and a code view's `data-tip-cut`.

/**
 * Whether `element`'s text is cut short where it's drawn, in it or in a part of it, as a path
 * whose folder ellipsizes: a name drawn whole needs no tooltip to say it again.
 */
export function cutShort(element: Element): boolean {
  return [element, ...element.querySelectorAll('*')].some(
    (each) => each.clientWidth > 0 && each.scrollWidth > each.clientWidth,
  );
}
