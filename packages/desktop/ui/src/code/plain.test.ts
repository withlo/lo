// @vitest-environment jsdom
// Code views and comment boxes with Vim keys off, as Lo starts: their editors have no Vim, a code
// view is in normal mode to Lo's keys, or in visual mode over the lines a selection covers, and a
// comment box is typed in from the moment it has focus. Switching Vim keys reaches open editors.

import { EditorView } from '@codemirror/view';
import { diffText } from '@lo/diff';
import { getCM } from '@replit/codemirror-vim';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { isKeySource } from '../commands/index.ts';
import type { ComposerEvents, DiffEvents, DiffFile, DiffView } from './api.ts';
import { createComposer } from './composer.ts';
import { focusedMode, setVim, vimOn } from './mode.ts';
import { createDiffView } from './view.ts';

const noRects = (): DOMRectList => Object.assign([], { item: () => null });

/** jsdom has no fonts, no resize observer and no layout: the view needs only that they exist. */
beforeAll(() => {
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: noRects });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
const file: DiffFile = {
  id: 'a',
  path: 'src/a.ts',
  change: 'added',
  lines: { old: [], new: lines },
  header: { additions: 12, deletions: 0 },
};

let view: DiffView | undefined;
let parent: HTMLElement | undefined;
/** What the view drawn last was given to say things with. */
let heard: DiffEvents | undefined;

afterEach(() => {
  view?.destroy();
  parent?.remove();
  view = undefined;
  setVim(false);
});

function events(): DiffEvents {
  return {
    cursor: vi.fn<DiffEvents['cursor']>(),
    mode: vi.fn<DiffEvents['mode']>(),
    file: vi.fn<DiffEvents['file']>(),
    jumped: vi.fn<DiffEvents['jumped']>(),
    load: vi.fn<DiffEvents['load']>(),
    menu: vi.fn<DiffEvents['menu']>(),
  };
}

function composerEvents() {
  return {
    change: vi.fn<ComposerEvents['change']>(),
    submit: vi.fn<ComposerEvents['submit']>(),
    close: vi.fn<ComposerEvents['close']>(),
    mode: vi.fn<NonNullable<ComposerEvents['mode']>>(),
  };
}

/** A diff view of the file above, drawn, with its newer side's editor. */
function open(): { shown: DiffView; editor: EditorView; content: HTMLElement } {
  parent = document.createElement('div');
  parent.className = 'lo-app';
  document.body.append(parent);
  heard = events();
  view = createDiffView(parent, { files: [file], layout: 'split', vimKeys: [], nonce: 'n' }, heard);
  view.setDiff('a', diffText(undefined, `${lines.join('\n')}\n`));
  return { shown: view, ...editorOf('After') };
}

/** The editor labelled `label`, as only this folder's tests may reach it. */
function editorOf(label: string): { editor: EditorView; content: HTMLElement } {
  const content = parent!.querySelector<HTMLElement>(`.cm-content[aria-label="${label}"]`);
  if (!content) throw new Error(`No editor is labelled ${label}.`);
  content.tabIndex = 0;
  const editor: unknown = Reflect.get(Reflect.get(Reflect.get(content, 'cmTile'), 'root'), 'view');
  if (!(editor instanceof EditorView)) throw new Error(`${label} has no editor.`);
  return { editor, content };
}

function press(element: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

/** What the registry is told of the keys in `shown`. */
function keyState(shown: DiffView) {
  if (!isKeySource(shown)) throw new Error('A diff view says how its keys stand.');
  return shown.keyState();
}

describe('a code view with Vim keys off', () => {
  test('has no Vim, and is in normal mode to Lo’s keys, with nothing pending', () => {
    const { shown, editor, content } = open();
    expect(vimOn()).toBe(false);
    expect(getCM(editor)).toBeNull();
    content.focus();
    expect(keyState(shown)).toMatchObject({ mode: 'normal', pending: false, plain: true });
    // No mode is said for the status bar to show.
    expect(focusedMode()).toBeUndefined();
  });

  test('a selection over lines is what Lo’s keys act on, and Esc ends it', () => {
    const { shown, editor, content } = open();
    content.focus();
    const { doc } = editor.state;
    const start = doc.toString().split('\n').indexOf('line 3') + 1;
    // Shift and the arrows, or a drag, down two whole lines: it ends at the start of the third.
    editor.dispatch({
      selection: { anchor: doc.line(start).from, head: doc.line(start + 2).from },
    });
    const selected = keyState(shown);
    expect(selected.mode).toBe('visual');
    // The two lines it covers, not the third, where it ends.
    const at = selected.target.kind === 'line' ? selected.target.at : undefined;
    expect(at).toMatchObject({ file: 'a', side: 'new', from: 3, to: 4 });
    expect(press(content, 'Escape').defaultPrevented).toBe(true);
    expect(editor.state.selection.main.empty).toBe(true);
    expect(keyState(shown).mode).toBe('normal');
    // With nothing selected, Esc is the window's.
    expect(press(content, 'Escape').defaultPrevented).toBe(false);
  });

  test('takes the keys documented as its own, and leaves Lo’s letters to the registry', () => {
    const { content } = open();
    content.focus();
    const taken = ['j', 'k', '/', 'n', 'N'].filter((key) => press(content, key).defaultPrevented);
    expect(taken).toEqual(['j', 'k', '/', 'n', 'N']);
    // Its search has a field, at the foot of the code.
    expect(parent!.querySelector('input[name="search"]')).not.toBeNull();
    // A letter that's a command of Lo's isn't typed, and isn't the editor's: the registry's
    // listener, on the window, has already run it.
    expect(press(content, 'e').defaultPrevented).toBe(false);
    expect(content.textContent).not.toContain('eline');
  });

  test('`j` and `k` move by a line of the document, keeping the column', () => {
    const { editor, content } = open();
    content.focus();
    const { doc } = editor.state;
    const third = Array.from({ length: doc.lines }, (_, at) => doc.line(at + 1)).find(
      (line) => line.text === 'line 3',
    )!;
    editor.dispatch({ selection: { anchor: third.from + 2 } });
    press(content, 'j');
    expect(editor.state.selection.main.head).toBe(doc.line(third.number + 1).from + 2);
    press(content, 'k');
    press(content, 'k');
    expect(editor.state.selection.main.head).toBe(doc.line(third.number - 1).from + 2);
  });

  test('`G` goes to the end and `g g`, its first `g` held for Lo’s sequences, to the top', () => {
    const { shown, editor, content } = open();
    content.focus();
    expect(press(content, 'G').defaultPrevented).toBe(true);
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
    // It's a jump, as Vim's is, so `⌃o` comes back from it.
    expect(heard?.jumped).toHaveBeenCalledOnce();
    if (!isKeySource(shown)) throw new Error('A diff view takes keys handed back.');
    // A `g` alone is nothing of the editor's.
    expect(press(content, 'g').defaultPrevented).toBe(false);
    // The registry hands the `g` it held back as the next key doesn't go on with it: a `g`.
    shown.passKeys(['g']);
    // So the `g` being pressed is the editor's, not the start of another sequence of Lo's.
    expect(keyState(shown).pending).toBe(true);
    expect(press(content, 'g').defaultPrevented).toBe(true);
    expect(keyState(shown).pending).toBe(false);
    expect(editor.state.selection.main.head).toBe(0);
    expect(heard?.jumped).toHaveBeenCalledTimes(2);
  });

  test('gets Vim as Vim keys go on, and loses it as they go off', () => {
    const { shown, editor } = open();
    setVim(true);
    expect(getCM(editor)).not.toBeNull();
    expect(keyState(shown).plain).toBe(false);
    setVim(false);
    expect(getCM(editor)).toBeNull();
    expect(keyState(shown).plain).toBe(true);
  });
});

/** A comment box outside any view, holding "Kept", with focus. */
function box() {
  parent = document.createElement('div');
  document.body.append(parent);
  const on = composerEvents();
  const made = createComposer(parent, { draft: 'Kept', nonce: 'n', label: 'Reply' }, on);
  made.focus();
  return { made, on, ...editorOf('Reply') };
}

describe('a comment box with Vim keys off', () => {
  test('is typed in from the moment it has focus, with no mode to say', () => {
    const { made, on, editor } = box();
    expect(getCM(editor)).toBeNull();
    expect(made.mode).toBe('insert');
    expect(on.mode).not.toHaveBeenCalled();
    made.close();
  });

  test('one Esc closes it, keeping the draft, but an Esc that cancels a composition', () => {
    const { made, on, content } = box();
    // An input method's `Esc` is its own: the text being composed goes, and the box stays.
    content.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(on.close).not.toHaveBeenCalled();
    press(content, 'Escape');
    expect(on.close).toHaveBeenCalledExactlyOnceWith(true);
    made.close();
  });

  test('open as Vim keys go on, it’s still being typed in, and Esc leaves insert mode first', () => {
    const { made, on, editor, content } = box();
    setVim(true);
    expect(getCM(editor)?.state.vim?.insertMode).toBe(true);
    press(content, 'Escape');
    expect(on.close).not.toHaveBeenCalled();
    expect(made.mode).toBe('normal');
    setVim(false);
    expect(made.mode).toBe('insert');
    made.close();
  });
});
