// Moving between Settings' sections by key. The page that's open says how; with none open, the
// keys have nowhere to go.

let mover: ((step: 1 | -1) => void) | undefined;

/** Makes `move` what the keys do. Returns a function that takes it back, for when the page goes. */
export function onMoveSection(move: (step: 1 | -1) => void): () => void {
  mover = move;
  return () => {
    if (mover === move) mover = undefined;
  };
}

/** Whether a page is open to move in. */
export function canMoveSection(): boolean {
  return mover !== undefined;
}

/** Goes to the next section, or the previous. */
export function moveSection(step: 1 | -1): void {
  mover?.(step);
}
