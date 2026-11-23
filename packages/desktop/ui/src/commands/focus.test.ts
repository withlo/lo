// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { CAUGHT_ATTRIBUTE, catchFocus } from './focus.ts';

let stop: () => void;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`No #${id}`);
  return found;
}

/**
 * Takes `id`, which has focus, off the page, or `wrapped`, which holds it, as Chromium does: it drops
 * focus first, with nowhere for it to go, then the element goes, leaving focus on the body.
 */
function leave(id: string, wrapped = id): void {
  const focused = element(id);
  expect(document.activeElement).toBe(focused);
  focused.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  element(wrapped).remove();
  expect(document.activeElement).toBe(document.body);
}

/** Lets a frame pass, and the tasks after it. */
function settle(): void {
  vi.advanceTimersToNextFrame();
  vi.runOnlyPendingTimers();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
  document.body.innerHTML = `
    <div data-lo-scope="window" id="window">
      <div data-lo-scope="threads" id="threads">
        <button id="again">Try again</button>
        <div data-lo-scope="box" id="box"><button id="send">Send</button></div>
      </div>
      <div data-lo-scope="tree" id="tree" tabindex="0"><button id="row">a.ts</button></div>
      <button id="loose">Loose</button>
      <button id="trigger">Open</button>
    </div>
  `;
  stop = catchFocus(window);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('focus that falls to the page with what had it', () => {
  test('goes to the nearest scope still there, a frame on, made focusable while it holds it', () => {
    const threads = element('threads');
    element('again').focus();
    leave('again');
    // Not yet: React, Base UI and a closing popup get their turn first.
    expect(document.activeElement).toBe(document.body);
    settle();
    expect(document.activeElement).toBe(threads);
    expect(threads.tabIndex).toBe(-1);
    // It draws no ring: the reader didn't put focus there.
    expect(threads.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(true);
    // Once focus moves on, the scope is as it was.
    element('loose').focus();
    expect(threads.hasAttribute('tabindex')).toBe(false);
    expect(threads.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(false);
  });

  test('goes out past scopes that went with it, and keeps a scope’s own tabindex', () => {
    // A box that goes, with focus in it, leaves focus to the list it was in.
    element('send').focus();
    leave('send', 'box');
    settle();
    expect(document.activeElement).toBe(element('threads'));
    // The list going, with focus on it, leaves nothing but the window, which is no place for it.
    leave('threads');
    settle();
    expect(document.activeElement).toBe(document.body);

    const tree = element('tree');
    element('row').focus();
    leave('row');
    settle();
    expect(document.activeElement).toBe(tree);
    element('loose').focus();
    expect(tree.getAttribute('tabindex')).toBe('0');
  });

  test('passes over a scope that can’t take focus, as a hidden one, to the next out', () => {
    document.body.innerHTML = `
      <div data-lo-scope="diff" id="diff">
        <div data-lo-scope="peek" id="peek"><button id="close">Close</button></div>
      </div>
    `;
    const peek = element('peek');
    peek.focus = () => undefined;
    element('close').focus();
    leave('close');
    settle();
    expect(document.activeElement).toBe(element('diff'));
    expect(peek.hasAttribute('tabindex')).toBe(false);
    expect(peek.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(false);
  });
});

describe('a scope that names what takes its focus', () => {
  beforeEach(() => {
    // A diff names its text, of which it has a pane for each side. A box in it is its own.
    document.body.innerHTML = `
      <div data-lo-scope="diff" id="diff" data-lo-focus=".cm-content">
        <div data-lo-scope="box" id="box" data-lo-focus=".cm-content">
          <div class="cm-content" id="text" tabindex="-1"></div>
          <button id="send">Send</button>
        </div>
        <div class="cm-content" id="old" tabindex="-1"></div>
        <div class="cm-content" id="new" tabindex="-1"></div>
        <button id="tip">Show the tip</button>
      </div>
    `;
  });

  test('gives it to the first it names, not one in a scope inside it, and leaves the scope as it was', () => {
    element('tip').focus();
    leave('tip');
    settle();
    expect(document.activeElement).toBe(element('old'));
    const diff = element('diff');
    expect(diff.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(false);
    expect(diff.hasAttribute('tabindex')).toBe(false);
  });

  test('gives it to the one that had focus last, while it’s still there', () => {
    element('new').focus();
    element('tip').focus();
    leave('tip');
    settle();
    expect(document.activeElement).toBe(element('new'));

    element('send').focus();
    leave('send');
    settle();
    expect(document.activeElement).toBe(element('text'));
  });
});

describe('a scope that caught focus', () => {
  test('is as it was once focus leaves it for the page, but not as the window loses focus', () => {
    const threads = element('threads');
    element('again').focus();
    leave('again');
    settle();
    expect(document.activeElement).toBe(threads);
    // The window losing focus leaves the scope focused, to come back to.
    threads.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    vi.runOnlyPendingTimers();
    expect(threads.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(true);
    // A click on nothing puts focus on the page.
    threads.blur();
    vi.runOnlyPendingTimers();
    expect(threads.hasAttribute('tabindex')).toBe(false);
    expect(threads.hasAttribute(CAUGHT_ATTRIBUTE)).toBe(false);
  });
});

describe('focus the browser dropped without a word', () => {
  test('is caught by the next key pressed on the page, before anything else sees the key', () => {
    let seen: Element | null = null;
    const look = () => {
      seen = document.activeElement;
    };
    window.addEventListener('keydown', look, { capture: true });
    element('again').focus();
    // No focusout, as when the browser drops focus quietly.
    element('again').remove();
    expect(document.activeElement).toBe(document.body);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    window.removeEventListener('keydown', look, { capture: true });
    expect(document.activeElement).toBe(element('threads'));
    expect(seen).toBe(element('threads'));
  });

  test('stays on the page after a click on nothing, once what had it goes', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const again = element('again');
    again.focus();
    again.blur();
    settle();
    again.remove();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    expect(document.activeElement).toBe(document.body);
  });
});

describe('focus that left on purpose, or that something else took', () => {
  test('stays where it went while what had it is still on the page: a click on nothing, the window losing focus', () => {
    const again = element('again');
    again.focus();
    again.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    again.blur();
    settle();
    expect(document.activeElement).toBe(document.body);
    expect(element('threads').hasAttribute('tabindex')).toBe(false);
  });

  test('stays where something put it after: a popup giving it back to its trigger a frame on', () => {
    element('again').focus();
    leave('again');
    requestAnimationFrame(() => element('trigger').focus());
    settle();
    expect(document.activeElement).toBe(element('trigger'));
    expect(element('threads').hasAttribute(CAUGHT_ATTRIBUTE)).toBe(false);
  });

  test('stays on the page where only the window’s scope is left, and once it stops', () => {
    element('loose').focus();
    leave('loose');
    settle();
    expect(document.activeElement).toBe(document.body);

    stop();
    element('again').focus();
    leave('again');
    settle();
    expect(document.activeElement).toBe(document.body);
  });
});
