// The slot a thread's card draws in place of a comment being edited. A code view puts the box that
// edits the comment in it, so the box opens where the comment was, and the text shows once.

/** The attribute on the slot, which holds the edited comment's id. */
export const EDIT_SLOT = 'data-edit-slot';

/** What the slot sends up the page as it's drawn: the code view moves the box into it. */
export const EDIT_SLOT_EVENT = 'lo-edit-slot';
