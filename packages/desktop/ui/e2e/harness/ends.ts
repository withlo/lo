// The page the ends spec drives: a pane 400 px tall of twenty rows 40 px tall, and a box 200 px tall
// at its end, as a timeline's comment box is, whose end the pane keeps (`keepEnd`). The spec works it
// through `window.ends`.

import { keepEnd } from '../../src/ends.ts';

const pane = document.createElement('div');
pane.id = 'pane';
pane.style.cssText = 'position: relative; height: 400px; width: 300px; overflow-y: auto';
for (let row = 0; row < 20; row += 1) {
  const each = document.createElement('div');
  each.className = 'row';
  each.style.height = '40px';
  each.textContent = `Row ${row + 1}`;
  pane.append(each);
}
const box = document.createElement('div');
box.id = 'box';
box.style.height = '200px';
pane.append(box);
document.querySelector('#root')!.append(pane);
keepEnd(pane);

/** Two frames, by when what changed is laid out and drawn. */
const drawn = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

const ends = {
  /** Scrolls the pane to `top`, as the reader would, and says where it is once drawn. */
  async scroll(top: number) {
    pane.scrollTop = top;
    await drawn();
    return ends.where();
  },
  /** Makes the box `height` tall, as it would be as lines go, and says where things are once drawn. */
  async shrink(height: number) {
    box.style.height = `${height}px`;
    await drawn();
    return ends.where();
  },
  /** How far the pane scrolls, how far it can, and where its tenth row and its box are on screen. */
  where() {
    const top = pane.getBoundingClientRect().top;
    return {
      scroll: pane.scrollTop,
      end: pane.scrollHeight - pane.clientHeight,
      row: pane.querySelectorAll('.row')[9]!.getBoundingClientRect().top - top,
      box: box.getBoundingClientRect().top - top,
    };
  },
};

declare global {
  interface Window {
    /** What the ends spec drives the page with. */
    ends: typeof ends;
  }
}

window.ends = ends;
