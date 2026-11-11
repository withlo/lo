// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { FakeView, testCommands, type Ran } from '../../test/commands.ts';
import { listen } from './listener.ts';
import { Registry } from './registry.ts';
import { setScopeSource } from './scopes.ts';

let ran: Ran[];
let log: string[];
let registry: Registry;
let stop: () => void;
let diffView: FakeView;
let boxView: FakeView;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`No #${id}`);
  return found;
}

/** Presses `key` with focus on `id`, as the system would, and returns the event. */
function press(id: string, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const target = element(id);
  if (document.activeElement !== target) target.focus();
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Records the keys that reach `id` itself, as a widget or CodeMirror would see them. */
function widget(id: string): void {
  element(id).addEventListener('keydown', (event) => {
    log.push(`${id} ${event.key}`);
  });
}

beforeEach(() => {
  document.body.innerHTML = `
    <div data-lo-scope="diff" id="diff">
      <div id="editor" contenteditable="true" tabindex="0"></div>
      <div class="cm-panels"><span>/</span><input id="prompt" type="text"></div>
      <div data-lo-scope="box" id="box"><div id="text" contenteditable="true" tabindex="0"></div></div>
    </div>
    <div data-lo-scope="tree" id="tree"><button id="row">a.ts</button><button id="other">b.ts</button></div>
    <form data-lo-scope="settings"><input id="first"><input id="second"></form>
    <div data-lo-scope="dialog"><input id="name"><button id="ok">OK</button></div>
    <div data-lo-scope="menu"><div role="menuitem" tabindex="-1" id="item">Copy</div></div>
    <div data-lo-scope="palette"><input id="query"></div>
  `;
  ran = [];
  log = [];
  diffView = new FakeView(log);
  boxView = new FakeView(log);
  setScopeSource(element('diff'), diffView);
  setScopeSource(element('box'), boxView);
  setScopeSource(element('tree'), { target: () => ({ kind: 'file', file: 'a.ts' }) });
  registry = new Registry({ system: 'mac', commands: testCommands(ran) });
  stop = listen(window, registry);
});

afterEach(() => {
  stop();
});

const ids = () => ran.map(([id]) => id);

describe('the listener', () => {
  test('takes Lo’s keys before the focused widget sees them', () => {
    widget('row');
    const taken = press('row', 'e');
    expect(taken.defaultPrevented).toBe(true);
    expect(ran).toEqual([['diff.markViewed', { kind: 'file', file: 'a.ts' }]]);
    const other = press('row', 'q');
    expect(other.defaultPrevented).toBe(false);
    expect(log).toEqual(['row q']);
  });

  test('runs a key on the code view’s target', () => {
    press('editor', 'e');
    expect(ran).toEqual([
      ['diff.markViewed', { kind: 'line', at: { file: 'a.ts', side: 'new', line: 1 } }],
    ]);
  });

  test('hands a held key back to the code view before the next key reaches it', () => {
    widget('editor');
    expect(press('editor', 'y').defaultPrevented).toBe(true);
    expect(log).toEqual([]);
    expect(press('editor', 'w').defaultPrevented).toBe(false);
    // Vim gets `y`, then `w`: a word is yanked.
    expect(log).toEqual(['passKeys y', 'editor w']);
    expect(ids()).toEqual([]);
  });

  test('completes a sequence', () => {
    press('editor', 'y');
    press('editor', 'l');
    expect(ids()).toEqual(['diff.copyLink']);
  });

  test('leaves keys during IME composition to the text', () => {
    widget('row');
    expect(press('row', 'e', { isComposing: true }).defaultPrevented).toBe(false);
    expect(press('row', 'Process').defaultPrevented).toBe(false);
    expect(ids()).toEqual([]);
    expect(log).toEqual(['row e', 'row Process']);
  });

  test('leaves typing to a text field, and takes its scope’s keys', () => {
    expect(press('query', '?').defaultPrevented).toBe(false);
    expect(press('query', 'Enter').defaultPrevented).toBe(true);
    expect(ids()).toEqual(['palette.run']);
  });

  test('sends ↓ and ↑ for j and k in a menu', () => {
    widget('item');
    const j = press('item', 'j');
    press('item', 'k');
    expect(j.defaultPrevented).toBe(true);
    expect(log).toEqual(['item ArrowDown', 'item ArrowUp']);
  });

  test('stops listening', () => {
    stop();
    expect(press('row', 'e').defaultPrevented).toBe(false);
    expect(ids()).toEqual([]);
  });
});

describe('the Tab backstop', () => {
  test('ends a Tab nobody handled in a box, so focus stays there in both modes', () => {
    for (const mode of ['insert', 'normal'] as const) {
      boxView.mode = mode;
      expect(press('text', 'Tab').defaultPrevented).toBe(true);
      expect(press('text', 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    }
    expect(ids()).toEqual([]);
  });

  test('ends an unhandled Tab with any modifiers, since macOS moves focus on ⌥Tab', () => {
    for (const held of [{ altKey: true }, { altKey: true, shiftKey: true }, { ctrlKey: true }]) {
      expect(press('text', 'Tab', held).defaultPrevented).toBe(true);
      expect(press('editor', 'Tab', held).defaultPrevented).toBe(true);
    }
    expect(ids()).toEqual([]);
  });

  test('ends an unhandled Tab in a code view, and in a field inside one', () => {
    expect(press('prompt', 'Tab').defaultPrevented).toBe(true);
  });

  test('leaves the browser’s Tab to form fields and every other scope', () => {
    expect(press('first', 'Tab').defaultPrevented).toBe(false);
    expect(press('second', 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('name', 'Tab').defaultPrevented).toBe(false);
    expect(press('ok', 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('row', 'Tab').defaultPrevented).toBe(false);
  });

  test('sends focus back when a widget stopped an unhandled Tab and the browser moved it', () => {
    vi.useFakeTimers();
    try {
      element('text').addEventListener('keydown', (event) => event.stopPropagation());
      expect(press('text', 'Tab').defaultPrevented).toBe(false);
      // The browser's own focus move, after the event.
      element('row').focus();
      expect(document.activeElement).toBe(element('text'));
      // Focus moved later, by anything else, stays where it went.
      vi.runAllTimers();
      element('row').focus();
      expect(document.activeElement).toBe(element('row'));
      // A Tab that moves focus within the scope is left alone.
      element('editor').addEventListener('keydown', (event) => event.stopPropagation());
      press('editor', 'Tab', { altKey: true });
      element('prompt').focus();
      expect(document.activeElement).toBe(element('prompt'));
    } finally {
      vi.useRealTimers();
    }
  });

  test('lets a scope’s Tab command run', () => {
    expect(press('editor', 'Tab').defaultPrevented).toBe(true);
    expect(ids()).toEqual(['diff.otherSide']);
  });
});

/** Holds `z` in the tree, does `drop`, then presses `R`, which would have completed it. */
function heldThen(drop: () => void): KeyboardEvent {
  expect(press('row', 'z').defaultPrevented).toBe(true);
  expect(registry.isPending()).toBe(true);
  drop();
  expect(registry.isPending()).toBe(false);
  return press('row', 'R');
}

describe('a pending sequence', () => {
  test('is dropped on a focus change', () => {
    const after = heldThen(() => element('other').focus());
    // R went to the focused row, and nothing ran.
    expect(after.defaultPrevented).toBe(false);
    expect(ids()).toEqual([]);
  });

  test('is dropped on a pointer down', () => {
    heldThen(() => element('row').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(ids()).toEqual([]);
  });

  test('is dropped when the window loses focus', () => {
    heldThen(() => window.dispatchEvent(new FocusEvent('blur')));
    expect(ids()).toEqual([]);
  });

  test('is dropped by Esc', () => {
    heldThen(() => press('row', 'Escape'));
    expect(ids()).toEqual([]);
  });

  test('is dropped on a tab switch', () => {
    heldThen(() => registry.tab('two'));
    expect(ids()).toEqual([]);
  });

  test('a held g in a code view dies on blur, and never reaches Vim', () => {
    widget('editor');
    press('editor', 'g');
    window.dispatchEvent(new FocusEvent('blur'));
    const after = press('editor', 'i');
    // `g i` would have switched the layout; `i` goes to Vim alone, with nothing pending.
    expect(after.defaultPrevented).toBe(false);
    expect(ids()).toEqual([]);
    expect(log).toEqual(['clearPending', 'editor i']);
  });
});

describe('leaving a code view', () => {
  test('clears what Vim waits on when focus leaves it or the window loses focus', () => {
    diffView.pending = true;
    press('editor', 'x');
    element('row').focus();
    expect(log).toEqual(['clearPending']);
    expect(diffView.pending).toBe(false);
    press('editor', 'x');
    diffView.pending = true;
    window.dispatchEvent(new FocusEvent('blur'));
    expect(log).toEqual(['clearPending', 'clearPending']);
  });

  test('leaves Vim as it is when focus moves within the view, to its prompt', () => {
    diffView.pending = true;
    element('editor').focus();
    element('prompt').focus();
    expect(log).toEqual([]);
    expect(diffView.pending).toBe(true);
  });
});

describe('Vim’s prompt', () => {
  test('takes what’s typed into it, though it sits inside the diff', () => {
    widget('prompt');
    for (const key of ['e', 'y', 'l', 'Enter', 'Escape']) {
      expect(press('prompt', key).defaultPrevented).toBe(false);
    }
    expect(ids()).toEqual([]);
    expect(log).toEqual(['prompt e', 'prompt y', 'prompt l', 'prompt Enter', 'prompt Escape']);
    // Chords are still Lo's.
    expect(
      press('prompt', 'P', { metaKey: true, shiftKey: true, code: 'KeyP' }).defaultPrevented,
    ).toBe(true);
    expect(ids()).toEqual(['keys.palette']);
  });
});
