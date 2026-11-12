// What keeps an overview where it is on the page without the reader. As its box moves, as when a
// banner over it comes or goes, the scroll takes the move, and at the very top, room above the
// article does, which a box moving back down takes away again. As what's above the place the
// reader reads from changes size, as a code block's does when its code comes, or text's as its
// face loads, the scroll takes the change: that place is the first of the article's blocks that
// starts on screen. The window's own scroll anchoring is off, so the change is taken once.
//
// Only the scroll the reader, or the document, asks for moves what's on screen. A scroll seen as
// something changes size is the reader's only when it follows their input, as a wheel, a key or a
// drag of the scroll bar; otherwise it's the browser's, as when it pulls the scroll back to an end
// that came closer, and what's on screen goes back where it was. A block that's about to get
// shorter first gets room at the article's end, so the end never comes closer than the place being
// read needs; the room goes once it's off screen, or as what grows later makes it unneeded.

/** What keeps an overview's place: told as a block in it changes height. */
interface Place {
  /** A block is about to change height by `by`. */
  resizing(by: number): void;
  /** A block changed height. */
  settle(): void;
}

/** What keeps each overview's place, by its scroller. */
const places = new WeakMap<HTMLElement, Place>();

/** How long after the reader's input a scroll is still theirs, as a wheel's or a key's runs on. */
const INPUT_RUNS = 1000;

/**
 * How much more room the end keeps than it seems to need: the scroll and the box's heights are read
 * in whole pixels while the page lays out in fractions, so the end may be up to a pixel off.
 */
const ROUNDING = 1;

/**
 * Holds what's on screen in `scroller` where it is on the page as the box moves, and as what's
 * above the place being read changes size, until the returned function stops it. Room added above
 * the content is the scroller's top padding, and room at its end its bottom padding.
 */
export function holdPlace(scroller: HTMLElement): () => void {
  let slack = 0;
  let room = 0;
  /** The scroll `placed` counts, to take only what the scroll moved since. */
  let scrolled = scroller.scrollTop;
  /** The box's height when its place was last kept, to tell a box that grew. */
  let height = scroller.clientHeight;
  /** When the reader last gave input, and whether they're dragging. */
  let input = Number.NEGATIVE_INFINITY;
  let dragging = false;

  /** Where the content's top is on the page now, room above it included. */
  const contentTop = () => scroller.getBoundingClientRect().top - scroller.scrollTop + slack;

  /** Where the content's top was on the page when the reader last put it there. */
  let placed = contentTop();

  /** The block the reader reads from, and where it starts on the page. */
  let reading: { block: Element; top: number } | undefined;

  /**
   * Takes the first of the article's blocks that starts on screen, or under it, as being read. Once
   * the scroll has made up for a change, as it goes by whole pixels or halves, the block it kept
   * stays meant to be where it was, a fraction from where it is, so the next change makes up for
   * that fraction rather than adding to it.
   */
  const read = (kept: boolean) => {
    const screen = scroller.getBoundingClientRect().top;
    const was = reading;
    reading = undefined;
    for (const block of scroller.querySelector(':scope > article')?.children ?? []) {
      const { top } = block.getBoundingClientRect();
      if (top >= screen - 0.5) {
        const same = kept && was?.block === block && Math.abs(top - was.top) < 1;
        reading = { block, top: same ? was.top : top };
        return;
      }
    }
  };

  const setSlack = (to: number) => {
    slack = Math.max(0, to);
    scroller.style.paddingTop = slack === 0 ? '' : `${slack}px`;
  };

  const setRoom = (to: number) => {
    room = Math.max(0, to);
    scroller.style.paddingBottom = room === 0 ? '' : `${room}px`;
  };

  /** Lets go of the room at the end that's off screen. */
  const trim = () => {
    if (room === 0) return;
    const shown = scroller.scrollTop + scroller.clientHeight - (scroller.scrollHeight - room);
    setRoom(shown <= -ROUNDING ? 0 : Math.min(room, shown + ROUNDING));
  };

  /** Whether a scroll now is the reader's: one that follows their input. */
  const theirs = () => dragging || performance.now() - input < INPUT_RUNS;

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
      const above = scroller.scrollTop;
      scroller.scrollTop -= Math.min(up, above);
      if (up > above) setSlack(slack + up - above);
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
    const to = scroller.scrollTop + moved;
    // Never past the end: room there first.
    const end = scroller.scrollHeight - scroller.clientHeight;
    if (to > end - ROUNDING) setRoom(room + to - end + ROUNDING);
    scroller.scrollTop = to;
    // The content's top moved up the page by what grew above: it's meant to be there.
    chosen();
  };

  /** Something moved or changed size: what's on screen goes back where it was. */
  const settle = () => {
    // A scroll whose event hasn't come yet is the reader's when it follows their input, and the
    // block being read is taken again after it; else it's the browser's, and doesn't count.
    const unheard = chosen();
    keep();
    const ours = !unheard || !theirs();
    if (ours) follow();
    trim();
    read(ours);
  };

  /** A block is about to get shorter: room at the end, so the scroll isn't pulled back. */
  const resizing = (by: number) => {
    if (by >= 0) return;
    const end = scroller.scrollHeight - scroller.clientHeight;
    const short = scroller.scrollTop - (end + by) + ROUNDING;
    if (short > 0) setRoom(room + short);
  };

  // A scroll already counted is the one made up for a change: the block being read stays meant to
  // be where it was.
  const onScroll = () => {
    const moved = chosen();
    trim();
    read(!moved);
  };
  const onInput = () => {
    input = performance.now();
  };
  const onPress = () => {
    input = performance.now();
    dragging = true;
  };
  const onRelease = () => {
    input = performance.now();
    dragging = false;
  };
  const view = scroller.ownerDocument.defaultView ?? window;
  const inputs: [string, () => void][] = [
    ['wheel', onInput],
    ['keydown', onInput],
    ['touchmove', onInput],
    ['pointerdown', onPress],
    ['pointerup', onRelease],
    ['pointercancel', onRelease],
  ];
  for (const [type, listener] of inputs) {
    view.addEventListener(type, listener, { capture: true, passive: true });
  }
  read(false);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const watch = new ResizeObserver(settle);
  watch.observe(scroller);
  const article = scroller.querySelector(':scope > article');
  if (article) watch.observe(article);
  places.set(scroller, { resizing, settle });
  return () => {
    places.delete(scroller);
    watch.disconnect();
    scroller.removeEventListener('scroll', onScroll);
    for (const [type, listener] of inputs) {
      view.removeEventListener(type, listener, { capture: true });
    }
    setSlack(0);
    setRoom(0);
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
    // What's on screen stays where it is, before it's drawn.
    const place = scroller ? places.get(scroller) : undefined;
    place?.resizing(now - held);
    hold(now);
    place?.settle();
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
