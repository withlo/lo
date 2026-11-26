// The Land move on a code view's line: where a link or a follow brought the cursor takes a tint
// that fades. CodeMirror owns its lines' elements and sets their classes from its decorations,
// so the tint is one: a class put on a line's element by hand goes as the line is drawn again,
// as it is when a thread opens under it or the cursor's line changes.

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

import { LAND_CLASS } from '../land.ts';

/** Lands on the line starting at a position, or with `null`, takes the tint off. */
const landOn = StateEffect.define<number | null>();

const landed = Decoration.line({ class: LAND_CLASS });

/** The line that's landed on, while its tint fades. */
const landing = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(landOn)) {
        next =
          effect.value === null ? Decoration.none : Decoration.set([landed.range(effect.value)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** How long the tint can take, past which it goes whether or not its fade was seen to end. */
const LAND_LIMIT_MS = 400;

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** Takes the tint off once its fade ends, so a line drawn again later doesn't fade again. */
const ending = EditorView.domEventHandlers({
  animationend(event, view) {
    if (event.target instanceof Element && event.target.classList.contains(LAND_CLASS)) {
      clear(view);
    }
    return false;
  },
});

function clear(view: EditorView): void {
  clearTimeout(timers.get(view));
  timers.delete(view);
  if (view.state.field(landing, false)?.size) view.dispatch({ effects: landOn.of(null) });
}

/** The extension a code editor lands with. */
export function landings() {
  return [landing, ending];
}

/** Lands on line `line` (1-based) of `view`, as `landings` lets it. */
export function landLine(view: EditorView, line: number): void {
  if (view.state.field(landing, false) === undefined) return;
  if (line < 1 || line > view.state.doc.lines) return;
  clearTimeout(timers.get(view));
  const from = view.state.doc.line(line).from;
  // Off and on again, with the page laid out between, so landing on the same line again starts
  // its fade afresh.
  view.dispatch({ effects: landOn.of(null) });
  void view.contentDOM.getBoundingClientRect();
  view.dispatch({ effects: landOn.of(from) });
  timers.set(
    view,
    setTimeout(() => clear(view), LAND_LIMIT_MS),
  );
}
