// Moving through an overview's article by its blocks: which of them the block keys stop at, what
// takes focus for one, the links and controls inside one that `Tab` goes between, and stepping a
// walkthrough or a set of tabs inside one. The article draws each block that holds something to act
// on with its number, Lo's own (`data-lo-block`), which is all a block is known by elsewhere.

/** The attribute that holds a block's number among the article's blocks. */
export const BLOCK_ATTRIBUTE = 'data-lo-block';

/** The blocks of `article` the block keys stop at, in the order they're written. */
export function blockStops(article: Element): HTMLElement[] {
  return [...article.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(BLOCK_ATTRIBUTE),
  );
}

/** The block of `article`'s that `element` is in, or is, if it's in one. */
export function blockOf(article: Element, element: Element | null): HTMLElement | undefined {
  for (let at = element; at && at !== article; at = at.parentElement) {
    if (
      at.parentElement === article &&
      at instanceof HTMLElement &&
      at.hasAttribute(BLOCK_ATTRIBUTE)
    ) {
      return at;
    }
  }
  return undefined;
}

/** A block's number among the article's blocks. */
export function blockNumber(block: Element): number | undefined {
  const value = block.getAttribute(BLOCK_ATTRIBUTE);
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/** What takes focus for `block`: a fold's title, which opens and closes it, or the block itself. */
export function focusTargetOf(block: HTMLElement): HTMLElement {
  if (block.localName === 'details') {
    const title = [...block.children].find((child) => child.localName === 'summary');
    if (title instanceof HTMLElement) return title;
  }
  return block;
}

/** What `Tab` goes between inside a block: links, figures' parts and controls. */
const STOPS = '[role="link"], button, summary';

/**
 * The links, figure parts and controls in `block` that `Tab` goes between, in order: those shown
 * now, which a closed fold or a tab not chosen hides, that can take focus. The block's own focus,
 * such as a fold's title, isn't one of them.
 */
export function linksIn(block: HTMLElement): (HTMLElement | SVGElement)[] {
  const own = focusTargetOf(block);
  return [...block.querySelectorAll(STOPS)].filter(
    (element): element is HTMLElement | SVGElement =>
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      element !== own &&
      element.tabIndex >= 0 &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      !hiddenIn(block, element),
  );
}

/** Whether `element` is hidden inside `block`: in a panel not shown, or in a closed fold's body. */
function hiddenIn(block: Element, element: Element): boolean {
  let child: Element = element;
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (at.hasAttribute('hidden')) return true;
    if (at.localName === 'details' && !at.hasAttribute('open') && child.localName !== 'summary') {
      return true;
    }
    if (at === block) return false;
    child = at;
  }
  return false;
}

/** How a walkthrough or a set of tabs steps to its next or previous step or tab. */
type Stepper = (by: 1 | -1) => boolean;

const steppers = new WeakMap<Element, Stepper>();

/**
 * Lets `element`, a walkthrough's or a set of tabs' own, step with `stepIn`. Returns a function
 * that takes it back.
 */
export function setStepper(element: Element, step: Stepper): () => void {
  steppers.set(element, step);
  return () => {
    if (steppers.get(element) === step) steppers.delete(element);
  };
}

/**
 * Steps the walkthrough or the tabs `block` shows, the outermost if it holds more than one: to the
 * next step or tab with `1`, the one before with `-1`. Says whether it moved: a walkthrough stops
 * at its first and last steps, and tabs go round.
 */
export function stepIn(block: Element, by: 1 | -1): boolean {
  const own = block.matches('.lo-walk, .lo-tabs')
    ? block
    : block.querySelector('.lo-walk, .lo-tabs');
  const step = own ? steppers.get(own) : undefined;
  return step ? step(by) : false;
}

/** Whether `block` holds a walkthrough or tabs that `stepIn` steps. */
export function hasSteps(block: Element): boolean {
  const own = block.matches('.lo-walk, .lo-tabs')
    ? block
    : block.querySelector('.lo-walk, .lo-tabs');
  return own !== null && steppers.has(own);
}
