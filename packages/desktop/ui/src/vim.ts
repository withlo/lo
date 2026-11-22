// Whether Vim keys are on, for every code view and comment box in the window. The code views'
// editors follow it (`code/keys.ts`), and what draws around an editor asks it, to say Vim's mode
// only while there's one. Nothing here is CodeMirror's.

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
