// Whether Vim keys are on, for every code view and comment box in the window, and, while they are,
// Vim's mode in the code view that has focus, for the status bar: `NORMAL`, `VISUAL`, `V-LINE`,
// `V-BLOCK` or `INSERT`, as Vim names them, or nothing while no code view's editor has focus. Every
// code view's editors say theirs (`showMode` in `keys.ts`), so the window has one to show,
// whichever view it is. Nothing here is CodeMirror's, so what draws around an editor can ask too.

/** Whether Vim keys are on. Off, as Lo starts. */
let vimKeys = false;
const switchListeners = new Set<() => void>();
/** What switches the editors themselves, given the flag's own change to make in between. */
let switcher: ((on: boolean, flip: () => void) => void) | undefined;

/** Whether Vim keys are on. */
export function vimOn(): boolean {
  return vimKeys;
}

/** Calls `listener` each time Vim keys go on or off, once every editor has switched. */
export function onVim(listener: () => void): () => void {
  switchListeners.add(listener);
  return () => {
    switchListeners.delete(listener);
  };
}

/**
 * Turns Vim keys on or off in every editor, the open ones at once: off, an editor is a plain one,
 * with a caret, and no mode is said anywhere. An editor leaves insert or visual mode as Vim goes.
 */
export function setVim(on: boolean): void {
  if (on === vimKeys) return;
  const flip = (): void => {
    vimKeys = on;
  };
  if (switcher) switcher(on, flip);
  else flip();
  for (const listener of switchListeners) listener();
}

/**
 * Takes `given` as what switches the editors (`keys.ts`): it's called as Vim keys go on or off, and
 * calls `flip`, which changes what {@link vimOn} says, between what it does before and after.
 */
export function switchWith(given: (on: boolean, flip: () => void) => void): void {
  switcher = given;
}

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
