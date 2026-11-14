// Vim's mode in the code view that has focus, for the status bar: `NORMAL`, `VISUAL`, `V-LINE`,
// `V-BLOCK` or `INSERT`, as Vim names them, or nothing while no code view's editor has focus. Every
// code view's editors say theirs (`showMode` in `keys.ts`), so the window has one to show,
// whichever view it is.

/** Vim's mode, as the status bar names it. */
export type ModeName = 'NORMAL' | 'VISUAL' | 'V-LINE' | 'V-BLOCK' | 'INSERT';

/** The mode shown, and the editor it's from. */
let shown: { mode: ModeName; editor: object } | undefined;
const listeners = new Set<() => void>();

/** Vim's mode in the code view that has focus, or nothing while none has. */
export function focusedMode(): ModeName | undefined {
  return shown?.mode;
}

/** Calls `listener` each time {@link focusedMode} changes. Returns a function that stops it. */
export function onFocusedMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Says Vim's mode in `editor`, which has focus, or with none that it has lost focus: unless another
 * editor has said its own since, nothing is shown then.
 */
export function sayMode(editor: object, mode: ModeName | undefined): void {
  if (mode === undefined && shown?.editor !== editor) return;
  const before = shown?.mode;
  shown = mode === undefined ? undefined : { mode, editor };
  if (shown?.mode !== before) for (const listener of listeners) listener();
}
