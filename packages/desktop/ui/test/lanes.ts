// What a code view's lanes draw, in words, for the tests of the views that draw them.

/** A stem's or a tick's colour, by its class: amber, grey, muted or Powder. */
function toneOf(element: Element, prefix: string): string {
  if (element.classList.contains(`${prefix}--warn`)) return 'amber';
  if (element.classList.contains(`${prefix}--muted`)) return 'muted';
  if (element.classList.contains(`${prefix}--note`)) return 'powder';
  return 'grey';
}

/** ' lit' where `element` is drawn lit, else nothing. */
function litOf(element: Element): string {
  return element.classList.contains('is-lit') ? ' lit' : '';
}

/**
 * What a lane's cell (`.lo-lanemark`) draws: each stem's piece, by its slot, from where to where
 * and in which colour, lit or not; the tick, by the slot it starts at; and the mark, a bubble's
 * colour and name or a ball, open or not.
 */
export function drawnCell(cell: Element): string {
  const parts: string[] = [];
  for (const piece of cell.children) {
    const slot = piece.getAttribute('data-slot');
    if (piece.classList.contains('lo-stem')) {
      const end = (which: 'from' | 'to') =>
        ['edge', 'mid', 'under', 'mark'].find((kind) =>
          piece.classList.contains(`lo-stem--${which}-${kind}`),
        );
      parts.push(`s${slot} ${end('from')}-${end('to')} ${toneOf(piece, 'lo-stem')}${litOf(piece)}`);
    } else if (piece.classList.contains('lo-tick')) {
      const under = piece.classList.contains('is-under') ? ' under' : '';
      parts.push(`tick s${slot} ${toneOf(piece, 'lo-stem')}${litOf(piece)}${under}`);
    } else if (piece.classList.contains('lo-bubble')) {
      parts.push(
        `${toneOf(piece, 'lo-bubble')}${litOf(piece)} ${piece.getAttribute('aria-label')}`,
      );
    } else if (piece.classList.contains('lo-ov-marker')) {
      parts.push(piece.classList.contains('is-open') ? 'ball open' : 'ball');
    }
  }
  return parts.join(', ');
}

/** What the lane `lane` (`threads` or `notes`) of `editor` draws beside each row, top to bottom. */
export function drawnLane(editor: Element | null | undefined, lane: 'threads' | 'notes'): string[] {
  const gutter = lane === 'threads' ? '.lo-threadlane' : '.lo-ovcolumn';
  return [...(editor?.querySelectorAll(`${gutter} .lo-lanemark`) ?? [])].map(drawnCell);
}
