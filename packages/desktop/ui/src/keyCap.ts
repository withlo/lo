// A key cap as `Key` draws one, made in a code view's own DOM, where React doesn't reach. It has no
// JSX, so a code view's source, which is also built where JSX isn't, can import it.

import { glyphNodes } from './iconElement.ts';

/**
 * One key cap: `label` as the system shows the key, its symbols drawn as icons from `glyphs.ts`, 12
 * px as in `Key`, and the rest as text. Each symbol's character stays beside its icon, visually
 * hidden, so the cap's text is the label. `key-icons` sets the inside as `Key`'s; the code view's
 * tooltip styles the outside (`.lo-tip kbd`).
 */
export function keyCap(label: string): HTMLElement {
  const cap = document.createElement('kbd');
  cap.className = 'key-icons';
  cap.append(...glyphNodes(label));
  return cap;
}
