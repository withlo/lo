// Moving through an overview's article by its blocks: which of them the block keys stop at, what
// takes focus for one, the links and controls inside one that `Tab` goes between, and stepping a
// walkthrough or a set of tabs inside one. The article draws each block that holds something to act
// on with its number, Lo's own (`data-lo-block`), which is all a block is known by elsewhere. A
// section that folds holds its blocks in a body of its own, which they're read through, in order;
// a collapsed one's heading is a block the keys stop at, and nothing under it is drawn.

/** The attribute that holds a block's number among the article's blocks. */
export const BLOCK_ATTRIBUTE = 'data-lo-block';

/** The class of a section's heading, which folds it (`SectionHead`). */
export const SECTION_HEAD_CLASS = 'lo-section-head';

/** The class of what's under a section's heading while it's drawn: the box that opens and closes. */
export const SECTION_CLASS = 'lo-section';

/** The class of a section's body, inside that box, which holds the section's blocks. */
export const SECTION_BODY_CLASS = 'lo-section__body';

/**
 * The article's blocks, as they're read, first to last: its own children, and in place of a
 * section's box, the blocks in its body. A section that's closing has none: they're leaving.
 */
export function articleBlocks(article: Element): Element[] {
  const found: Element[] = [];
  for (const child of article.children) {
    if (!child.classList.contains(SECTION_CLASS)) {
      found.push(child);
      continue;
    }
    if (child.hasAttribute('data-closed')) continue;
    const body = child.querySelector(`:scope > * > .${SECTION_BODY_CLASS}`);
    if (body) found.push(...body.children);
  }
  return found;
}

/** The blocks of `article` the block keys stop at, in the order they're written. */
export function blockStops(article: Element): HTMLElement[] {
  return articleBlocks(article).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.hasAttribute(BLOCK_ATTRIBUTE),
  );
}

/** Whether `parent`, in `article`, holds blocks: the article itself, or a section's body. */
function holdsBlocks(article: Element, parent: Element | null): boolean {
  return (
    parent === article ||
    (parent !== null &&
      parent.classList.contains(SECTION_BODY_CLASS) &&
      parent.parentElement?.parentElement?.parentElement === article)
  );
}

/** The block of `article`'s that `element` is in, or is, if it's in one. */
export function blockOf(article: Element, element: Element | null): HTMLElement | undefined {
  for (let at = element; at && at !== article; at = at.parentElement) {
    if (
      holdsBlocks(article, at.parentElement) &&
      at instanceof HTMLElement &&
      at.hasAttribute(BLOCK_ATTRIBUTE)
    ) {
      return at;
    }
  }
  return undefined;
}

/**
 * The heading of a section that folds, which `element` is or is in, as the article draws it: the
 * box around its chevron, its words and its `⋯`.
 */
export function sectionHeadOf(element: Element | null): HTMLElement | undefined {
  const head = element?.closest(`.${SECTION_HEAD_CLASS}`);
  return head instanceof HTMLElement ? head : undefined;
}

/** A block's number among the article's blocks. */
export function blockNumber(block: Element): number | undefined {
  const value = block.getAttribute(BLOCK_ATTRIBUTE);
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/**
 * What takes focus for `block`: a fold's title, which opens and closes it; a collapsed section's
 * heading, which keeps focus as the section opens and its heading stops being a block; or the block
 * itself.
 */
export function focusTargetOf(block: HTMLElement): HTMLElement {
  if (block.localName === 'details') {
    const title = [...block.children].find((child) => child.localName === 'summary');
    if (title instanceof HTMLElement) return title;
  }
  if (block.classList.contains(SECTION_HEAD_CLASS)) {
    const heading = [...block.children].find((child) => child.localName === 'h2');
    if (heading instanceof HTMLElement) return heading;
  }
  return block;
}

/**
 * What `Tab` goes between inside a block: links, figures' parts, controls, and what's marked a stop
 * of its own (`data-lo-stop`), as a term's row's term is.
 */
const STOPS = '[role="link"], button, summary, [data-lo-stop]';

/** The chip a focused block shows, whose buttons run the keys `Tab` goes beside. */
const CHIP = '.lo-block__hints';

/**
 * The links, figure parts, controls and stops in `block` that `Tab` goes between, in order: those
 * shown now, which a closed fold or a tab not chosen hides, that can take focus. The block's own
 * focus, such as a fold's title, isn't one of them, nor are its chip's buttons, which do what keys
 * do.
 */
export function linksIn(block: HTMLElement): (HTMLElement | SVGElement)[] {
  const own = focusTargetOf(block);
  return [...block.querySelectorAll(STOPS)].filter(
    (element): element is HTMLElement | SVGElement =>
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      element !== own &&
      element.closest(CHIP) === null &&
      element.tabIndex >= 0 &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      !hiddenIn(block, element),
  );
}

/**
 * Whether `element` is hidden inside `block`: in a panel not shown, in a closed fold's body, or out
 * of reach, as the room a code block's flag holds for its widest button is.
 */
function hiddenIn(block: Element, element: Element): boolean {
  let child: Element = element;
  for (let at = element.parentElement; at; at = at.parentElement) {
    if (at.hasAttribute('hidden') || at.hasAttribute('inert')) return true;
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
