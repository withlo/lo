import { describe, expect, test } from 'vitest';

import {
  eventStroke,
  keyLabels,
  parseKeys,
  readKeys,
  strokeOf,
  systemStrokes,
  vimKeys,
  writeKeys,
  type KeyEventLike,
  type System,
} from './notation.ts';

/** The ids of the strokes `text` is on `system`. */
function ids(text: string, system: System = 'mac'): string[] {
  return systemStrokes(parseKeys(text), system).map((each) => each.id);
}

function event(key: string, held: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key,
    code: held.code ?? '',
    metaKey: held.metaKey ?? false,
    ctrlKey: held.ctrlKey ?? false,
    altKey: held.altKey ?? false,
    shiftKey: held.shiftKey ?? false,
    ...(held.getModifierState ? { getModifierState: held.getModifierState } : {}),
  };
}

const altGraph = (key: string) => key === 'AltGraph';

/** How `system` shows `text`. */
function forms(text: string, system: System): string[] {
  return keyLabels(systemStrokes(parseKeys(text), system), system);
}

/** `text` in Vim's notation. */
function vim(text: string, system: System = 'mac'): string {
  return vimKeys(systemStrokes(parseKeys(text), system));
}

describe('notation', () => {
  test('reads chords with plus signs and sequences with spaces', () => {
    expect(parseKeys('cmd+shift+p')).toEqual([
      { key: 'p', cmd: true, ctrl: false, alt: false, shift: true },
    ]);
    expect(ids('] f')).toEqual([']', 'f']);
    expect(ids('g S')).toEqual(['g', 'S']);
    expect(ids('esc  esc')).toEqual(['esc', 'esc']);
  });

  test('writes each keystroke one way', () => {
    // A lone letter's case is the key, and Shift on its own is folded into it.
    expect(ids('shift+g')).toEqual(ids('G'));
    expect(ids('shift+/')).toEqual(ids('?'));
    // With a modifier, Shift is a modifier of its own, and the key is the unshifted one.
    expect(ids('cmd+P')).toEqual(ids('cmd+shift+p'));
    expect(ids('cmd+}')).toEqual(['meta+shift+]']);
    expect(ids('cmd+shift+}')).toEqual(['meta+shift+]']);
    // Modifiers and names in any case; `plus` for `+`.
    expect(ids('Ctrl+Shift+Tab')).toEqual(['ctrl+shift+tab']);
    expect(ids('ENTER')).toEqual(['enter']);
    expect(ids('plus')).toEqual(['+']);
    expect(ids('+')).toEqual(['+']);
    expect(ids('ctrl++')).toEqual(ids('ctrl+shift+='));
    expect(writeKeys(parseKeys('Shift+Ctrl+TAB  ]  shift+g'))).toBe('ctrl+shift+tab ] G');
  });

  test('says why keys can’t be read', () => {
    expect(readKeys('')).toEqual({ error: 'No keys.' });
    expect(readKeys('cmd+')).toEqual({ error: '"cmd+" has no key after its last "+".' });
    expect(readKeys('+p')).toEqual({ error: '"+p" has a "+" with nothing before it.' });
    expect(readKeys('meta+p')).toEqual({
      error: '"meta" in "meta+p" isn\'t a modifier: use cmd, ctrl, alt or shift.',
    });
    expect(readKeys('shift+ctrl+shift+a')).toEqual({
      error: '"shift+ctrl+shift+a" holds shift twice.',
    });
    expect(readKeys('g escape')).toEqual({
      error: '"escape" isn\'t a key: write one character, or a name such as enter.',
    });
    expect(() => parseKeys('cmd+')).toThrow('Keys "cmd+": "cmd+" has no key after its last "+".');
  });

  test('cmd is ⌘ on macOS and Ctrl on Linux, and ctrl is ⌃ on both', () => {
    expect(ids('cmd+o', 'mac')).toEqual(['meta+o']);
    expect(ids('cmd+o', 'linux')).toEqual(['ctrl+o']);
    expect(ids('ctrl+o', 'mac')).toEqual(['ctrl+o']);
    expect(ids('ctrl+o', 'linux')).toEqual(['ctrl+o']);
    // So on Linux the two are one key, which is why ⌘O is a macOS alias only.
    expect(ids('cmd+ctrl+o', 'linux')).toEqual(['ctrl+o']);
  });
});

describe('key events', () => {
  test('a character typed on its own carries its Shift', () => {
    expect(eventStroke(event('g'))?.id).toBe('g');
    expect(eventStroke(event('G', { shiftKey: true }))?.id).toBe('G');
    expect(eventStroke(event('?', { shiftKey: true, code: 'Slash' }))?.id).toBe('?');
    expect(eventStroke(event(']'))?.id).toBe(']');
  });

  test('named keys keep Shift as a modifier', () => {
    expect(eventStroke(event('Tab', { shiftKey: true }))?.id).toBe('shift+tab');
    expect(eventStroke(event(' '))?.id).toBe('space');
    expect(eventStroke(event('Escape'))?.id).toBe('esc');
    expect(eventStroke(event('ArrowDown'))?.id).toBe('down');
    expect(eventStroke(event('F5'))?.id).toBe('f5');
  });

  test('with ⌘ or Ctrl, a letter is lowercase and Shift a modifier, whatever event.key says', () => {
    expect(eventStroke(event('p', { metaKey: true, shiftKey: true }))?.id).toBe('meta+shift+p');
    expect(eventStroke(event('P', { metaKey: true, shiftKey: true }))?.id).toBe('meta+shift+p');
    // Caps Lock gives a capital without Shift.
    expect(eventStroke(event('P', { metaKey: true }))?.id).toBe('meta+p');
    expect(eventStroke(event('O', { ctrlKey: true, shiftKey: true }))?.id).toBe('ctrl+shift+o');
  });

  test('with ⌘ or Ctrl, a shifted symbol is read by its code', () => {
    const next = { metaKey: true, shiftKey: true, code: 'BracketRight' };
    expect(eventStroke(event('}', next))?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next))?.id).toBe('meta+shift+]');
    expect(eventStroke(event(']', next))?.id).toBe(ids('cmd+shift+]')[0]);
    expect(eventStroke(event('|', { ctrlKey: true, shiftKey: true, code: 'Backslash' }))?.id).toBe(
      'ctrl+shift+\\',
    );
  });

  test('⌥ chords match by event.code, since ⌥ changes event.key on macOS', () => {
    // ⌥A types å, and ⌥E is a dead key for an accent.
    expect(eventStroke(event('å', { altKey: true, code: 'KeyA' }))?.id).toBe('alt+a');
    expect(eventStroke(event('Dead', { altKey: true, code: 'KeyE' }))?.id).toBe('alt+e');
    expect(eventStroke(event('Å', { altKey: true, shiftKey: true, code: 'KeyA' }))?.id).toBe(
      'alt+shift+a',
    );
    expect(eventStroke(event('‘', { altKey: true, code: 'BracketRight' }))?.id).toBe('alt+]');
    expect(eventStroke(event('Enter', { altKey: true, code: 'Enter' }))?.id).toBe('alt+enter');
    expect(eventStroke(event('ı', { altKey: true, metaKey: true, code: 'KeyI' }))?.id).toBe(
      ids('cmd+alt+i')[0],
    );
  });

  test('modifier keys, dead keys and AltGr’s characters are no chord', () => {
    expect(eventStroke(event('Shift', { shiftKey: true }))).toBeUndefined();
    expect(eventStroke(event('Meta', { metaKey: true }))).toBeUndefined();
    expect(eventStroke(event('Dead'))).toBeUndefined();
    expect(eventStroke(event('Process'))).toBeUndefined();
    expect(
      eventStroke(
        event('@', { ctrlKey: true, altKey: true, code: 'KeyQ', getModifierState: altGraph }),
      )?.id,
    ).toBe('@');
  });
});

describe('display forms', () => {
  test('macOS shows symbols, as the design writes keys', () => {
    expect(forms('cmd+shift+p', 'mac')).toEqual(['⌘⇧P']);
    expect(forms('cmd+enter', 'mac')).toEqual(['⌘⏎']);
    expect(forms('cmd+shift+enter', 'mac')).toEqual(['⌘⇧⏎']);
    expect(forms('alt+enter', 'mac')).toEqual(['⌥⏎']);
    expect(forms('cmd+alt+i', 'mac')).toEqual(['⌘⌥I']);
    expect(forms('cmd+shift+]', 'mac')).toEqual(['⌘⇧]']);
    expect(forms('cmd+\\', 'mac')).toEqual(['⌘\\']);
    // Vim's keys keep their lowercase letter.
    expect(forms('ctrl+o', 'mac')).toEqual(['⌃o']);
    expect(forms('ctrl+tab', 'mac')).toEqual(['⌃⇥']);
    expect(forms('ctrl+shift+tab', 'mac')).toEqual(['⌃⇧⇥']);
    expect(forms('shift+tab', 'mac')).toEqual(['⇧Tab']);
    expect(forms('tab', 'mac')).toEqual(['Tab']);
    // A sequence is separate keys.
    expect(forms('] f', 'mac')).toEqual([']', 'f']);
    expect(forms('g S', 'mac')).toEqual(['g', 'S']);
    expect(forms('esc esc', 'mac')).toEqual(['Esc', 'Esc']);
    expect(forms('enter', 'mac')).toEqual(['⏎']);
    expect(forms('left right', 'mac')).toEqual(['←', '→']);
  });

  test('Linux spells modifiers out, with Ctrl for cmd', () => {
    expect(forms('cmd+shift+p', 'linux')).toEqual(['Ctrl+Shift+P']);
    expect(forms('cmd+l', 'linux')).toEqual(['Ctrl+L']);
    expect(forms('ctrl+o', 'linux')).toEqual(['Ctrl+O']);
    expect(forms('alt+enter', 'linux')).toEqual(['Alt+Enter']);
    expect(forms('ctrl+shift+tab', 'linux')).toEqual(['Ctrl+Shift+Tab']);
    expect(forms('shift+tab', 'linux')).toEqual(['Shift+Tab']);
    expect(forms('cmd+plus', 'linux')).toEqual(['Ctrl+Shift+=']);
    expect(forms('] f', 'linux')).toEqual([']', 'f']);
    expect(forms('enter', 'linux')).toEqual(['Enter']);
    expect(forms('esc esc', 'linux')).toEqual(['Esc', 'Esc']);
  });
});

test('Vim’s notation, as code views take held keys and motions', () => {
  expect(vim('] f')).toBe(']f');
  expect(vim('g S')).toBe('gS');
  expect(vim('ctrl+o')).toBe('<C-o>');
  expect(vim('cmd+o', 'linux')).toBe('<C-o>');
  expect(vim('cmd+s', 'mac')).toBe('<D-s>');
  expect(vim('enter')).toBe('<CR>');
  expect(vim('esc esc')).toBe('<Esc><Esc>');
  expect(vim('shift+tab')).toBe('<S-Tab>');
  expect(vim('space')).toBe('<Space>');
  expect(vim('<')).toBe('<lt>');
  expect(vimKeys([strokeOf('w', { ctrl: true }), strokeOf('j')])).toBe('<C-w>j');
});
