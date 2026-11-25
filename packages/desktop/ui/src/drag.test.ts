// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dragEdge, resizing } from './drag.ts';

/** What the drag said, in turn: `drag 360`, `drag 220 closing`, `end 360`, `cancel`, `close`. */
const said: string[] = [];
let edge: HTMLElement;

beforeEach(() => {
  edge = document.body.appendChild(document.createElement('div'));
  // jsdom has no pointer capture: the edge holds the pointer from the press until it's let go.
  let held = false;
  edge.setPointerCapture = () => {
    held = true;
  };
  edge.hasPointerCapture = () => held;
  edge.releasePointerCapture = () => {
    held = false;
  };
});

afterEach(() => {
  said.splice(0);
  document.body.replaceChildren();
});

/** A pointer event on the edge, at `x`. */
const pointer = (type: string, x: number) =>
  new PointerEvent(type, { button: 0, clientX: x, pointerId: 1 });

/** Presses the edge of a left panel 300 wide, at 300, which closes let go near the window's side. */
function press(): void {
  dragEdge(edge, pointer('pointerdown', 300), {
    from: 300,
    range: () => ({ min: 220, max: 480 }),
    grows: 'end',
    onDrag: (value, closing) => said.push(`drag ${value}${closing ? ' closing' : ''}`),
    onEnd: (value) => said.push(`end ${value}`),
    onCancel: () => said.push('cancel'),
    onClose: () => said.push('close'),
  });
}

const move = (x: number) => edge.dispatchEvent(pointer('pointermove', x));

describe('dragging an edge', () => {
  it('cancels as the pointer is lost to the system, and lets go of the page', () => {
    press();
    move(360);
    edge.dispatchEvent(pointer('lostpointercapture', 360));
    expect(said).toEqual(['drag 360', 'cancel']);
    expect(resizing(document)).toBe(false);
    expect(edge.hasAttribute('data-dragging')).toBe(false);
    // Over, it follows nothing more.
    move(400);
    expect(said).toEqual(['drag 360', 'cancel']);
  });

  it('cancels as the window loses focus before the pointer has moved', () => {
    press();
    window.dispatchEvent(new FocusEvent('blur'));
    expect(said).toEqual(['cancel']);
    expect(resizing(document)).toBe(false);
  });

  it('ends where it is as the window loses focus after a move', () => {
    press();
    move(360);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(said).toEqual(['drag 360', 'end 360']);
  });

  it('closes the panel only as it’s let go near the window’s side, and cancels as focus goes there', () => {
    press();
    move(60);
    window.dispatchEvent(new FocusEvent('blur'));
    expect(said).toEqual(['drag 220 closing', 'cancel']);

    said.splice(0);
    press();
    move(60);
    edge.dispatchEvent(pointer('pointerup', 60));
    expect(said).toEqual(['drag 220 closing', 'drag 220 closing', 'close']);
  });
});
