// The slots a thread's card, or a thread's popover, draws for a comment box: in place of a comment
// being edited, in place of the row that offers a reply, and, in a popover, after its threads, for
// a new comment's. A code view puts the box in its slot, so the box opens where its comment goes,
// and an edited comment's text shows once.

/** The attribute on the slot of a comment being edited, which holds the comment's id. */
export const EDIT_SLOT = 'data-edit-slot';

/** The attribute on the slot of a reply's box, in place of the row that offers one: its thread. */
export const REPLY_SLOT = 'data-reply-slot';

/** The attribute on the slot of a new comment's box, after a popover's threads, or alone. */
export const NEW_SLOT = 'data-new-slot';

/** What a slot sends up the page as it's drawn: the code view moves its box into it. */
export const EDIT_SLOT_EVENT = 'lo-edit-slot';

/** Tells the code view a slot was drawn, so it moves its box in: a slot's `ref`. */
export function announceSlot(slot: HTMLElement | null): void {
  slot?.dispatchEvent(new Event(EDIT_SLOT_EVENT, { bubbles: true }));
}
