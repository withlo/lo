// What keeps the end of a pane from coming up the screen by itself. As what's at the end of a pane
// scrolled there gets shorter, as a comment box at a timeline's end shrinks, sends or closes, the
// browser would pull the scroll back to the nearer end, and everything on screen would move down
// with it. Instead, the end stays where the screen's foot is, as room after what's drawn, so nothing
// on screen moves; the room goes as the reader scrolls it off screen, which moves nothing either.
//
// An empty element out of the flow holds the end, as far down as the screen's foot, which the
// scroll reaches as it reaches the rest. It's never further down than what the pane already
// scrolls, so it never makes room of its own, only keeps what was there.

/**
 * Keeps the end of what `pane` scrolls at least as far down as the screen's foot, so that what gets
 * shorter at its end, on screen, leaves room there instead of pulling the scroll back. `pane` is as
 * tall as its place makes it, not as what it holds, and is what the element that holds the end is
 * placed by (`position: relative`, or another position). What it returns lets the end go, and the
 * room with it.
 */
export function keepEnd(pane: HTMLElement): () => void {
  const end = pane.ownerDocument.createElement('div');
  end.setAttribute('aria-hidden', 'true');
  end.dataset['loEnd'] = '';
  const { style } = end;
  style.position = 'absolute';
  style.left = '0';
  style.width = '1px';
  style.height = '1px';
  style.visibility = 'hidden';
  style.pointerEvents = 'none';
  // Never what the browser's own anchoring keeps in place, where that's on.
  style.overflowAnchor = 'none';
  // First, out of the flow: what the pane draws keeps its order after it.
  pane.prepend(end);
  const hold = (): void => {
    // The screen's foot, but never past the end as it is: a fraction of a pixel left over there
    // would let the scroll go that much further, and the end with it.
    const foot = Math.min(pane.scrollTop + pane.clientHeight, pane.scrollHeight);
    style.top = `${Math.max(0, foot - 1)}px`;
  };
  hold();
  // The reader's scroll, or the pane's own, moves the foot; so does the pane changing height.
  pane.addEventListener('scroll', hold, { passive: true });
  const sized = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(hold);
  sized?.observe(pane);
  return () => {
    pane.removeEventListener('scroll', hold);
    sized?.disconnect();
    end.remove();
  };
}
