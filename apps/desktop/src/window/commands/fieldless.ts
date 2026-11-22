// The scopes that hold no editable field, so a key pressed in one is never a field's: an editable
// field keeps the keys that edit its text, and a command on one of them belongs only in these, or
// edits the field itself (`editsField`). `checkEditingKeys` reads this list. A scope comes onto it
// only once nothing it holds takes text: a comment box or a code view nested in it is a scope of
// its own, so their fields don't count, but a field of its own does, and then it comes off.
//
// - `noMatch`: Settings' "No settings match" state, with its Clear search, under the search field.
// - `overview`: the overview's blocks, links and states; its code is a `file` view of its own.
// - `recent`: Recent's list of pull requests, under its filter field.
// - `threads`: the threads panel's list and its empty state, under the filter.
// - `tree`: the file tree's rows, under its controls.

export const FIELDLESS: readonly string[] = ['noMatch', 'overview', 'recent', 'threads', 'tree'];
