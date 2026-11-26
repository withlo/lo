// What a file's header does across the diff view, besides being drawn in its column: its band
// reaching through CodeMirror's gutters, so it reads as one band from the sheet's left edge to its
// right, and the copy of it pinned under the diff bar while the file is scrolled into.

import { type Extension } from '@codemirror/state';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

import { drawHeader, type HeaderInfo } from './widgets.ts';

/** A file header's height, the design's `lo-file-header-h`: the pinned row's too. */
export const HEADER_HEIGHT = 38;

/**
 * Sets `--lo-gutters` on an editor to how wide its gutters are drawn, which what's drawn across a
 * whole row reaches back by: a file's header and the row under it, which draw their ground
 * through the gutters.
 */
export function gutterReach(): Extension {
  return ViewPlugin.fromClass(
    class {
      #width = -1;
      readonly #view: EditorView;

      constructor(view: EditorView) {
        this.#view = view;
        this.#measure();
      }

      update(update: ViewUpdate): void {
        if (update.geometryChanged || update.viewportChanged) this.#measure();
      }

      #measure(): void {
        this.#view.requestMeasure({
          key: this,
          read: (view) => view.contentDOM.offsetLeft,
          write: (width, view) => {
            if (width === this.#width) return;
            this.#width = width;
            view.dom.style.setProperty('--lo-gutters', `${width}px`);
          },
        });
      }
    },
  );
}

/** How wide `view`'s gutters are as last measured, in pixels. */
export function gutterWidth(view: EditorView): number {
  return Number.parseFloat(view.dom.style.getPropertyValue('--lo-gutters')) || 0;
}

/** What the pinned row shows: a file's header, by its place in the view. */
export interface Pinned {
  readonly file: number;
  readonly info: HeaderInfo;
  /**
   * How far the next file's header, coming up under the row, pushes it up: 0, or less while that
   * header is within the row's height of the top edge.
   */
  readonly shift: number;
}

/**
 * The header of the file at the top of the diff's scroll, pinned under the diff bar while that
 * file's own header is above the top edge: the same parts in the same places, which act on that
 * file. It's the view's own row, over the top of the scroll, taking no room. As files pass, the
 * next header pushes it up, in step with the scroll, and once that header reaches the top edge
 * the row is that file's: a pass has no fade. A jump to another file, with no header passing,
 * brings the new one in one Swap, of its content alone: the band stays. It never takes the
 * keyboard's ring.
 */
export class Pin {
  readonly dom: HTMLElement;
  #shown: Pinned | undefined;

  constructor() {
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffpin';
    this.dom.hidden = true;
    // A copy of a header the document has, for the eye and the pointer: a screen reader reads the
    // file's own header, once.
    this.dom.setAttribute('aria-hidden', 'true');
  }

  /** The file it shows, if it shows one. */
  get file(): number | undefined {
    return this.#shown?.file;
  }

  /**
   * Shows `pinned`, its path `start` pixels in from the sheet's edge, as its column's header has
   * it, or nothing. Side by side, with `end`, how wide the right column's gutters are, it's two
   * columns as wide as the sides (`view.css`), its start in the old side's and its end in the new
   * side's, short of where that side's code starts, as the header's two halves are drawn. A new
   * file comes in one Swap; the same file's header drawn again, as when it's marked viewed, changes
   * in place.
   */
  show(pinned: Pinned | undefined, start: number, end?: number): void {
    this.dom.style.setProperty('--lo-pin-start', `${start}px`);
    this.dom.classList.toggle('is-split', end !== undefined);
    if (end !== undefined) this.dom.style.setProperty('--lo-pin-end', `${end}px`);
    const was = this.#shown;
    this.#shown = pinned;
    this.dom.style.transform = pinned && pinned.shift < 0 ? `translateY(${pinned.shift}px)` : '';
    if (was?.file === pinned?.file && was?.info === pinned?.info) return;
    if (!pinned) {
      this.dom.hidden = true;
      this.dom.replaceChildren();
      return;
    }
    const head = drawHeader(pinned.file, pinned.info, 'both', true);
    // A header that passed pushed the old row out, or pushes the new one in: no fade. A new header
    // replaces the old at once, so a held key's last Swap is cancelled, never queued. Reduce Motion
    // stills it, as every move.
    const passed = was !== undefined && (was.shift < 0 || pinned.shift < 0);
    if (was !== undefined && was.file !== pinned.file && !passed) head.classList.add('move-swap');
    this.dom.replaceChildren(head);
    this.dom.hidden = false;
  }
}
