// What keeps an overview where it is on the page without the reader. As its box moves, as when a
// banner over it comes or goes, the scroll takes the move, and at the very top, room above the
// article does, which a box moving back down takes away again. As what's above the place the
// reader reads from changes size, as a code block's does when its code comes, or text's as its
// face loads, the scroll takes the change: that place is the first of the article's blocks that
// starts on screen. The window's own scroll anchoring is off, so the change is taken once. Only
// the scroll the reader, or the document, asks for moves what's on screen.

/** What keeps each overview's place, by its scroller: called as a block in it changes height. */
const places = new WeakMap<HTMLElement, () => void>();

/**
 * Holds what's on screen in `scroller` where it is on the page as the box moves, and as what's
 * above the place being read changes size, until the returned function stops it. Room added above
 * the content is the scroller's top padding.
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

  /** The block the reader reads from, and where it starts on the page. */
  let reading: { block: Element; top: number } | undefined;

  /** Takes the first of the article's blocks that starts on screen, or under it, as being read. */
  const read = () => {
    const screen = scroller.getBoundingClientRect().top;
    reading = undefined;
    for (const block of scroller.querySelector(':scope > article')?.children ?? []) {
      const { top } = block.getBoundingClientRect();
      if (top >= screen - 0.5) {
        reading = { block, top };
        return;
      }
    }
  };

  const setSlack = (to: number) => {
    slack = Math.max(0, to);
    scroller.style.paddingTop = slack === 0 ? '' : `${slack}px`;
  };

  /**
   * The scroll moved, by the reader or the document: the content is meant to be as far from where
   * it was. Only the scroll counts, not where the box is: a box that moved in the same frame,
   * before it could be made up for, would otherwise be taken as where the content belongs. Says
   * whether it moved.
   */
  const chosen = (): boolean => {
    const now = scroller.scrollTop;
    if (now === scrolled) return false;
    const end = scroller.scrollHeight - scroller.clientHeight;
    // Pulled back to the end as the box grew and left less to scroll: the browser's doing, which
    // the content's place doesn't follow, so the box's move puts it back if there's room.
    const pulled = scroller.clientHeight > height + 0.5 && now < scrolled && now >= end - 0.5;
    if (!pulled) placed -= now - scrolled;
    scrolled = now;
    return true;
  };

  /** The box moved or changed size: the content goes back where it was on the page. */
  const keep = () => {
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

  /** What's above the block being read changed size: the scroll takes the change. */
  const follow = () => {
    const block = reading?.block;
    if (!reading || !block?.isConnected) return;
    const moved = block.getBoundingClientRect().top - reading.top;
    if (Math.abs(moved) < 0.5) return;
    scroller.scrollTop += moved;
    // The content's top moved up the page by what grew above: it's meant to be there.
    chosen();
  };

  /** Something moved or changed size: what's on screen goes back where it was. */
  const settle = () => {
    // A scroll whose event hasn't come yet is the reader's, or the document's, not the box's: the
    // block being read is taken again after it.
    const unheard = chosen();
    keep();
    if (!unheard) follow();
    read();
  };

  const onScroll = () => {
    chosen();
    read();
  };
  read();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const watch = new ResizeObserver(settle);
  watch.observe(scroller);
  const article = scroller.querySelector(':scope > article');
  if (article) watch.observe(article);
  places.set(scroller, settle);
  return () => {
    places.delete(scroller);
    watch.disconnect();
    scroller.removeEventListener('scroll', onScroll);
    setSlack(0);
  };
}

// What keeps a block of an overview from moving what the reader sees as its contents change size by
// themselves, as a code block's do when its code comes. A block takes its contents' height whenever
// that moves nothing on screen:
//
// - it can't be seen, as while the overview is laid out before it's first shown;
// - it's off screen;
// - it starts above the screen's top, where the reader isn't reading: the scroll takes the change
//   (`holdPlace`), so what's under it stays in place;
// - it goes on past the screen's bottom edge, so only what's under that moves, and stays past it;
// - nothing on screen is under it.
//
// Otherwise, wholly on screen with something under it, it keeps its height: contents grown taller
// are cut off, and a row of its own under them, in the room the block had, shows them whole when
// the reader asks; contents grown shorter leave room under them. It takes its contents' height once
// that moves nothing again, when the reader asks, or when its width changes, which only the
// reader's window or page does.

/** A block's height, held: `release` gives it its contents' height now, as the reader asked. */
export interface HeldHeight {
  release(): void;
  stop(): void;
}

/**
 * Holds `box`'s height as its contents, `inner`, change size, while taking their height would move
 * something on screen in `scroller`, and says through `cut` whether contents taller than it are cut
 * off. With no `scroller`, the screen is the window's.
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

  /** Whether the block can be seen at all, wherever it is: where a browser can tell. */
  const visible = () =>
    !('checkVisibility' in box) || box.checkVisibility({ visibilityProperty: true });

  /** The screen's top and bottom, and where what scrolls ends, on the page. */
  const screen = () => {
    if (!scroller) {
      const end = document.documentElement.scrollHeight - window.scrollY;
      return { top: 0, bottom: window.innerHeight, end };
    }
    const { top } = scroller.getBoundingClientRect();
    return {
      top,
      bottom: top + scroller.clientHeight,
      end: top - scroller.scrollTop + scroller.scrollHeight,
    };
  };

  /** Whether taking `height` for the box moves nothing on screen, with the scroll's help. */
  const taking = (height: number): boolean => {
    if (!visible()) return true;
    const { top, bottom } = box.getBoundingClientRect();
    const view = screen();
    // Off screen, or starting above it, where the scroll takes the change.
    if (bottom <= view.top || top >= view.bottom || top < view.top) return true;
    // On past the screen's bottom edge, before and after.
    if (bottom >= view.bottom - 0.5 && top + height >= view.bottom - 0.5) return true;
    // Nothing under it on screen: it's the last thing there is.
    return view.end <= bottom + 0.5;
  };

  /** Takes the contents' height, unless that would move something on screen and nobody asked. */
  const settle = (asked: boolean) => {
    const now = natural();
    if (Math.abs(now - held) < 0.5) {
      setCut(false);
      return;
    }
    if (!asked && !taking(now)) {
      setCut(now > held);
      return;
    }
    hold(now);
    // What's on screen stays where it is, before it's drawn.
    if (scroller) places.get(scroller)?.();
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
  // Where the block is on screen changes as the reader scrolls: once taking the contents' height
  // would move nothing, it takes it.
  const seen =
    typeof IntersectionObserver === 'undefined'
      ? undefined
      : new IntersectionObserver(() => settle(false), {
          root: scroller,
          threshold: [0, 1],
        });
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
