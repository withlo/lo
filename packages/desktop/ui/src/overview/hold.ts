// What keeps an overview where it is on the page as its box moves without the reader, as when a
// banner over it comes or goes: the scroll takes the move, and at the very top, room above the
// article does, which a box moving back down takes away again. Only the scroll the reader, or the
// document, asks for moves what's on screen.

/**
 * Holds what's on screen in `scroller` where it is on the page as the box moves, until the
 * returned function stops it. Room added above the content is the scroller's top padding.
 */
export function holdPlace(scroller: HTMLElement): () => void {
  let slack = 0;
  /** The scroll `placed` counts, to take only what the scroll moved since. */
  let scrolled = scroller.scrollTop;
  /** The box's height when its place was last kept, to tell a box that grew. */
  let height = scroller.clientHeight;

  /** Where the content's top is on the page now, room above it included. */
  const contentTop = () => scroller.getBoundingClientRect().top - scroller.scrollTop + slack;

  /** Where the content's top was on the page when the reader last put it there. */
  let placed = contentTop();

  const setSlack = (to: number) => {
    slack = Math.max(0, to);
    scroller.style.paddingTop = slack === 0 ? '' : `${slack}px`;
  };

  /**
   * The scroll moved, by the reader or the document: the content is meant to be as far from where
   * it was. Only the scroll counts, not where the box is: a box that moved in the same frame,
   * before it could be made up for, would otherwise be taken as where the content belongs.
   */
  const chosen = () => {
    const now = scroller.scrollTop;
    const end = scroller.scrollHeight - scroller.clientHeight;
    // Pulled back to the end as the box grew and left less to scroll: the browser's doing, which
    // the content's place doesn't follow, so the box's move puts it back if there's room.
    const pulled = scroller.clientHeight > height + 0.5 && now < scrolled && now >= end - 0.5;
    if (!pulled) placed -= now - scrolled;
    scrolled = now;
  };

  /** The box moved or changed size: the content goes back where it was on the page. */
  const keep = () => {
    // A scroll whose event hasn't come yet is the reader's, or the document's, not the box's.
    chosen();
    height = scroller.clientHeight;
    const moved = contentTop() - placed;
    if (Math.abs(moved) < 0.5) return;
    if (moved > 0) {
      const taken = Math.min(slack, moved);
      setSlack(slack - taken);
      scroller.scrollTop += moved - taken;
    } else {
      const up = -moved;
      const room = scroller.scrollTop;
      scroller.scrollTop -= Math.min(up, room);
      if (up > room) setSlack(slack + up - room);
    }
    scrolled = scroller.scrollTop;
    // The scroll goes by whole pixels, or halves, which can leave the content a fraction from where
    // it's meant to be: that place stays, so the next move makes up for it rather than adding to
    // it. A scroll that couldn't go as far leaves the content where it is now.
    if (Math.abs(contentTop() - placed) >= 1) placed = contentTop();
  };

  scroller.addEventListener('scroll', chosen, { passive: true });
  const watch = new ResizeObserver(keep);
  watch.observe(scroller);
  return () => {
    watch.disconnect();
    scroller.removeEventListener('scroll', chosen);
    setSlack(0);
  };
}

// What keeps a block of an overview where it is while the reader can see it. A block whose contents
// change size by themselves, as a code block's do when its code comes, keeps the height it has
// while any of it is on screen: contents grown taller are cut off there, and shrunk ones leave room
// under them. It takes its contents' height once it's off screen, where the scroll's anchoring
// keeps what's on screen where it is, or when the reader asks, or when its width changes, which
// only the reader's window or page does.

/** A block's height, held: `release` gives it its contents' height now, as the reader asked. */
export interface HeldHeight {
  release(): void;
  stop(): void;
}

/**
 * Holds `box`'s height while it's on screen in `scroller`, as its contents, `inner`, change size,
 * and says through `cut` whether contents taller than it are cut off. With no `scroller`, the
 * screen is the window's.
 */
export function holdHeight(
  box: HTMLElement,
  inner: HTMLElement,
  scroller: HTMLElement | null,
  cut: (cut: boolean) => void,
): HeldHeight {
  const natural = () => inner.getBoundingClientRect().height;
  let held = natural();
  let width = box.getBoundingClientRect().width;
  let isCut = false;

  const setCut = (now: boolean) => {
    if (now === isCut) return;
    isCut = now;
    cut(now);
  };
  const hold = (height: number) => {
    held = height;
    box.style.height = `${height}px`;
    setCut(false);
  };
  hold(held);

  /** Whether any of the box is on screen. */
  const onScreen = () => {
    const { top, bottom } = box.getBoundingClientRect();
    const screen = scroller?.getBoundingClientRect();
    const from = screen?.top ?? 0;
    const to = screen ? screen.top + (scroller?.clientHeight ?? 0) : window.innerHeight;
    return bottom > from && top < to;
  };

  /** Takes the contents' height, unless the box is on screen and nobody asked. */
  const settle = (asked: boolean) => {
    const now = natural();
    if (Math.abs(now - held) < 0.5) {
      setCut(false);
      return;
    }
    if (asked || !onScreen()) hold(now);
    else setCut(now > held);
  };

  const contents = new ResizeObserver(() => settle(false));
  contents.observe(inner);
  // The box's width changes only with the window, or the page around it, which the reader changed.
  const sized = new ResizeObserver(() => {
    const now = box.getBoundingClientRect().width;
    if (Math.abs(now - width) < 0.5) return;
    width = now;
    settle(true);
  });
  sized.observe(box);
  // Off screen, it takes the height it's held from.
  const seen =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => !entry.isIntersecting)) settle(false);
          },
          { root: scroller },
        );
  seen?.observe(box);

  return {
    release: () => settle(true),
    stop() {
      contents.disconnect();
      sized.disconnect();
      seen?.disconnect();
      box.style.height = '';
    },
  };
}
